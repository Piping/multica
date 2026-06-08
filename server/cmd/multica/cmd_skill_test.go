package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

func newSkillUploadTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "upload"}
	cmd.Flags().String("profile", "", "")
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	cmd.Flags().Bool("update", true, "")
	cmd.Flags().Bool("include-hidden", false, "")
	cmd.Flags().Bool("skip-binary", true, "")
	cmd.Flags().String("output", "json", "")
	return cmd
}

func TestReadLocalSkillDirectory(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "SKILL.md"), `---
name: example-skill
description: Example description
---

# Example
`)
	mustWriteFile(t, filepath.Join(dir, "references", "guide.md"), "guide\n")
	mustWriteFile(t, filepath.Join(dir, "scripts", "tool.py"), "print('ok')\n")
	mustWriteFile(t, filepath.Join(dir, "assets", "icon.svg"), "<svg></svg>\n")
	mustWriteFile(t, filepath.Join(dir, "assets", "icon.png"), string([]byte{0x89, 0x50, 0x4e, 0x47}))
	mustWriteFile(t, filepath.Join(dir, "__pycache__", "tool.pyc"), string([]byte{0x00, 0x01}))

	got, err := readLocalSkillDirectory(dir, skillUploadOptions{
		IncludeHidden: false,
		SkipBinary:    true,
	})
	if err != nil {
		t.Fatalf("readLocalSkillDirectory: %v", err)
	}
	if got.Name != "example-skill" {
		t.Fatalf("name = %q, want example-skill", got.Name)
	}
	if got.Description != "Example description" {
		t.Fatalf("description = %q, want Example description", got.Description)
	}

	var paths []string
	for _, f := range got.Files {
		paths = append(paths, f.Path)
	}
	sort.Strings(paths)
	want := []string{"assets/icon.svg", "references/guide.md", "scripts/tool.py"}
	if strings.Join(paths, ",") != strings.Join(want, ",") {
		t.Fatalf("paths = %v, want %v", paths, want)
	}
	if len(got.Skipped) != 1 || got.Skipped[0] != "assets/icon.png" {
		t.Fatalf("skipped = %v, want [assets/icon.png]", got.Skipped)
	}
}

func TestRunSkillUploadCreateAndUpdate(t *testing.T) {
	makeSkillDir := func(t *testing.T, name, description string) string {
		t.Helper()
		dir := t.TempDir()
		mustWriteFile(t, filepath.Join(dir, "SKILL.md"), `---
name: `+name+`
description: `+description+`
---

# `+name+`
`)
		mustWriteFile(t, filepath.Join(dir, "references", "guide.md"), "reference body\n")
		mustWriteFile(t, filepath.Join(dir, "agents", "openai.yaml"), "interface:\n  display_name: test\n")
		return dir
	}

	t.Run("creates new skill and uploads files", func(t *testing.T) {
		var createdBody map[string]any
		fileBodies := map[string]map[string]any{}
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/api/skills":
				json.NewEncoder(w).Encode([]map[string]any{})
			case r.Method == http.MethodPost && r.URL.Path == "/api/skills":
				if err := json.NewDecoder(r.Body).Decode(&createdBody); err != nil {
					t.Fatalf("decode create body: %v", err)
				}
				json.NewEncoder(w).Encode(map[string]any{
					"id":   "skill-1",
					"name": createdBody["name"],
				})
			case r.Method == http.MethodPut && r.URL.Path == "/api/skills/skill-1/files":
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatalf("decode file body: %v", err)
				}
				fileBodies[body["path"].(string)] = body
				json.NewEncoder(w).Encode(map[string]any{"id": "file-1", "path": body["path"]})
			default:
				http.NotFound(w, r)
			}
		}))
		defer srv.Close()

		cmd := newSkillUploadTestCmd()
		_ = cmd.Flags().Set("server-url", srv.URL)
		_ = cmd.Flags().Set("workspace-id", "ws-1")
		t.Setenv("MULTICA_TOKEN", "tok")

		dir := makeSkillDir(t, "upload-skill", "Create path")
		if err := runSkillUpload(cmd, []string{dir}); err != nil {
			t.Fatalf("runSkillUpload: %v", err)
		}

		if createdBody["name"] != "upload-skill" {
			t.Fatalf("created name = %v", createdBody["name"])
		}
		if len(fileBodies) != 2 {
			t.Fatalf("uploaded %d file bodies, want 2", len(fileBodies))
		}
		if _, ok := fileBodies["references/guide.md"]; !ok {
			t.Fatalf("missing references/guide.md upload: %v", fileBodies)
		}
		if _, ok := fileBodies["agents/openai.yaml"]; !ok {
			t.Fatalf("missing agents/openai.yaml upload: %v", fileBodies)
		}
	})

	t.Run("updates existing skill when names match", func(t *testing.T) {
		var updatedBody map[string]any
		var putCount int
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/api/skills":
				json.NewEncoder(w).Encode([]map[string]any{
					{"id": "skill-existing", "name": "upload-skill"},
				})
			case r.Method == http.MethodPut && r.URL.Path == "/api/skills/skill-existing":
				putCount++
				if err := json.NewDecoder(r.Body).Decode(&updatedBody); err != nil {
					t.Fatalf("decode update body: %v", err)
				}
				json.NewEncoder(w).Encode(map[string]any{
					"id":   "skill-existing",
					"name": updatedBody["name"],
				})
			case r.Method == http.MethodPut && r.URL.Path == "/api/skills/skill-existing/files":
				putCount++
				json.NewEncoder(w).Encode(map[string]any{"id": "file-1"})
			default:
				http.NotFound(w, r)
			}
		}))
		defer srv.Close()

		cmd := newSkillUploadTestCmd()
		_ = cmd.Flags().Set("server-url", srv.URL)
		_ = cmd.Flags().Set("workspace-id", "ws-1")
		t.Setenv("MULTICA_TOKEN", "tok")

		dir := makeSkillDir(t, "upload-skill", "Update path")
		if err := runSkillUpload(cmd, []string{dir}); err != nil {
			t.Fatalf("runSkillUpload: %v", err)
		}

		if updatedBody["description"] != "Update path" {
			t.Fatalf("updated description = %v, want Update path", updatedBody["description"])
		}
		if putCount != 3 {
			t.Fatalf("putCount = %d, want 3 (skill update + 2 files)", putCount)
		}
	})
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestRunSkillUploadRequiresWorkspace(t *testing.T) {
	cmd := newSkillUploadTestCmd()
	t.Setenv("HOME", t.TempDir())
	_ = cli.SaveCLIConfig(cli.CLIConfig{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	_ = cmd.Flags().Set("server-url", srv.URL)

	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "SKILL.md"), "# no frontmatter\n")
	err := runSkillUpload(cmd, []string{dir})
	if err == nil {
		t.Fatal("expected workspace error, got nil")
	}
	if !strings.Contains(err.Error(), "workspace_id is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}
