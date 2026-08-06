package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

const (
	replicaSchemaVersion = 2
	maxReplicaJSONBytes  = 32 << 20
)

var errReplicaUnavailable = errors.New("local state replica is unavailable")
var tokenHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type ReplicaEntry struct {
	QueryHash    string `json:"queryHash"`
	QueryKeyJSON string `json:"queryKeyJson"`
	DataJSON     string `json:"dataJson"`
	UpdatedAt    int64  `json:"updatedAt"`
}

type ReplicaBootstrap struct {
	TokenHash      string `json:"tokenHash"`
	UserJSON       string `json:"userJson"`
	WorkspacesJSON string `json:"workspacesJson"`
	UpdatedAt      int64  `json:"updatedAt"`
}

type ReplicaService struct {
	mu     sync.RWMutex
	db     *sql.DB
	dbPath string
}

func newReplicaService() *ReplicaService {
	return &ReplicaService{}
}

func newReplicaServiceAtPath(path string) *ReplicaService {
	return &ReplicaService{dbPath: path}
}

func (s *ReplicaService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	if err := s.open(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "Multica local replica is disabled: %v\n", err)
	}
	// A read-through cache must never prevent the authoritative remote client
	// from starting.
	return nil
}

func (s *ReplicaService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

func (s *ReplicaService) Load(userID, workspaceID string) ([]ReplicaEntry, error) {
	if err := validateReplicaScope(userID, workspaceID); err != nil {
		return nil, err
	}
	db, err := s.database()
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(`
		SELECT query_hash, query_key_json, data_json, updated_at
		FROM replica_entries
		WHERE user_id = ? AND workspace_id = ?
		ORDER BY updated_at DESC, query_hash ASC
	`, userID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("load local replica: %w", err)
	}

	entries := make([]ReplicaEntry, 0)
	corruptHashes := make([]string, 0)
	for rows.Next() {
		var entry ReplicaEntry
		if err := rows.Scan(
			&entry.QueryHash,
			&entry.QueryKeyJSON,
			&entry.DataJSON,
			&entry.UpdatedAt,
		); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan local replica: %w", err)
		}
		if !json.Valid([]byte(entry.QueryKeyJSON)) ||
			!json.Valid([]byte(entry.DataJSON)) ||
			entry.UpdatedAt < 0 {
			corruptHashes = append(corruptHashes, entry.QueryHash)
			continue
		}
		entries = append(entries, entry)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close local replica rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate local replica: %w", err)
	}

	for _, queryHash := range corruptHashes {
		if _, err := db.Exec(`
			DELETE FROM replica_entries
			WHERE user_id = ? AND workspace_id = ? AND query_hash = ?
		`, userID, workspaceID, queryHash); err != nil {
			_, _ = fmt.Fprintf(
				os.Stderr,
				"Multica failed to remove corrupt replica entry %q: %v\n",
				queryHash,
				err,
			)
		}
	}
	return entries, nil
}

func (s *ReplicaService) Put(
	userID,
	workspaceID,
	queryHash,
	queryKeyJSON,
	dataJSON string,
	updatedAt int64,
) error {
	if err := validateReplicaScope(userID, workspaceID); err != nil {
		return err
	}
	if strings.TrimSpace(queryHash) == "" {
		return errors.New("query hash is required")
	}
	if len(queryKeyJSON) > maxReplicaJSONBytes || len(dataJSON) > maxReplicaJSONBytes {
		return errors.New("replica entry exceeds the size limit")
	}
	if !json.Valid([]byte(queryKeyJSON)) {
		return errors.New("query key must be valid JSON")
	}
	if !json.Valid([]byte(dataJSON)) {
		return errors.New("query data must be valid JSON")
	}
	if updatedAt < 0 {
		return errors.New("updated timestamp cannot be negative")
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO replica_entries (
			user_id,
			workspace_id,
			query_hash,
			query_key_json,
			data_json,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, workspace_id, query_hash) DO UPDATE SET
			query_key_json = excluded.query_key_json,
			data_json = excluded.data_json,
			updated_at = excluded.updated_at
		WHERE excluded.updated_at >= replica_entries.updated_at
	`, userID, workspaceID, queryHash, queryKeyJSON, dataJSON, updatedAt)
	if err != nil {
		return fmt.Errorf("write local replica: %w", err)
	}
	return nil
}

func (s *ReplicaService) Delete(userID, workspaceID, queryHash string) error {
	if err := validateReplicaScope(userID, workspaceID); err != nil {
		return err
	}
	if strings.TrimSpace(queryHash) == "" {
		return errors.New("query hash is required")
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	if _, err := db.Exec(`
		DELETE FROM replica_entries
		WHERE user_id = ? AND workspace_id = ? AND query_hash = ?
	`, userID, workspaceID, queryHash); err != nil {
		return fmt.Errorf("delete local replica entry: %w", err)
	}
	return nil
}

func (s *ReplicaService) ClearUser(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return errors.New("user ID is required")
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	if _, err := db.Exec(
		`DELETE FROM replica_entries WHERE user_id = ?`,
		userID,
	); err != nil {
		return fmt.Errorf("clear local replica user: %w", err)
	}
	return nil
}

func (s *ReplicaService) LoadBootstrap(
	tokenHash string,
) (*ReplicaBootstrap, error) {
	if err := validateTokenHash(tokenHash); err != nil {
		return nil, err
	}
	db, err := s.database()
	if err != nil {
		return nil, err
	}

	var bootstrap ReplicaBootstrap
	err = db.QueryRow(`
		SELECT token_hash, user_json, workspaces_json, updated_at
		FROM startup_bootstrap
		WHERE token_hash = ?
	`, tokenHash).Scan(
		&bootstrap.TokenHash,
		&bootstrap.UserJSON,
		&bootstrap.WorkspacesJSON,
		&bootstrap.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load startup bootstrap: %w", err)
	}
	if !json.Valid([]byte(bootstrap.UserJSON)) ||
		!json.Valid([]byte(bootstrap.WorkspacesJSON)) ||
		bootstrap.UpdatedAt < 0 {
		if deleteErr := s.DeleteBootstrap(tokenHash); deleteErr != nil {
			_, _ = fmt.Fprintf(
				os.Stderr,
				"Multica failed to remove corrupt startup bootstrap: %v\n",
				deleteErr,
			)
		}
		return nil, nil
	}
	return &bootstrap, nil
}

func (s *ReplicaService) PutBootstrap(
	tokenHash,
	userJSON,
	workspacesJSON string,
	updatedAt int64,
) error {
	if err := validateTokenHash(tokenHash); err != nil {
		return err
	}
	if len(userJSON) > maxReplicaJSONBytes ||
		len(workspacesJSON) > maxReplicaJSONBytes {
		return errors.New("startup bootstrap exceeds the size limit")
	}
	if !json.Valid([]byte(userJSON)) {
		return errors.New("bootstrap user must be valid JSON")
	}
	if !json.Valid([]byte(workspacesJSON)) {
		return errors.New("bootstrap workspaces must be valid JSON")
	}
	if updatedAt < 0 {
		return errors.New("updated timestamp cannot be negative")
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO startup_bootstrap (
			token_hash,
			user_json,
			workspaces_json,
			updated_at
		) VALUES (?, ?, ?, ?)
		ON CONFLICT(token_hash) DO UPDATE SET
			user_json = excluded.user_json,
			workspaces_json = excluded.workspaces_json,
			updated_at = excluded.updated_at
		WHERE excluded.updated_at >= startup_bootstrap.updated_at
	`, tokenHash, userJSON, workspacesJSON, updatedAt)
	if err != nil {
		return fmt.Errorf("write startup bootstrap: %w", err)
	}
	return nil
}

