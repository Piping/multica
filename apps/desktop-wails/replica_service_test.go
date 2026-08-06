package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

func TestReplicaServiceMigratesAndPersists(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "replica.sqlite3")
	service := openTestReplica(t, path)
	if err := service.Put(
		"user-1",
		"workspace-1",
		"issue-list",
		`["issues","workspace-1","list",{}]`,
		`{"byStatus":{"todo":{"issues":[],"total":0}}}`,
		42,
	); err != nil {
		t.Fatal(err)
	}
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		info, err := os.Stat(candidate)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode = %o, want 600", candidate, info.Mode().Perm())
		}
	}
	if err := service.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}

	reopened := openTestReplica(t, path)
	entries, err := reopened.Load("user-1", "workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].QueryHash != "issue-list" {
		t.Fatalf("unexpected entries: %#v", entries)
	}
	if entries[0].UpdatedAt != 42 {
		t.Fatalf("updatedAt = %d, want 42", entries[0].UpdatedAt)
	}

	var version int
	if err := reopened.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != replicaSchemaVersion {
		t.Fatalf("schema version = %d, want %d", version, replicaSchemaVersion)
	}
}

func TestReplicaServiceMigratesVersionOneToBootstrapSchema(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "replica.sqlite3")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE replica_entries (
			user_id TEXT NOT NULL,
			workspace_id TEXT NOT NULL,
			query_hash TEXT NOT NULL,
			query_key_json TEXT NOT NULL,
			data_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, workspace_id, query_hash)
		) WITHOUT ROWID
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 1`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	service := openTestReplica(t, path)
	tokenHash := strings.Repeat("a", 64)
	if err := service.PutBootstrap(
		tokenHash,
		`{"id":"user-1"}`,
		`[{"id":"workspace-1"}]`,
		42,
	); err != nil {
		t.Fatal(err)
	}
	bootstrap, err := service.LoadBootstrap(tokenHash)
	if err != nil {
		t.Fatal(err)
	}
	if bootstrap == nil || bootstrap.UpdatedAt != 42 {
		t.Fatalf("unexpected bootstrap after v1 migration: %#v", bootstrap)
	}
}

func TestReplicaServiceIsolatesUsersAndWorkspaces(t *testing.T) {
	t.Parallel()

	service := openTestReplica(t, filepath.Join(t.TempDir(), "replica.sqlite3"))
	for _, scope := range []struct {
		userID      string
		workspaceID string
		data        string
	}{
		{"user-1", "workspace-1", `["u1-w1"]`},
		{"user-1", "workspace-2", `["u1-w2"]`},
		{"user-2", "workspace-1", `["u2-w1"]`},
	} {
		if err := service.Put(
			scope.userID,
			scope.workspaceID,
			"sessions",
			`["chat","workspace-1","sessions"]`,
			scope.data,
			1,
		); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := service.Load("user-1", "workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].DataJSON != `["u1-w1"]` {
		t.Fatalf("unexpected scoped entries: %#v", entries)
	}

	if err := service.ClearUser("user-1"); err != nil {
		t.Fatal(err)
	}
	entries, err = service.Load("user-2", "workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].DataJSON != `["u2-w1"]` {
		t.Fatalf("clearing user-1 affected user-2: %#v", entries)
	}
}

func TestReplicaServiceUpsertRejectsOlderStateAndDeletes(t *testing.T) {
	t.Parallel()

	service := openTestReplica(t, filepath.Join(t.TempDir(), "replica.sqlite3"))
	put := func(data string, updatedAt int64) {
		t.Helper()
		if err := service.Put(
			"user-1",
			"workspace-1",
			"sessions",
			`["chat","workspace-1","sessions"]`,
			data,
			updatedAt,
		); err != nil {
			t.Fatal(err)
		}
	}
	put(`[{"title":"new"}]`, 20)
	put(`[{"title":"old"}]`, 10)

	entries, err := service.Load("user-1", "workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].DataJSON != `[{"title":"new"}]` {
		t.Fatalf("older state replaced newer state: %#v", entries)
	}

	if err := service.Delete("user-1", "workspace-1", "sessions"); err != nil {
		t.Fatal(err)
	}
	entries, err = service.Load("user-1", "workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("deleted entry still loaded: %#v", entries)
	}
}

func TestReplicaServiceRejectsInvalidJSON(t *testing.T) {
	t.Parallel()

	service := openTestReplica(t, filepath.Join(t.TempDir(), "replica.sqlite3"))
	if err := service.Put(
		"user-1",
		"workspace-1",
		"sessions",
		`["chat"]`,
		`not-json`,
		1,
	); err == nil {
		t.Fatal("Put accepted invalid JSON")
	}
	entries, err := service.Load("user-1", "workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("invalid entry was persisted: %#v", entries)
	}
}

func TestReplicaServiceDropsCorruptRowsWhileLoading(t *testing.T) {
	t.Parallel()

	service := openTestReplica(t, filepath.Join(t.TempDir(), "replica.sqlite3"))
	if err := service.Put(
		"user-1",
		"workspace-1",
		"valid",
		`["chat","workspace-1","sessions"]`,
		`[]`,
		1,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		INSERT INTO replica_entries (
			user_id,
			workspace_id,
			query_hash,
			query_key_json,
			data_json,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?)
	`, "user-1", "workspace-1", "corrupt", `["chat"]`, `{`, 2); err != nil {
		t.Fatal(err)
	}

	entries, err := service.Load("user-1", "workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].QueryHash != "valid" {
		t.Fatalf("unexpected entries after corrupt-row cleanup: %#v", entries)
	}

	var count int
	if err := service.db.QueryRow(
		`SELECT COUNT(*) FROM replica_entries WHERE query_hash = 'corrupt'`,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("corrupt row was not removed")
	}
}

