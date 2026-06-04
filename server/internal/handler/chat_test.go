package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// withChatTestWorkspaceCtx injects the workspace+member context that the
// real chi middleware chain would normally set. SendChatMessage (and most
// other chat handlers) read workspace ID from ctxWorkspaceID; without this
// the test harness, which calls handlers directly, gets "invalid workspace
// id" on the parseUUIDOrBadRequest call inside SendChatMessage.
func withChatTestWorkspaceCtx(t *testing.T, req *http.Request) *http.Request {
	t.Helper()
	memberRow, err := testHandler.Queries.GetMemberByUserAndWorkspace(context.Background(), db.GetMemberByUserAndWorkspaceParams{
		UserID:      util.MustParseUUID(testUserID),
		WorkspaceID: util.MustParseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("load test member row: %v", err)
	}
	return req.WithContext(middleware.SetMemberContext(req.Context(), testWorkspaceID, memberRow))
}

// TestSendChatMessage_LinksAttachments verifies that attachments uploaded
// against a chat_session (chat_message_id NULL) are back-filled with the
// message_id when SendChatMessage receives the matching attachment_ids.
func TestSendChatMessage_LinksAttachments(t *testing.T) {
	origStorage := testHandler.Storage
	testHandler.Storage = &mockStorage{}
	defer func() { testHandler.Storage = origStorage }()

	agentID := createHandlerTestAgent(t, "ChatSendAttachAgent", []byte("[]"))
	sessionID := createHandlerTestChatSession(t, agentID)

	// 1. Upload a file against the chat session.
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "send-link.png")
	part.Write([]byte("\x89PNG\r\n\x1a\nbytes"))
	writer.WriteField("chat_session_id", sessionID)
	writer.Close()

	uploadReq := httptest.NewRequest("POST", "/api/upload-file", &body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadReq.Header.Set("X-User-ID", testUserID)
	uploadReq.Header.Set("X-Workspace-ID", testWorkspaceID)

	uploadW := httptest.NewRecorder()
	testHandler.UploadFile(uploadW, uploadReq)
	if uploadW.Code != http.StatusOK {
		t.Fatalf("upload precondition: %d %s", uploadW.Code, uploadW.Body.String())
	}
	var uploadResp AttachmentResponse
	if err := json.Unmarshal(uploadW.Body.Bytes(), &uploadResp); err != nil {
		t.Fatalf("decode upload: %v", err)
	}
	attachmentID := uploadResp.ID
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM attachment WHERE id = $1`, attachmentID)
	})

	// 2. Send a chat message that references the attachment.
	sendReq := newRequest("POST", "/api/chat-sessions/"+sessionID+"/messages", map[string]any{
		"content":        "look at this ![](" + uploadResp.URL + ")",
		"attachment_ids": []string{attachmentID},
	})
	sendReq = withURLParam(sendReq, "sessionId", sessionID)
	sendReq = withChatTestWorkspaceCtx(t, sendReq)
	sendW := httptest.NewRecorder()
	testHandler.SendChatMessage(sendW, sendReq)
	if sendW.Code != http.StatusCreated {
		t.Fatalf("SendChatMessage: expected 201, got %d: %s", sendW.Code, sendW.Body.String())
	}

	var sendResp SendChatMessageResponse
	if err := json.Unmarshal(sendW.Body.Bytes(), &sendResp); err != nil {
		t.Fatalf("decode send: %v", err)
	}
	if sendResp.MessageID == "" {
		t.Fatal("expected non-empty message_id in send response")
	}

	// 3. Verify the attachment row now points at the new message.
	var dbMessageID *string
	if err := testPool.QueryRow(
		context.Background(),
		`SELECT chat_message_id::text FROM attachment WHERE id = $1`,
		attachmentID,
	).Scan(&dbMessageID); err != nil {
		t.Fatalf("query attachment: %v", err)
	}
	if dbMessageID == nil {
		t.Fatal("chat_message_id is still NULL after send")
	}
	if *dbMessageID != sendResp.MessageID {
		t.Fatalf("chat_message_id mismatch: want %s, got %s", sendResp.MessageID, *dbMessageID)
	}
}

// TestUpdateChatSession_RenamesTitle confirms PATCH writes the new title,
// returns the updated row, and the server-side row reflects it.
func TestUpdateChatSession_RenamesTitle(t *testing.T) {
	agentID := createHandlerTestAgent(t, "ChatRenameAgent", []byte("[]"))
	sessionID := createHandlerTestChatSession(t, agentID)

	req := newRequest("PATCH", "/api/chat/sessions/"+sessionID, map[string]any{
		"title": "  Renamed Session  ",
	})
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.UpdateChatSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateChatSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp ChatSessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode update: %v", err)
	}
	if resp.Title != "Renamed Session" {
		t.Fatalf("response title: want %q, got %q", "Renamed Session", resp.Title)
	}

	var dbTitle string
	if err := testPool.QueryRow(
		context.Background(),
		`SELECT title FROM chat_session WHERE id = $1`,
		sessionID,
	).Scan(&dbTitle); err != nil {
		t.Fatalf("query chat_session: %v", err)
	}
	if dbTitle != "Renamed Session" {
		t.Fatalf("db title: want %q, got %q", "Renamed Session", dbTitle)
	}
}

// TestUpdateChatSession_RejectsBlank refuses an empty/whitespace title with 400.
// (Untitled is a render-side fallback, not a stored value.)
func TestUpdateChatSession_RejectsBlank(t *testing.T) {
	agentID := createHandlerTestAgent(t, "ChatRenameBlankAgent", []byte("[]"))
	sessionID := createHandlerTestChatSession(t, agentID)

	req := newRequest("PATCH", "/api/chat/sessions/"+sessionID, map[string]any{
		"title": "   ",
	})
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.UpdateChatSession(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("UpdateChatSession blank: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestSendChatMessage_InvalidAttachmentIDs rejects malformed UUIDs in
// attachment_ids with 400 before any side effects (no message row created).
func TestSendChatMessage_InvalidAttachmentIDs(t *testing.T) {
	agentID := createHandlerTestAgent(t, "ChatBadAttachAgent", []byte("[]"))
	sessionID := createHandlerTestChatSession(t, agentID)

	req := newRequest("POST", "/api/chat-sessions/"+sessionID+"/messages", map[string]any{
		"content":        "hi",
		"attachment_ids": []string{"not-a-uuid"},
	})
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.SendChatMessage(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("SendChatMessage with bad attachment id: expected 400, got %d: %s", w.Code, w.Body.String())
	}

	// Confirm no message row was created.
	var count int
	if err := testPool.QueryRow(
		context.Background(),
		`SELECT count(*) FROM chat_message WHERE chat_session_id = $1`,
		sessionID,
	).Scan(&count); err != nil {
		t.Fatalf("count chat_message: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 chat_message rows after rejected send, got %d", count)
	}
}

func sendChatMessageForTest(
	t *testing.T,
	sessionID string,
	content string,
	attachmentIDs ...string,
) SendChatMessageResponse {
	t.Helper()

	body := map[string]any{"content": content}
	if len(attachmentIDs) > 0 {
		body["attachment_ids"] = attachmentIDs
	}
	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/messages", body)
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.SendChatMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("SendChatMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp SendChatMessageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode SendChatMessage response: %v", err)
	}
	return resp
}

func completeChatTaskForTest(t *testing.T, taskID, output, sessionID, workDir string) {
	t.Helper()

	payload, err := json.Marshal(protocol.TaskCompletedPayload{
		TaskID: taskID,
		Output: output,
	})
	if err != nil {
		t.Fatalf("marshal task payload: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(
		context.Background(),
		parseUUID(taskID),
		payload,
		sessionID,
		workDir,
	); err != nil {
		t.Fatalf("CompleteTask: %v", err)
	}
}

func chatSessionResumePointer(t *testing.T, sessionID string) (*string, *string, *string) {
	t.Helper()

	var sessionPtr, workDirPtr, runtimePtr *string
	if err := testPool.QueryRow(
		context.Background(),
		`SELECT session_id, work_dir, runtime_id::text FROM chat_session WHERE id = $1`,
		sessionID,
	).Scan(&sessionPtr, &workDirPtr, &runtimePtr); err != nil {
		t.Fatalf("query chat_session resume pointer: %v", err)
	}
	return sessionPtr, workDirPtr, runtimePtr
}

func TestWithdrawLastChatMessage_DeletesCompletedTurnAndClearsResumePointer(t *testing.T) {
	agentID := createHandlerTestAgent(t, "ChatWithdrawAgent", []byte("[]"))
	sessionID := createHandlerTestChatSession(t, agentID)

	sendResp := sendChatMessageForTest(t, sessionID, "undo me")
	completeChatTaskForTest(t, sendResp.TaskID, "done", "chat-session-1", "/tmp/chat-session-1")

	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/messages/withdraw-last", nil)
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.WithdrawLastChatMessage(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("WithdrawLastChatMessage: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	var messageCount int
	if err := testPool.QueryRow(
		context.Background(),
		`SELECT count(*) FROM chat_message WHERE chat_session_id = $1`,
		sessionID,
	).Scan(&messageCount); err != nil {
		t.Fatalf("count chat messages: %v", err)
	}
	if messageCount != 0 {
		t.Fatalf("expected 0 chat messages after withdraw, got %d", messageCount)
	}

	sessionPtr, workDirPtr, runtimePtr := chatSessionResumePointer(t, sessionID)
	if sessionPtr != nil || workDirPtr != nil || runtimePtr != nil {
		t.Fatalf("expected cleared resume pointer, got session=%v workdir=%v runtime=%v", sessionPtr, workDirPtr, runtimePtr)
	}
}

func TestRegenerateLastChatMessage_RewindsToPreviousTurnAndEnqueuesTask(t *testing.T) {
	agentID := createHandlerTestAgent(t, "ChatRegenerateAgent", []byte("[]"))
	sessionID := createHandlerTestChatSession(t, agentID)

	first := sendChatMessageForTest(t, sessionID, "first prompt")
	completeChatTaskForTest(t, first.TaskID, "first answer", "chat-session-1", "/tmp/chat-session-1")

	second := sendChatMessageForTest(t, sessionID, "second prompt")
	completeChatTaskForTest(t, second.TaskID, "second answer", "chat-session-2", "/tmp/chat-session-2")

	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/messages/regenerate-last", nil)
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.RegenerateLastChatMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("RegenerateLastChatMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp SendChatMessageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode regenerate response: %v", err)
	}
	if resp.TaskID == "" {
		t.Fatal("expected regenerate to enqueue a new task")
	}

	messages, err := testHandler.Queries.ListChatMessages(context.Background(), parseUUID(sessionID))
	if err != nil {
		t.Fatalf("list chat messages: %v", err)
	}
	if len(messages) != 3 {
		t.Fatalf("expected 3 messages after regenerate, got %d", len(messages))
	}
	if messages[0].Role != "user" || messages[1].Role != "assistant" || messages[2].Role != "user" {
		t.Fatalf("unexpected message roles after regenerate: %s, %s, %s", messages[0].Role, messages[1].Role, messages[2].Role)
	}
	if messages[2].Content != "second prompt" {
		t.Fatalf("expected latest user prompt to remain, got %q", messages[2].Content)
	}

	sessionPtr, workDirPtr, _ := chatSessionResumePointer(t, sessionID)
	if sessionPtr == nil || *sessionPtr != "chat-session-1" {
		t.Fatalf("expected resume session chat-session-1, got %v", sessionPtr)
	}
	if workDirPtr == nil || *workDirPtr != "/tmp/chat-session-1" {
		t.Fatalf("expected resume workdir /tmp/chat-session-1, got %v", workDirPtr)
	}

	pending, err := testHandler.Queries.GetPendingChatTask(context.Background(), parseUUID(sessionID))
	if err != nil {
		t.Fatalf("load pending chat task: %v", err)
	}
	if uuidToString(pending.ID) != resp.TaskID {
		t.Fatalf("pending task mismatch: want %s, got %s", resp.TaskID, uuidToString(pending.ID))
	}
}

func TestResendLastChatMessage_RecreatesUserMessageAndClonesAttachments(t *testing.T) {
	origStorage := testHandler.Storage
	testHandler.Storage = &mockStorage{}
	defer func() { testHandler.Storage = origStorage }()

	agentID := createHandlerTestAgent(t, "ChatResendAgent", []byte("[]"))
	sessionID := createHandlerTestChatSession(t, agentID)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "resend.png")
	part.Write([]byte("\x89PNG\r\n\x1a\nresend"))
	writer.WriteField("chat_session_id", sessionID)
	writer.Close()

	uploadReq := httptest.NewRequest("POST", "/api/upload-file", &body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadReq.Header.Set("X-User-ID", testUserID)
	uploadReq.Header.Set("X-Workspace-ID", testWorkspaceID)
	uploadW := httptest.NewRecorder()
	testHandler.UploadFile(uploadW, uploadReq)
	if uploadW.Code != http.StatusOK {
		t.Fatalf("upload attachment: expected 200, got %d: %s", uploadW.Code, uploadW.Body.String())
	}

	var uploadResp AttachmentResponse
	if err := json.Unmarshal(uploadW.Body.Bytes(), &uploadResp); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}

	content := "look ![](" + uploadResp.URL + ")"
	sendResp := sendChatMessageForTest(t, sessionID, content, uploadResp.ID)
	completeChatTaskForTest(t, sendResp.TaskID, "done", "chat-session-attach", "/tmp/chat-session-attach")

	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/messages/resend-last", nil)
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.ResendLastChatMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("ResendLastChatMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp SendChatMessageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode resend response: %v", err)
	}

	messages, err := testHandler.Queries.ListChatMessages(context.Background(), parseUUID(sessionID))
	if err != nil {
		t.Fatalf("list chat messages: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 message after resend, got %d", len(messages))
	}
	if uuidToString(messages[0].ID) != resp.MessageID {
		t.Fatalf("expected recreated user message %s, got %s", resp.MessageID, uuidToString(messages[0].ID))
	}
	if messages[0].Content != content {
		t.Fatalf("expected resent content %q, got %q", content, messages[0].Content)
	}

	var oldAttachmentCount int
	if err := testPool.QueryRow(
		context.Background(),
		`SELECT count(*) FROM attachment WHERE id = $1`,
		uploadResp.ID,
	).Scan(&oldAttachmentCount); err != nil {
		t.Fatalf("count old attachment: %v", err)
	}
	if oldAttachmentCount != 0 {
		t.Fatalf("expected original attachment row to be deleted, got %d", oldAttachmentCount)
	}

	attachments, err := testHandler.Queries.ListAttachmentsByChatMessage(context.Background(), db.ListAttachmentsByChatMessageParams{
		ChatMessageID: parseUUID(resp.MessageID),
		WorkspaceID:   parseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("load resent attachments: %v", err)
	}
	if len(attachments) != 1 {
		t.Fatalf("expected 1 resent attachment, got %d", len(attachments))
	}
	if uuidToString(attachments[0].ID) == uploadResp.ID {
		t.Fatal("expected resent attachment to have a new row id")
	}
	if attachments[0].Url != uploadResp.URL {
		t.Fatalf("expected attachment url %q, got %q", uploadResp.URL, attachments[0].Url)
	}
}