func (s *ReplicaService) DeleteBootstrap(tokenHash string) error {
	if err := validateTokenHash(tokenHash); err != nil {
		return err
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	if _, err := db.Exec(
		`DELETE FROM startup_bootstrap WHERE token_hash = ?`,
		tokenHash,
	); err != nil {
		return fmt.Errorf("delete startup bootstrap: %w", err)
	}
	return nil
}

func (s *ReplicaService) open() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return nil
	}

	path := s.dbPath
	if path == "" {
		var err error
		path, err = resolveReplicaPath()
		if err != nil {
			return err
		}
	}
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return fmt.Errorf("create local replica directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("open local replica: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := configureReplicaDatabase(db); err != nil {
		_ = db.Close()
		return err
	}
	if path != ":memory:" {
		if err := protectReplicaFiles(path); err != nil {
			_ = db.Close()
			return err
		}
	}
	s.dbPath = path
	s.db = db
	return nil
}

func (s *ReplicaService) database() (*sql.DB, error) {
	s.mu.RLock()
	db := s.db
	s.mu.RUnlock()
	if db == nil {
		return nil, errReplicaUnavailable
	}
	return db, nil
}

func configureReplicaDatabase(db *sql.DB) error {
	for _, statement := range []string{
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`PRAGMA synchronous = NORMAL`,
		`PRAGMA foreign_keys = OFF`,
		`PRAGMA cache_size = -8192`,
		`PRAGMA mmap_size = 0`,
	} {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("configure local replica: %w", err)
		}
	}

	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read local replica schema version: %w", err)
	}
	if version > replicaSchemaVersion {
		return fmt.Errorf(
			"local replica schema version %d is newer than supported version %d",
			version,
			replicaSchemaVersion,
		)
	}
	if version == replicaSchemaVersion {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin local replica migration: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if version < 1 {
		if _, err := tx.Exec(`
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
			return fmt.Errorf("create local replica entries: %w", err)
		}
	}
	if version < 2 {
		if _, err := tx.Exec(`
			CREATE TABLE startup_bootstrap (
				token_hash TEXT NOT NULL PRIMARY KEY,
				user_json TEXT NOT NULL,
				workspaces_json TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			) WITHOUT ROWID
		`); err != nil {
			return fmt.Errorf("create startup bootstrap: %w", err)
		}
	}
	if _, err := tx.Exec(
		fmt.Sprintf(`PRAGMA user_version = %d`, replicaSchemaVersion),
	); err != nil {
		return fmt.Errorf("set local replica schema version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit local replica migration: %w", err)
	}
	return nil
}

func validateTokenHash(tokenHash string) error {
	if !tokenHashPattern.MatchString(tokenHash) {
		return errors.New("token hash must be a lowercase SHA-256 digest")
	}
	return nil
}

func validateReplicaScope(userID, workspaceID string) error {
	if strings.TrimSpace(userID) == "" {
		return errors.New("user ID is required")
	}
	if strings.TrimSpace(workspaceID) == "" {
		return errors.New("workspace ID is required")
	}
	return nil
}

func protectReplicaFiles(path string) error {
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Chmod(candidate, 0o600); err != nil &&
			!errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("protect local replica file %q: %w", candidate, err)
		}
	}
	return nil
}

func resolveReplicaPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve local replica directory: %w", err)
	}
	return filepath.Join(configDir, "Multica", "state-replica.sqlite3"), nil
}