func TestReplicaServiceBootstrapIsolationUpsertAndDelete(t *testing.T) {
	t.Parallel()

	service := openTestReplica(t, filepath.Join(t.TempDir(), "replica.sqlite3"))
	firstHash := strings.Repeat("1", 64)
	secondHash := strings.Repeat("2", 64)

	if err := service.PutBootstrap(
		firstHash,
		`{"id":"new-user"}`,
		`[{"id":"new-workspace"}]`,
		20,
	); err != nil {
		t.Fatal(err)
	}
	if err := service.PutBootstrap(
		firstHash,
		`{"id":"old-user"}`,
		`[{"id":"old-workspace"}]`,
		10,
	); err != nil {
		t.Fatal(err)
	}
	if err := service.PutBootstrap(
		secondHash,
		`{"id":"other-user"}`,
		`[]`,
		30,
	); err != nil {
		t.Fatal(err)
	}

	first, err := service.LoadBootstrap(firstHash)
	if err != nil {
		t.Fatal(err)
	}
	if first == nil || first.UserJSON != `{"id":"new-user"}` {
		t.Fatalf("older bootstrap replaced newer state: %#v", first)
	}
	second, err := service.LoadBootstrap(secondHash)
	if err != nil {
		t.Fatal(err)
	}
	if second == nil || second.UserJSON != `{"id":"other-user"}` {
		t.Fatalf("token bootstrap scopes leaked: %#v", second)
	}

	if err := service.DeleteBootstrap(firstHash); err != nil {
		t.Fatal(err)
	}
	first, err = service.LoadBootstrap(firstHash)
	if err != nil {
		t.Fatal(err)
	}
	if first != nil {
		t.Fatalf("deleted bootstrap still loaded: %#v", first)
	}
	second, err = service.LoadBootstrap(secondHash)
	if err != nil {
		t.Fatal(err)
	}
	if second == nil {
		t.Fatal("deleting first token removed second token bootstrap")
	}
}

func TestReplicaServiceDropsCorruptBootstrapWhileLoading(t *testing.T) {
	t.Parallel()

	service := openTestReplica(t, filepath.Join(t.TempDir(), "replica.sqlite3"))
	tokenHash := strings.Repeat("c", 64)
	if _, err := service.db.Exec(`
		INSERT INTO startup_bootstrap (
			token_hash,
			user_json,
			workspaces_json,
			updated_at
		) VALUES (?, ?, ?, ?)
	`, tokenHash, `{`, `[]`, 1); err != nil {
		t.Fatal(err)
	}

	bootstrap, err := service.LoadBootstrap(tokenHash)
	if err != nil {
		t.Fatal(err)
	}
	if bootstrap != nil {
		t.Fatalf("corrupt bootstrap was returned: %#v", bootstrap)
	}

	var count int
	if err := service.db.QueryRow(
		`SELECT COUNT(*) FROM startup_bootstrap WHERE token_hash = ?`,
		tokenHash,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("corrupt bootstrap was not removed")
	}
}

func TestReplicaServiceRejectsInvalidBootstrap(t *testing.T) {
	t.Parallel()

	service := openTestReplica(t, filepath.Join(t.TempDir(), "replica.sqlite3"))
	validHash := strings.Repeat("d", 64)
	if err := service.PutBootstrap(
		"raw-token",
		`{"id":"user-1"}`,
		`[]`,
		1,
	); err == nil {
		t.Fatal("PutBootstrap accepted a raw token")
	}
	if err := service.PutBootstrap(
		validHash,
		`not-json`,
		`[]`,
		1,
	); err == nil {
		t.Fatal("PutBootstrap accepted invalid user JSON")
	}
	if _, err := service.LoadBootstrap("raw-token"); err == nil {
		t.Fatal("LoadBootstrap accepted a raw token")
	}
}

func TestReplicaServiceStartupFailureIsBestEffort(t *testing.T) {
	t.Parallel()

	service := newReplicaServiceAtPath(t.TempDir())
	if err := service.ServiceStartup(t.Context(), structServiceOptions()); err != nil {
		t.Fatalf("startup should degrade gracefully: %v", err)
	}
	if _, err := service.Load("user-1", "workspace-1"); !errors.Is(err, errReplicaUnavailable) {
		t.Fatalf("Load error = %v, want unavailable", err)
	}
}

func TestReplicaSchemaIsJSONRoundTripSafe(t *testing.T) {
	t.Parallel()

	entry := ReplicaEntry{
		QueryHash:    "hash",
		QueryKeyJSON: `["issues","workspace-1","detail","issue-1"]`,
		DataJSON:     `{"id":"issue-1"}`,
		UpdatedAt:    12,
	}
	encoded, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	var decoded ReplicaEntry
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded != entry {
		t.Fatalf("decoded entry = %#v, want %#v", decoded, entry)
	}
}

func openTestReplica(t *testing.T, path string) *ReplicaService {
	t.Helper()
	service := newReplicaServiceAtPath(path)
	if err := service.open(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.ServiceShutdown(); err != nil &&
			!errors.Is(err, sql.ErrConnDone) {
			t.Errorf("close replica: %v", err)
		}
	})
	return service
}

func structServiceOptions() application.ServiceOptions {
	return application.ServiceOptions{}
}
