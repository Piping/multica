package daemon

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// freshDaemon builds a Daemon with every map field the production New() seeds
// so callers can exercise handleRuntimeGone without going through Run.
func freshDaemon(serverURL string) *Daemon {
	return &Daemon{
		client:                NewClient(serverURL),
		logger:                slog.New(slog.NewTextHandler(testNopWriter{}, &slog.HandlerOptions{Level: slog.LevelWarn})),
		workspaces:            make(map[string]*workspaceState),
		runtimeIndex:          make(map[string]Runtime),
		runtimeSet:            newRuntimeSetWatcher(),
		agentVersions:         make(map[string]string),
		wsHBLastAck:           make(map[string]time.Time),
		activeEnvRoots:        make(map[string]int),
		runtimeGoneInflight:   make(map[string]struct{}),
		reregisterNextAttempt: make(map[string]time.Time),
	}
}

// testNopWriter discards log output so tests don't spam stderr.
type testNopWriter struct{}

func (testNopWriter) Write(p []byte) (int, error) { return len(p), nil }

// stubAgentVersion swaps out the agent version probes that registerRuntimesForWorkspace
// would normally shell out for, and restores the production hooks on cleanup.
// Returns a no-op cleanup so callers can use t.Cleanup directly.
func stubAgentVersion(t *testing.T) func() {
	t.Helper()
	origDetect := detectAgentVersion
	origCheck := checkAgentMinVersion
	detectAgentVersion = func(_ context.Context, _ string) (string, error) {
		return "9.9.9", nil
	}
	checkAgentMinVersion = func(_, _ string) error { return nil }
	return func() {
		detectAgentVersion = origDetect
		checkAgentMinVersion = origCheck
	}
}

func TestRemoveStaleRuntime_PrunesAllLocalState(t *testing.T) {
	t.Parallel()

	d := freshDaemon("")
	ws := &workspaceState{
		workspaceID: "ws-1",
		runtimeIDs:  []string{"rt-1", "rt-2", "rt-3"},
	}
	d.workspaces["ws-1"] = ws
	d.runtimeIndex["rt-1"] = Runtime{ID: "rt-1"}
	d.runtimeIndex["rt-2"] = Runtime{ID: "rt-2"}
	d.runtimeIndex["rt-3"] = Runtime{ID: "rt-3"}
	d.wsHBLastAck["rt-2"] = time.Now()

	workspaceID, removed := d.removeStaleRuntime("rt-2")
	if !removed {
		t.Fatalf("removeStaleRuntime: removed=false, want true")
	}
	if workspaceID != "ws-1" {
		t.Fatalf("workspaceID = %q, want ws-1", workspaceID)
	}
	if got := ws.runtimeIDs; len(got) != 2 || got[0] != "rt-1" || got[1] != "rt-3" {
		t.Fatalf("runtimeIDs = %v, want [rt-1 rt-3]", got)
	}
	if _, ok := d.runtimeIndex["rt-2"]; ok {
		t.Fatalf("runtimeIndex still contains rt-2")
	}
	if _, ok := d.wsHBLastAck["rt-2"]; ok {
		t.Fatalf("wsHBLastAck still contains rt-2")
	}
}

func TestRemoveStaleRuntime_UnknownRuntimeIsNoop(t *testing.T) {
	t.Parallel()

	d := freshDaemon("")
	d.workspaces["ws-1"] = &workspaceState{workspaceID: "ws-1", runtimeIDs: []string{"rt-1"}}
	d.runtimeIndex["rt-1"] = Runtime{ID: "rt-1"}

	workspaceID, removed := d.removeStaleRuntime("rt-unknown")
	if removed {
		t.Fatalf("removeStaleRuntime: removed=true for unknown id, want false")
	}
	if workspaceID != "" {
		t.Fatalf("workspaceID = %q for unknown id, want empty", workspaceID)
	}
	if got := d.workspaces["ws-1"].runtimeIDs; len(got) != 1 {
		t.Fatalf("unrelated workspace runtimeIDs mutated: %v", got)
	}
}

func TestRemoveStaleRuntime_PreservesWorkspaceStatePointer(t *testing.T) {
	t.Parallel()

	// The Daemon contract is that workspaceState pointers must NEVER be
	// replaced — only fields mutated — because ensureRepoReady holds a long
	// repoRefreshMu through repo syncs. Regressing this turns concurrent
	// repo refreshes into a deadlock against the wrong mutex copy. Guard it
	// here so the invariant is observable in tests.
	d := freshDaemon("")
	original := &workspaceState{workspaceID: "ws-1", runtimeIDs: []string{"rt-1"}}
	d.workspaces["ws-1"] = original
	d.runtimeIndex["rt-1"] = Runtime{ID: "rt-1"}

	d.removeStaleRuntime("rt-1")

	if d.workspaces["ws-1"] != original {
		t.Fatalf("workspaceState pointer was replaced; ensureRepoReady's mutex assumption broken")
	}
}

