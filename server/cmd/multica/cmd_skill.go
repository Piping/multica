package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var skillCmd = &cobra.Command{
	Use:   "skill",
	Short: "Work with skills",
}

var skillListCmd = &cobra.Command{
	Use:   "list",
	Short: "List skills in the workspace",
	RunE:  runSkillList,
}

var skillGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get skill details (includes files)",
	Args:  exactArgs(1),
	RunE:  runSkillGet,
}

var skillCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new skill",
	RunE:  runSkillCreate,
}

var skillUpdateCmd = &cobra.Command{
	Use:   "update <id>",
	Short: "Update a skill",
	Args:  exactArgs(1),
	RunE:  runSkillUpdate,
}

var skillDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a skill",
	Args:  exactArgs(1),
	RunE:  runSkillDelete,
}

var skillImportCmd = &cobra.Command{
	Use:   "import",
	Short: "Import a skill from a URL (clawhub.ai, skills.sh, or github.com)",
	RunE:  runSkillImport,
}

var skillUploadCmd = &cobra.Command{
	Use:   "upload <dir>",
	Short: "Upload a local skill directory (SKILL.md + supporting files)",
	Args:  exactArgs(1),
	RunE:  runSkillUpload,
}

// Skill file subcommands.

var skillFilesCmd = &cobra.Command{
	Use:   "files",
	Short: "Work with skill files",
}

var skillFilesListCmd = &cobra.Command{
	Use:   "list <skill-id>",
	Short: "List files for a skill",
	Args:  exactArgs(1),
	RunE:  runSkillFilesList,
}

var skillFilesUpsertCmd = &cobra.Command{
	Use:   "upsert <skill-id>",
	Short: "Create or update a skill file",
	Args:  exactArgs(1),
	RunE:  runSkillFilesUpsert,
}

var skillFilesDeleteCmd = &cobra.Command{
	Use:   "delete <skill-id> <file-id>",
	Short: "Delete a skill file",
	Args:  exactArgs(2),
	RunE:  runSkillFilesDelete,
}

func init() {
	skillCmd.AddCommand(skillListCmd)
	skillCmd.AddCommand(skillGetCmd)
	skillCmd.AddCommand(skillCreateCmd)
	skillCmd.AddCommand(skillUpdateCmd)
	skillCmd.AddCommand(skillDeleteCmd)
	skillCmd.AddCommand(skillImportCmd)
	skillCmd.AddCommand(skillUploadCmd)
	skillCmd.AddCommand(skillFilesCmd)

	skillFilesCmd.AddCommand(skillFilesListCmd)
	skillFilesCmd.AddCommand(skillFilesUpsertCmd)
	skillFilesCmd.AddCommand(skillFilesDeleteCmd)

	// skill list
	skillListCmd.Flags().String("output", "table", "Output format: table or json")

	// skill get
	skillGetCmd.Flags().String("output", "json", "Output format: table or json")

	// skill create
	skillCreateCmd.Flags().String("name", "", "Skill name (required)")
	skillCreateCmd.Flags().String("description", "", "Skill description")
	skillCreateCmd.Flags().String("content", "", "Skill content (SKILL.md body)")
	skillCreateCmd.Flags().String("config", "", "Skill config as JSON string")
	skillCreateCmd.Flags().String("output", "json", "Output format: table or json")

	// skill update
	skillUpdateCmd.Flags().String("name", "", "New name")
	skillUpdateCmd.Flags().String("description", "", "New description")
	skillUpdateCmd.Flags().String("content", "", "New content")
	skillUpdateCmd.Flags().String("config", "", "New config as JSON string")
	skillUpdateCmd.Flags().String("output", "json", "Output format: table or json")

	// skill delete
	skillDeleteCmd.Flags().Bool("yes", false, "Skip confirmation prompt")

	// skill import
	skillImportCmd.Flags().String("url", "", "URL to import from (required)")
	skillImportCmd.Flags().String("output", "json", "Output format: table or json")

	// skill upload
	skillUploadCmd.Flags().Bool("update", true, "Update an existing skill with the same name instead of failing")
	skillUploadCmd.Flags().Bool("include-hidden", false, "Include hidden files and directories when uploading")
	skillUploadCmd.Flags().Bool("skip-binary", true, "Skip binary and non-UTF-8 files instead of failing")
	skillUploadCmd.Flags().String("output", "json", "Output format: table or json")

	// skill files list
	skillFilesListCmd.Flags().String("output", "table", "Output format: table or json")

	// skill files upsert
	skillFilesUpsertCmd.Flags().String("path", "", "File path within the skill (required)")
	skillFilesUpsertCmd.Flags().String("content", "", "File content (required)")
	skillFilesUpsertCmd.Flags().String("output", "json", "Output format: table or json")
}

