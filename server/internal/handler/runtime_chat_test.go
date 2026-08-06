package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
			  AND system_key = 'runtime_default'
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
	if created.RuntimeDirect {
		t.Fatal("runtime_direct = true, want a normal Agent-backed session")
	}

	var kind, systemKey, instructions string
	if err := testPool.QueryRow(context.Background(), `
		SELECT kind, system_key, instructions
		FROM agent
		WHERE id = $1
	`, created.AgentID).Scan(&kind, &systemKey, &instructions); err != nil {
		t.Fatalf("load runtime default agent: %v", err)
	}
	if kind != "user" || systemKey != "runtime_default" || instructions != "" {
		t.Fatalf("unexpected vanilla agent kind=%q system_key=%q instructions=%q", kind, systemKey, instructions)
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
		if session.RuntimeDirect {
			t.Fatal("listed vanilla Agent session was marked runtime_direct")
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
		if response.RuntimeDirect {
			t.Fatalf("%s: runtime_direct = true, want false", name)
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
	foundAgent := false
	for _, agent := range agents {
		if agent.ID != created.AgentID {
			continue
		}
		foundAgent = true
		if !agent.RuntimeManaged {
			t.Fatal("runtime vanilla Agent is not marked runtime_managed")
		}
		if agent.Instructions != "" || len(agent.Skills) != 0 || agent.Model != "" {
			t.Fatalf("runtime vanilla Agent has custom context: %+v", agent)
		}
	}
	if !foundAgent {
		t.Fatal("runtime vanilla Agent missing from user-facing Agent list")
	}

	updateW := httptest.NewRecorder()
	updateReq := withURLParams(
		newRequest(http.MethodPut, "/api/agents/"+created.AgentID, map[string]any{
			"instructions": "inject context",
		}),
		"id",
		created.AgentID,
	)
	testHandler.UpdateAgent(updateW, updateReq)
	if updateW.Code != http.StatusConflict {
		t.Fatalf("UpdateAgent(runtime-managed): expected 409, got %d: %s", updateW.Code, updateW.Body.String())
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
		t.Fatalf("count runtime default agent: %v", err)
	}
	if remaining != 1 {
		t.Fatal("deleting a chat session removed its reusable runtime Agent")
	}
}