// handleRuntimeGoneFixture wires up a Daemon against a fake server that
// answers register/recover-orphans. registerCount is incremented exactly
// once per /api/daemon/register call so tests can assert on coalescing.
type handleRuntimeGoneFixture struct {
	daemon        *Daemon
	server        *httptest.Server
	registerCount *atomic.Int64
}

func newHandleRuntimeGoneFixture(t *testing.T) *handleRuntimeGoneFixture {
	t.Helper()

	var registerCount atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/daemon/register":
			registerCount.Add(1)
			// Each register call returns the same fresh runtime ID so
			// downstream assertions can observe it.
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(RegisterResponse{
				Runtimes: []Runtime{{ID: "rt-new", Name: "Claude", Provider: "claude", Status: "online"}},
				Repos:    []RepoData{},
			})
		case strings.HasSuffix(r.URL.Path, "/recover-orphans"):
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(srv.Close)

	d := freshDaemon(srv.URL)
	// Attach a single configured agent so registerRuntimesForWorkspace would
	// produce a non-empty request body. The fake server ignores the body,
	// but the registerRuntimesForWorkspace pre-flight (DetectVersion) would
	// otherwise reject the call.
	d.cfg.Agents = map[string]AgentEntry{"claude": {Path: "/usr/bin/true"}}
	// Replace the agent version probe so the test doesn't shell out.
	t.Cleanup(stubAgentVersion(t))
	return &handleRuntimeGoneFixture{daemon: d, server: srv, registerCount: &registerCount}
}

func TestHandleRuntimeGone_PrunesAndReregisters(t *testing.T) {
	// Not t.Parallel: stubAgentVersion mutates package-level vars used by
	// registerRuntimesForWorkspace. Other Parallel tests in this file that
	// don't exercise registration are still parallel-safe.
	fx := newHandleRuntimeGoneFixture(t)
	d := fx.daemon
	d.workspaces["ws-1"] = &workspaceState{workspaceID: "ws-1", runtimeIDs: []string{"rt-old"}}
	d.runtimeIndex["rt-old"] = Runtime{ID: "rt-old"}
	d.wsHBLastAck["rt-old"] = time.Now()

	d.handleRuntimeGone(context.Background(), "rt-old")

	if got := d.runtimeIndex["rt-old"]; got.ID != "" {
		t.Fatalf("rt-old still present in runtimeIndex: %+v", got)
	}
	if _, ok := d.runtimeIndex["rt-new"]; !ok {
		t.Fatalf("rt-new not added to runtimeIndex after re-register")
	}
	if got := d.workspaces["ws-1"].runtimeIDs; len(got) != 1 || got[0] != "rt-new" {
		t.Fatalf("workspace runtimeIDs after recovery = %v, want [rt-new]", got)
	}
	if _, ok := d.wsHBLastAck["rt-old"]; ok {
		t.Fatalf("wsHBLastAck not cleared for rt-old")
	}
	if got := fx.registerCount.Load(); got != 1 {
		t.Fatalf("register endpoint called %d times, want 1", got)
	}
}

func TestHandleRuntimeGone_CoalescesConcurrentCallers(t *testing.T) {
	// Not t.Parallel — stubAgentVersion via newHandleRuntimeGoneFixture.
	// Three goroutines (heartbeat, poller, WS) may each detect the same
	// stale runtime within the same beat. Exactly one re-register must
	// reach the server.
	fx := newHandleRuntimeGoneFixture(t)
	d := fx.daemon
	d.workspaces["ws-1"] = &workspaceState{
		workspaceID: "ws-1",
		runtimeIDs:  []string{"rt-a", "rt-b", "rt-c"},
	}
	d.runtimeIndex["rt-a"] = Runtime{ID: "rt-a"}
	d.runtimeIndex["rt-b"] = Runtime{ID: "rt-b"}
	d.runtimeIndex["rt-c"] = Runtime{ID: "rt-c"}

	var wg sync.WaitGroup
	for _, rid := range []string{"rt-a", "rt-b", "rt-c"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			d.handleRuntimeGone(context.Background(), id)
		}(rid)
	}
	wg.Wait()

	if got := fx.registerCount.Load(); got != 1 {
		t.Fatalf("register endpoint called %d times under stampede, want 1", got)
	}
	if got := d.workspaces["ws-1"].runtimeIDs; len(got) != 1 || got[0] != "rt-new" {
		t.Fatalf("workspace runtimeIDs after stampede = %v, want [rt-new]", got)
	}
}