// ---------------------------------------------------------------------------
// Skill commands
// ---------------------------------------------------------------------------

func runSkillList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var skills []map[string]any
	if err := client.GetJSON(ctx, "/api/skills", &skills); err != nil {
		return fmt.Errorf("list skills: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, skills)
	}

	headers := []string{"ID", "NAME", "DESCRIPTION", "CREATED_AT"}
	rows := make([][]string, 0, len(skills))
	for _, s := range skills {
		rows = append(rows, []string{
			strVal(s, "id"),
			strVal(s, "name"),
			strVal(s, "description"),
			strVal(s, "created_at"),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runSkillGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var skill map[string]any
	if err := client.GetJSON(ctx, "/api/skills/"+args[0], &skill); err != nil {
		return fmt.Errorf("get skill: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, skill)
	}

	headers := []string{"ID", "NAME", "DESCRIPTION", "CREATED_AT"}
	rows := [][]string{{
		strVal(skill, "id"),
		strVal(skill, "name"),
		strVal(skill, "description"),
		strVal(skill, "created_at"),
	}}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runSkillCreate(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	name, _ := cmd.Flags().GetString("name")
	if name == "" {
		return fmt.Errorf("--name is required")
	}

	body := map[string]any{
		"name": name,
	}
	if v, _ := cmd.Flags().GetString("description"); v != "" {
		body["description"] = v
	}
	if v, _ := cmd.Flags().GetString("content"); v != "" {
		body["content"] = v
	}
	if cmd.Flags().Changed("config") {
		v, _ := cmd.Flags().GetString("config")
		var config any
		if err := json.Unmarshal([]byte(v), &config); err != nil {
			return fmt.Errorf("--config must be valid JSON: %w", err)
		}
		body["config"] = config
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/skills", body, &result); err != nil {
		return fmt.Errorf("create skill: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	fmt.Printf("Skill created: %s (%s)\n", strVal(result, "name"), strVal(result, "id"))
	return nil
}

func runSkillUpdate(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	body := map[string]any{}
	if cmd.Flags().Changed("name") {
		v, _ := cmd.Flags().GetString("name")
		body["name"] = v
	}
	if cmd.Flags().Changed("description") {
		v, _ := cmd.Flags().GetString("description")
		body["description"] = v
	}
	if cmd.Flags().Changed("content") {
		v, _ := cmd.Flags().GetString("content")
		body["content"] = v
	}
	if cmd.Flags().Changed("config") {
		v, _ := cmd.Flags().GetString("config")
		var config any
		if err := json.Unmarshal([]byte(v), &config); err != nil {
			return fmt.Errorf("--config must be valid JSON: %w", err)
		}
		body["config"] = config
	}

	if len(body) == 0 {
		return fmt.Errorf("no fields to update; use --name, --description, --content, or --config")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var result map[string]any
	if err := client.PutJSON(ctx, "/api/skills/"+args[0], body, &result); err != nil {
		return fmt.Errorf("update skill: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	fmt.Printf("Skill updated: %s (%s)\n", strVal(result, "name"), strVal(result, "id"))
	return nil
}

func runSkillDelete(cmd *cobra.Command, args []string) error {
	yes, _ := cmd.Flags().GetBool("yes")
	if !yes {
		fmt.Printf("Are you sure you want to delete skill %s? This cannot be undone. [y/N] ", args[0])
		reader := bufio.NewReader(os.Stdin)
		answer, _ := reader.ReadString('\n')
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "y" && answer != "yes" {
			fmt.Println("Aborted.")
			return nil
		}
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := client.DeleteJSON(ctx, "/api/skills/"+args[0]); err != nil {
		return fmt.Errorf("delete skill: %w", err)
	}

	fmt.Printf("Skill deleted: %s\n", args[0])
	return nil
}

func runSkillImport(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	importURL, _ := cmd.Flags().GetString("url")
	if importURL == "" {
		return fmt.Errorf("--url is required")
	}

	body := map[string]any{
		"url": importURL,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/skills/import", body, &result); err != nil {
		return fmt.Errorf("import skill: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	fmt.Printf("Skill imported: %s (%s)\n", strVal(result, "name"), strVal(result, "id"))
	return nil
}

type localSkillFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type localSkillUploadResult struct {
	SkillID       string           `json:"skill_id"`
	Name          string           `json:"name"`
	Operation     string           `json:"operation"`
	UploadedFiles []string         `json:"uploaded_files"`
	SkippedFiles  []string         `json:"skipped_files"`
	Skill         map[string]any   `json:"skill"`
	Files         []localSkillFile `json:"files"`
}

func runSkillUpload(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}

	dir, err := filepath.Abs(args[0])
	if err != nil {
		return fmt.Errorf("resolve skill dir: %w", err)
	}
	skill, err := readLocalSkillDirectory(dir, skillUploadOptions{
		IncludeHidden: boolFlag(cmd, "include-hidden"),
		SkipBinary:    boolFlag(cmd, "skip-binary"),
	})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	existing, err := findSkillByName(ctx, client, skill.Name)
	if err != nil {
		return err
	}
	updateExisting := boolFlag(cmd, "update")

	body := map[string]any{
		"name":        skill.Name,
		"description": skill.Description,
		"content":     skill.Content,
	}
	var result map[string]any
	operation := "created"
	switch {
	case existing == nil:
		if err := client.PostJSON(ctx, "/api/skills", body, &result); err != nil {
			return fmt.Errorf("create skill: %w", err)
		}
	case !updateExisting:
		return fmt.Errorf("skill %q already exists (id %s); rerun with --update to replace content and supporting files", skill.Name, strVal(existing, "id"))
	default:
		operation = "updated"
		if err := client.PutJSON(ctx, "/api/skills/"+strVal(existing, "id"), body, &result); err != nil {
			return fmt.Errorf("update skill: %w", err)
		}
	}

	skillID := strVal(result, "id")
	uploaded := make([]string, 0, len(skill.Files))
	for _, f := range skill.Files {
		fileBody := map[string]any{
			"path":    f.Path,
			"content": f.Content,
		}
		if err := client.PutJSON(ctx, "/api/skills/"+skillID+"/files", fileBody, nil); err != nil {
			return fmt.Errorf("upsert skill file %s: %w", f.Path, err)
		}
		uploaded = append(uploaded, f.Path)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		files := make([]localSkillFile, len(skill.Files))
		for i, f := range skill.Files {
			files[i] = localSkillFile{Path: f.Path, Content: f.Content}
		}
		return cli.PrintJSON(os.Stdout, localSkillUploadResult{
			SkillID:       skillID,
			Name:          skill.Name,
			Operation:     operation,
			UploadedFiles: uploaded,
			SkippedFiles:  skill.Skipped,
			Skill:         result,
			Files:         files,
		})
	}

	fmt.Printf("Skill %s: %s (%s)\n", operation, strVal(result, "name"), skillID)
	fmt.Printf("Uploaded %d file(s)", len(uploaded))
	if len(skill.Skipped) > 0 {
		fmt.Printf(", skipped %d\n", len(skill.Skipped))
		for _, skipped := range skill.Skipped {
			fmt.Printf("  skipped: %s\n", skipped)
		}
		return nil
	}
	fmt.Println()
	return nil
}

type skillUploadOptions struct {
	IncludeHidden bool
	SkipBinary    bool
}

type localSkillDefinition struct {
	Name        string
	Description string
	Content     string
	Files       []localSkillFile
	Skipped     []string
}

func readLocalSkillDirectory(dir string, opts skillUploadOptions) (*localSkillDefinition, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return nil, fmt.Errorf("stat skill dir: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("skill upload expects a directory, got %s", dir)
	}

	skillMDPath := filepath.Join(dir, "SKILL.md")
	contentBytes, err := os.ReadFile(skillMDPath)
	if err != nil {
		return nil, fmt.Errorf("read SKILL.md: %w", err)
	}
	if !utf8.Valid(contentBytes) {
		return nil, fmt.Errorf("SKILL.md must be valid UTF-8")
	}

	content := strings.ToValidUTF8(string(contentBytes), "")
	name, description := parseLocalSkillFrontmatter(content)
	if name == "" {
		name = filepath.Base(dir)
	}

	result := &localSkillDefinition{
		Name:        name,
		Description: description,
		Content:     content,
		Files:       []localSkillFile{},
		Skipped:     []string{},
	}

	err = filepath.WalkDir(dir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == dir {
			return nil
		}

		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		base := filepath.Base(path)

		if !opts.IncludeHidden && strings.HasPrefix(base, ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if base == "__pycache__" {
				return filepath.SkipDir
			}
			return nil
		}
		if rel == "SKILL.md" {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", rel, err)
		}
		if slices.Contains([]string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar", ".tgz", ".pyc"}, strings.ToLower(filepath.Ext(path))) {
			if opts.SkipBinary {
				result.Skipped = append(result.Skipped, rel)
				return nil
			}
			return fmt.Errorf("binary file not supported: %s", rel)
		}
		if !utf8.Valid(data) {
			if opts.SkipBinary {
				result.Skipped = append(result.Skipped, rel)
				return nil
			}
			return fmt.Errorf("non-UTF-8 file not supported: %s", rel)
		}

		result.Files = append(result.Files, localSkillFile{
			Path:    rel,
			Content: strings.ToValidUTF8(string(data), ""),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func parseLocalSkillFrontmatter(content string) (name, description string) {
	if !strings.HasPrefix(content, "---") {
		return "", ""
	}
	end := strings.Index(content[3:], "---")
	if end < 0 {
		return "", ""
	}
	frontmatter := content[3 : 3+end]
	for _, line := range strings.Split(frontmatter, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			name = strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "name:")), "\"'")
		} else if strings.HasPrefix(line, "description:") {
			description = strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "description:")), "\"'")
		}
	}
	return name, description
}

func findSkillByName(ctx context.Context, client *cli.APIClient, name string) (map[string]any, error) {
	var skills []map[string]any
	if err := client.GetJSON(ctx, "/api/skills", &skills); err != nil {
		return nil, fmt.Errorf("list skills: %w", err)
	}
	for _, skill := range skills {
		if strVal(skill, "name") == name {
			return skill, nil
		}
	}
	return nil, nil
}

func boolFlag(cmd *cobra.Command, name string) bool {
	v, _ := cmd.Flags().GetBool(name)
	return v
}

// ---------------------------------------------------------------------------
// Skill file subcommands
// ---------------------------------------------------------------------------

func runSkillFilesList(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var files []map[string]any
	if err := client.GetJSON(ctx, "/api/skills/"+args[0]+"/files", &files); err != nil {
		return fmt.Errorf("list skill files: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, files)
	}

	headers := []string{"ID", "PATH", "CREATED_AT", "UPDATED_AT"}
	rows := make([][]string, 0, len(files))
	for _, f := range files {
		rows = append(rows, []string{
			strVal(f, "id"),
			strVal(f, "path"),
			strVal(f, "created_at"),
			strVal(f, "updated_at"),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runSkillFilesUpsert(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	filePath, _ := cmd.Flags().GetString("path")
	if filePath == "" {
		return fmt.Errorf("--path is required")
	}
	content, _ := cmd.Flags().GetString("content")
	if content == "" {
		return fmt.Errorf("--content is required")
	}

	body := map[string]any{
		"path":    filePath,
		"content": content,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var result map[string]any
	if err := client.PutJSON(ctx, "/api/skills/"+args[0]+"/files", body, &result); err != nil {
		return fmt.Errorf("upsert skill file: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	fmt.Printf("Skill file upserted: %s (%s)\n", strVal(result, "path"), strVal(result, "id"))
	return nil
}

func runSkillFilesDelete(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := client.DeleteJSON(ctx, "/api/skills/"+args[0]+"/files/"+args[1]); err != nil {
		return fmt.Errorf("delete skill file: %w", err)
	}

	fmt.Printf("Skill file deleted: %s\n", args[1])
	return nil
}
