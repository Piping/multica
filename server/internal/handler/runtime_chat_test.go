package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRuntimeChatSessionLifecycle(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `
			DELETE FROM agent
			WHERE workspace_id = $1
			  AND kind = 'system'
			  AND system_key LIKE 'runtime_chat:%'
		`, testWorkspaceID)
	})

	createW := httptest.NewRecorder()
	createReq := withChatTestWorkspaceCtx(t, newRequest(
		http.MethodPost,
		"/api/chat/sessions",
		map[string]any{
			"runtime_id": testRuntimeID,
			"title":      "Direct runtime session",
		},
	))
	testHandler.CreateChatSession(createW, createReq)
	if createW.Code != http.StatusCreated {
		t.Fatalf("CreateChatSession(runtime): expected 201, got %d: %s", createW.Code, createW.Body.String())
	}

	var created ChatSessionResponse
	if err := json.NewDecoder(createW.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.ID == "" || created.AgentID == "" {
		t.Fatalf("missing runtime session identifiers: %+v", created)
	}
	if created.RuntimeID == nil || *created.RuntimeID != testRuntimeID {
		t.Fatalf("runtime_id = %v, want %s", created.RuntimeID, testRuntimeID)
	}
	if !created.RuntimeDirect {
		t.Fatal("runtime_direct = false, want true")
	}

	var kind, systemKey string
	if err := testPool.QueryRow(context.Background(), `
		SELECT kind, system_key
		FROM agent
		WHERE id = $1
	`, created.AgentID).Scan(&kind, &systemKey); err != nil {
		t.Fatalf("load runtime carrier: %v", err)
	}
	if kind != "system" || !strings.HasPrefix(systemKey, "runtime_chat:") {
		t.Fatalf("unexpected carrier kind=%q system_key=%q", kind, systemKey)
	}

	listW := httptest.NewRecorder()
	testHandler.ListChatSessions(
		listW,
		withChatTestWorkspaceCtx(t, newRequest(http.MethodGet, "/api/chat/sessions", nil)),
	)
	if listW.Code != http.StatusOK {
		t.Fatalf("ListChatSessions: expected 200, got %d: %s", listW.Code, listW.Body.String())
	}
	var sessions []ChatSessionResponse
	if err := json.NewDecoder(listW.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode session list: %v", err)
	}
	found := false
	for _, session := range sessions {
		if session.ID != created.ID {
			continue
		}
		found = true
		if !session.RuntimeDirect {
			t.Fatal("listed runtime session lost runtime_direct")
		}
	}
	if !found {
		t.Fatalf("runtime session %s missing from creator list", created.ID)
	}

	assertDirectResponse := func(name string, handler func(http.ResponseWriter, *http.Request), request *http.Request, wantStatus int) {
		t.Helper()
		responseW := httptest.NewRecorder()
		handler(responseW, withChatTestWorkspaceCtx(t, withURLParams(request, "sessionId", created.ID)))
		if responseW.Code != wantStatus {
			t.Fatalf("%s: expected %d, got %d: %s", name, wantStatus, responseW.Code, responseW.Body.String())
		}
		var response ChatSessionResponse
		if err := json.NewDecoder(responseW.Body).Decode(&response); err != nil {
			t.Fatalf("%s: decode response: %v", name, err)
		}
		if !response.RuntimeDirect {
			t.Fatalf("%s: runtime_direct = false, want true", name)
		}
		if response.RuntimeID == nil || *response.RuntimeID != testRuntimeID {
			t.Fatalf("%s: runtime_id = %v, want %s", name, response.RuntimeID, testRuntimeID)
		}
	}

	assertDirectResponse(
		"GetChatSession",
		testHandler.GetChatSession,
		newRequest(http.MethodGet, "/api/chat/sessions/"+created.ID, nil),
		http.StatusOK,
	)
	assertDirectResponse(
		"UpdateChatSession",
		testHandler.UpdateChatSession,
		newRequest(http.MethodPatch, "/api/chat/sessions/"+created.ID, map[string]any{"title": "Renamed runtime session"}),
		http.StatusOK,
	)
	assertDirectResponse(
		"SetChatSessionPinned",
		testHandler.SetChatSessionPinned,
		newRequest(http.MethodPatch, "/api/chat/sessions/"+created.ID+"/pinned", map[string]any{"pinned": true}),
		http.StatusOK,
	)
	assertDirectResponse(
		"SetChatSessionArchived",
		testHandler.SetChatSessionArchived,
		newRequest(http.MethodPatch, "/api/chat/sessions/"+created.ID+"/archived", map[string]any{"archived": true}),
		http.StatusOK,
	)

	agentsW := httptest.NewRecorder()
	testHandler.ListAgents(agentsW, newRequest(http.MethodGet, "/api/agents", nil))
	if agentsW.Code != http.StatusOK {
		t.Fatalf("ListAgents: expected 200, got %d: %s", agentsW.Code, agentsW.Body.String())
	}
	var agents []AgentResponse
	if err := json.NewDecoder(agentsW.Body).Decode(&agents); err != nil {
		t.Fatalf("decode agent list: %v", err)
	}
	for _, agent := range agents {
		if agent.ID == created.AgentID {
			t.Fatal("runtime chat carrier leaked into user-facing agent list")
		}
	}

	deleteW := httptest.NewRecorder()
	deleteReq := withURLParams(
		newRequest(http.MethodDelete, "/api/chat/sessions/"+created.ID, nil),
		"sessionId",
		created.ID,
	)
	testHandler.DeleteChatSession(deleteW, withChatTestWorkspaceCtx(t, deleteReq))
	if deleteW.Code != http.StatusNoContent {
		t.Fatalf("DeleteChatSession(runtime): expected 204, got %d: %s", deleteW.Code, deleteW.Body.String())
	}

	var remaining int
	if err := testPool.QueryRow(
		context.Background(),
		`SELECT count(*) FROM agent WHERE id = $1`,
		created.AgentID,
	).Scan(&remaining); err != nil {
		t.Fatalf("count deleted carrier: %v", err)
	}
	if remaining != 0 {
		t.Fatal("runtime chat carrier survived session deletion")
	}
}