func TestHandleRuntimeGone_BackoffOnFailure(t *testing.T) {
	// Not t.Parallel — stubAgentVersion.
	// Failure path: the register endpoint returns 500 — exactly one attempt
	// should make the round trip; subsequent immediate calls must be
	// short-circuited by the failure backoff. This is the "don't replace
	// log spam with register spam" guarantee.
	var registerCount atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/daemon/register" {
			registerCount.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	d := freshDaemon(srv.URL)
	d.cfg.Agents = map[string]AgentEntry{"claude": {Path: "/usr/bin/true"}}
	t.Cleanup(stubAgentVersion(t))

	d.workspaces["ws-1"] = &workspaceState{workspaceID: "ws-1", runtimeIDs: []string{"rt-1", "rt-2"}}
	d.runtimeIndex["rt-1"] = Runtime{ID: "rt-1"}
	d.runtimeIndex["rt-2"] = Runtime{ID: "rt-2"}

	d.handleRuntimeGone(context.Background(), "rt-1")
	d.handleRuntimeGone(context.Background(), "rt-2")

	if got := registerCount.Load(); got != 1 {
		t.Fatalf("register endpoint called %d times on failure path, want 1 (second call should be coalesced)", got)
	}
	// Local state pruning still happened for both, even though re-register
	// failed: the workspace is now empty, which workspaceSyncLoop will
	// retry on the next tick.
	if got := d.workspaces["ws-1"].runtimeIDs; len(got) != 0 {
		t.Fatalf("workspace runtimeIDs after failed recovery = %v, want []", got)
	}
}

func TestHandleWSHeartbeatAck_RuntimeGoneTriggersRecovery(t *testing.T) {
	// The WS path's twin of an HTTP 404 "runtime not found". When the server
	// flags a runtime as gone, the daemon must NOT record a freshness mark
	// — doing so would tell the HTTP heartbeat to skip its tick and let the
	// daemon keep believing the runtime is alive.
	fx := newHandleRuntimeGoneFixture(t)
	d := fx.daemon
	d.workspaces["ws-1"] = &workspaceState{workspaceID: "ws-1", runtimeIDs: []string{"rt-old"}}
	d.runtimeIndex["rt-old"] = Runtime{ID: "rt-old"}
	d.wsHBLastAck["rt-old"] = time.Now()

	d.handleWSHeartbeatAck(context.Background(), &HeartbeatResponse{
		RuntimeID:   "rt-old",
		Status:      "runtime_gone",
		RuntimeGone: true,
	})

	// handleRuntimeGone is fired asynchronously via `go`; spin briefly.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		d.mu.Lock()
		_, stillOld := d.runtimeIndex["rt-old"]
		_, gotNew := d.runtimeIndex["rt-new"]
		d.mu.Unlock()
		if !stillOld && gotNew {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if _, stillOld := d.runtimeIndex["rt-old"]; stillOld {
		t.Fatalf("rt-old not pruned after RuntimeGone ack")
	}
	if _, ok := d.wsHBLastAck["rt-old"]; ok {
		t.Fatalf("WS freshness mark not cleared for gone runtime — HTTP heartbeat would skip its tick")
	}
}

func TestHandleWSHeartbeatAck_NormalAckRecordsFreshness(t *testing.T) {
	t.Parallel()

	d := freshDaemon("")
	d.handleWSHeartbeatAck(context.Background(), &HeartbeatResponse{
		RuntimeID: "rt-1",
		Status:    "ok",
	})
	if !d.wsHeartbeatRecentlyAcked("rt-1") {
		t.Fatalf("normal ack should record WS freshness for rt-1")
	}
}

func TestHandleWSHeartbeatAck_EmptyAckIgnored(t *testing.T) {
	t.Parallel()

	d := freshDaemon("")
	d.handleWSHeartbeatAck(context.Background(), nil)
	d.handleWSHeartbeatAck(context.Background(), &HeartbeatResponse{RuntimeID: ""})
	// Should not panic, should not record any state.
	if len(d.wsHBLastAck) != 0 {
		t.Fatalf("empty ack recorded state: %v", d.wsHBLastAck)
	}
}

func TestWorkspaceNeedsRuntimeRecovery(t *testing.T) {
	t.Parallel()

	d := freshDaemon("")
	d.workspaces["ws-empty"] = &workspaceState{workspaceID: "ws-empty"}
	d.workspaces["ws-full"] = &workspaceState{workspaceID: "ws-full", runtimeIDs: []string{"rt-1"}}

	if !d.workspaceNeedsRuntimeRecovery("ws-empty") {
		t.Fatalf("ws-empty should need recovery")
	}
	if d.workspaceNeedsRuntimeRecovery("ws-full") {
		t.Fatalf("ws-full should NOT need recovery")
	}
	if d.workspaceNeedsRuntimeRecovery("ws-unknown") {
		t.Fatalf("untracked workspace should NOT need recovery")
	}
}
