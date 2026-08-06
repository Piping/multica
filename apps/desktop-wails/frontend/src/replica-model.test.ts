import { describe, expect, it } from "vitest";
import { hashKey } from "@tanstack/react-query";
import {
  discoverReplicaScope,
  discoverReplicaScopeFromEntries,
  isReplicableQuery,
  isReplicaQueryKey,
  restoreReplicaEntry,
  type ReplicaScope,
} from "./replica-model";

const workspaceId = "workspace-1";
const userId = "user-1";
const emptyScope: ReplicaScope = {
  userId,
  workspaceId,
  agentIds: new Set(),
  issueIds: new Set(),
  chatSessionIds: new Set(),
};
const issueScope: ReplicaScope = {
  userId,
  workspaceId,
  agentIds: new Set(),
  issueIds: new Set(["issue-1"]),
  chatSessionIds: new Set(),
};
const tableQuery = {
  scope: { kind: "workspace" },
  filters: { include_sub_issues: true },
  sort: { field: "position", direction: "asc" },
};

describe("restoreReplicaEntry", () => {
  it("restores a scoped chat session list", () => {
    const queryKey = ["chat", workspaceId, "sessions"];
    const data = [
      {
        id: "session-1",
        workspace_id: workspaceId,
        agent_id: "agent-1",
      },
    ];

    expect(
      restoreReplicaEntry(
        {
          queryHash: hashKey(queryKey),
          queryKeyJson: JSON.stringify(queryKey),
          dataJson: JSON.stringify(data),
          updatedAt: 100,
        },
        emptyScope,
      ),
    ).toEqual({
      queryHash: hashKey(queryKey),
      queryKey,
      data,
      dataJson: JSON.stringify(data),
      updatedAt: 100,
    });
  });

  it("restores the current user's sidebar pins", () => {
    const queryKey = ["pins", workspaceId, userId, "list"];
    const data = [
      {
        id: "pin-1",
        workspace_id: workspaceId,
        user_id: userId,
        item_type: "issue",
        item_id: "issue-1",
        position: 0,
        created_at: "2026-08-06T00:00:00Z",
      },
    ];

    expect(
      restoreReplicaEntry(
        {
          queryHash: hashKey(queryKey),
          queryKeyJson: JSON.stringify(queryKey),
          dataJson: JSON.stringify(data),
          updatedAt: 101,
        },
        emptyScope,
      ),
    ).toEqual({
      queryHash: hashKey(queryKey),
      queryKey,
      data,
      dataJson: JSON.stringify(data),
      updatedAt: 101,
    });
  });

  it("rejects tampered hashes and cross-workspace payloads", () => {
    const queryKey = ["chat", workspaceId, "sessions"];
    const crossWorkspaceData = [
      {
        id: "session-1",
        workspace_id: "workspace-2",
        agent_id: "agent-1",
      },
    ];
    expect(
      restoreReplicaEntry(
        {
          queryHash: "tampered",
          queryKeyJson: JSON.stringify(queryKey),
          dataJson: "[]",
          updatedAt: 1,
        },
        emptyScope,
      ),
    ).toBeNull();
    expect(
      restoreReplicaEntry(
        {
          queryHash: hashKey(queryKey),
          queryKeyJson: JSON.stringify(queryKey),
          dataJson: JSON.stringify(crossWorkspaceData),
          updatedAt: 1,
        },
        emptyScope,
      ),
    ).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(
      restoreReplicaEntry(
        {
          queryHash: "hash",
          queryKeyJson: "[",
          dataJson: "{}",
          updatedAt: 1,
        },
        emptyScope,
      ),
    ).toBeNull();
  });
});

describe("isReplicableQuery", () => {
  it("accepts issue board and matching issue detail cache shapes", () => {
    expect(
      isReplicableQuery(
        ["issues", workspaceId, "list", {}],
        {
          byStatus: {
            todo: {
              issues: [{ id: "issue-1", workspace_id: workspaceId }],
              total: 1,
            },
          },
        },
        emptyScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["issues", workspaceId, "detail", "issue-1"],
        { id: "issue-1", workspace_id: workspaceId },
        emptyScope,
      ),
    ).toBe(true);
  });

  it("rejects selected issue arrays and mismatched issue detail ids", () => {
    expect(
      isReplicableQuery(
        ["issues", workspaceId, "list", {}],
        [{ id: "issue-1", workspace_id: workspaceId }],
        emptyScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["issues", workspaceId, "detail", "issue-1"],
        { id: "issue-2", workspace_id: workspaceId },
        emptyScope,
      ),
    ).toBe(false);
  });

  it("accepts validated issue table facets, groups, and row pages", () => {
    expect(
      isReplicableQuery(
        [
          "issues",
          workspaceId,
          "table-query",
          "facets",
          { query: tableQuery, facets: [{ kind: "status" }] },
        ],
        {
          query_fingerprint: "fingerprint",
          total: 1,
          facets: [
            { kind: "status", values: [{ key: "todo", count: 1 }] },
          ],
        },
        emptyScope,
      ),
    ).toBe(true);

    expect(
      isReplicableQuery(
        [
          "issues",
          workspaceId,
          "table-query",
          "groups",
          tableQuery,
          { kind: "assignee" },
        ],
        {
          pages: [
            {
              query_fingerprint: "fingerprint",
              total: 1,
              groups: [
                {
                  key: "assignee:agent-1",
                  value: {
                    kind: "assignee",
                    actor: { type: "agent", id: "agent-1" },
                  },
                  count: 1,
                },
              ],
              next_cursor: null,
            },
          ],
          pageParams: [null],
        },
        emptyScope,
      ),
    ).toBe(true);

    expect(
      isReplicableQuery(
        [
          "issues",
          workspaceId,
          "table-query",
          "rows",
          tableQuery,
          { kind: "status" },
          "status:todo",
          { hierarchy: false, parentId: null },
          "page",
          null,
        ],
        {
          query_fingerprint: "fingerprint",
          group_key: "status:todo",
          parent_id: null,
          total: 1,
          branch_total: 1,
          rows: [
            {
              issue: { id: "issue-1", workspace_id: workspaceId },
              direct_child_count: 0,
            },
          ],
          next_cursor: null,
        },
        emptyScope,
      ),
    ).toBe(true);
  });

  it("rejects cross-workspace issue table rows", () => {
    expect(
      isReplicableQuery(
        [
          "issues",
          workspaceId,
          "table-query",
          "rows",
          tableQuery,
          { kind: "status" },
          "status:todo",
          { hierarchy: false, parentId: null },
          "page",
          null,
        ],
        {
          query_fingerprint: "fingerprint",
          group_key: "status:todo",
          parent_id: null,
          total: 1,
          branch_total: 1,
          rows: [
            {
              issue: { id: "issue-1", workspace_id: "workspace-2" },
              direct_child_count: 0,
            },
          ],
          next_cursor: null,
        },
        emptyScope,
      ),
    ).toBe(false);
  });

  it("accepts message pages only for a session in the current workspace", () => {
    const key = ["chat", "messages-page", "session-1"];
    const data = {
      pages: [
        {
          messages: [
            {
              id: "message-1",
              chat_session_id: "session-1",
              role: "assistant",
              content: "Ready",
            },
          ],
          limit: 50,
          has_more: false,
          next_cursor: null,
        },
      ],
      pageParams: [null],
    };
    expect(
      isReplicableQuery(
        key,
        data,
        { ...emptyScope, chatSessionIds: new Set(["session-1"]) },
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        key,
        data,
        { ...emptyScope, chatSessionIds: new Set(["session-2"]) },
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        key,
        {
          ...data,
          pages: [
            {
              ...data.pages[0],
              messages: [
                {
                  ...data.pages[0]!.messages[0],
                  chat_session_id: "session-2",
                },
              ],
            },
          ],
        },
        { ...emptyScope, chatSessionIds: new Set(["session-1"]) },
      ),
    ).toBe(false);
  });

  it("accepts complete issue detail resources for a trusted issue", () => {
    expect(
      isReplicableQuery(
        ["issues", "timeline", "issue-1"],
        [
          {
            type: "comment",
            id: "comment-1",
            actor_type: "member",
            actor_id: "member-1",
            created_at: "2026-08-06T00:00:00Z",
            content: "Persist this concrete message",
            parent_id: null,
            reactions: [
              {
                id: "reaction-1",
                comment_id: "comment-1",
                actor_type: "member",
                actor_id: "member-1",
                emoji: "+1",
              },
            ],
            attachments: [
              {
                id: "attachment-1",
                workspace_id: workspaceId,
                issue_id: "issue-1",
                filename: "details.txt",
                content_type: "text/plain",
                size_bytes: 42,
              },
            ],
          },
        ],
        issueScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["issues", "reactions", "issue-1"],
        [
          {
            id: "reaction-1",
            issue_id: "issue-1",
            actor_type: "member",
            actor_id: "member-1",
            emoji: "+1",
          },
        ],
        issueScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["issues", "subscribers", "issue-1"],
        [
          {
            issue_id: "issue-1",
            user_type: "member",
            user_id: "member-1",
            reason: "manual",
          },
        ],
        issueScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["issues", "usage", "issue-1"],
        {
          total_input_tokens: 10,
          total_output_tokens: 20,
          total_cache_read_tokens: 30,
          total_cache_write_tokens: 40,
          task_count: 1,
        },
        issueScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["issues", "tasks", "issue-1"],
        [
          {
            id: "task-1",
            issue_id: "issue-1",
            agent_id: "agent-1",
            runtime_id: "runtime-1",
            status: "completed",
          },
        ],
        issueScope,
      ),
    ).toBe(true);
  });

  it("rejects untrusted and cross-issue detail resources", () => {
    const reaction = {
      id: "reaction-1",
      issue_id: "issue-2",
      actor_type: "member",
      actor_id: "member-1",
      emoji: "+1",
    };
    expect(
      isReplicableQuery(
        ["issues", "reactions", "issue-1"],
        [reaction],
        issueScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["issues", "reactions", "issue-2"],
        [reaction],
        issueScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["issues", "attachments", "issue-1"],
        [
          {
            id: "attachment-1",
            workspace_id: "workspace-2",
            issue_id: "issue-1",
            filename: "secret.txt",
            content_type: "text/plain",
            size_bytes: 1,
          },
        ],
        issueScope,
      ),
    ).toBe(false);
  });

  it("accepts scoped children, directories, labels, and project metadata", () => {
    expect(
      isReplicableQuery(
        ["issues", workspaceId, "children", "issue-1"],
        [
          {
            id: "issue-2",
            workspace_id: workspaceId,
            parent_issue_id: "issue-1",
          },
        ],
        issueScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["labels", workspaceId, "issue", "issue-1"],
        {
          labels: [{ id: "label-1", workspace_id: workspaceId }],
          total: 1,
        },
        issueScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "members"],
        [{ id: "member-1", workspace_id: workspaceId }],
        emptyScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["projects", workspaceId, "list"],
        {
          projects: [{ id: "project-1", workspace_id: workspaceId }],
          total: 1,
        },
        emptyScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["properties", workspaceId, "list", true],
        {
          properties: [{ id: "property-1", workspace_id: workspaceId }],
          total: 1,
        },
        emptyScope,
      ),
    ).toBe(true);
  });

  it("accepts issue side panel workspace catalogs", () => {
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "squads"],
        [
          {
            id: "squad-1",
            workspace_id: workspaceId,
            name: "Support",
            leader_id: "agent-1",
          },
        ],
        emptyScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "assignee-frequency"],
        [
          {
            assignee_type: "agent",
            assignee_id: "agent-1",
            frequency: 3,
          },
        ],
        emptyScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["labels", workspaceId, "list", "issue"],
        {
          labels: [
            {
              id: "label-1",
              workspace_id: workspaceId,
              resource_type: "issue",
            },
          ],
          total: 1,
        },
        emptyScope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["quick-actions", workspaceId, "list", false],
        {
          quick_actions: [
            {
              id: "quick-action-1",
              workspace_id: workspaceId,
              assignee_type: "agent",
              assignee_id: "agent-1",
            },
          ],
        },
        emptyScope,
      ),
    ).toBe(true);
  });

  it("accepts the current user's scoped sidebar pins", () => {
    expect(
      isReplicableQuery(
        ["pins", workspaceId, userId, "list"],
        [
          {
            id: "pin-1",
            workspace_id: workspaceId,
            user_id: userId,
            item_type: "issue",
            item_id: "issue-1",
            position: 0,
            created_at: "2026-08-06T00:00:00Z",
          },
          {
            id: "pin-2",
            workspace_id: workspaceId,
            user_id: userId,
            item_type: "project",
            item_id: "project-1",
            position: 1.5,
            created_at: "2026-08-06T00:01:00Z",
          },
        ],
        emptyScope,
      ),
    ).toBe(true);
  });

  it("accepts lightweight catalogs opened from sidebar navigation", () => {
    for (const [queryKey, data] of [
      [
        ["workspaces", workspaceId, "skills"],
        [{ id: "skill-1", workspace_id: workspaceId, name: "Review" }],
      ],
      [
        ["autopilots", workspaceId, "list"],
        {
          autopilots: [
            {
              id: "autopilot-1",
              workspace_id: workspaceId,
              title: "Triage",
            },
          ],
        },
      ],
      [
        ["runtimes", workspaceId, "list"],
        [{ id: "runtime-1", workspace_id: workspaceId, name: "Mac mini" }],
      ],
      [
        ["runtime-profiles", workspaceId, "list"],
        [{ id: "profile-1", workspace_id: workspaceId, display_name: "Codex" }],
      ],
    ] as const) {
      expect(isReplicableQuery(queryKey, data, emptyScope)).toBe(true);
    }
  });

  it("rejects malformed or cross-workspace sidebar catalogs", () => {
    expect(
      isReplicableQuery(
        ["runtimes", workspaceId, "list"],
        [{ id: "runtime-1", workspace_id: "workspace-2" }],
        emptyScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "skills"],
        [{ workspace_id: workspaceId, name: "Missing id" }],
        emptyScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["runtimes", workspaceId, "list", "mine"],
        [{ id: "runtime-1", workspace_id: workspaceId }],
        emptyScope,
      ),
    ).toBe(false);
  });

  it("accepts agent list summaries only for trusted workspace agents", () => {
    const scope = { ...emptyScope, agentIds: new Set(["agent-1"]) };
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "agent-activity", "30d"],
        [
          {
            agent_id: "agent-1",
            bucket_at: "2026-08-06T00:00:00Z",
            task_count: 4,
            failed_count: 1,
          },
        ],
        scope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "agent-run-counts", "30d"],
        [{ agent_id: "agent-1", run_count: 7 }],
        scope,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "agent-run-counts", "30d"],
        [{ agent_id: "agent-2", run_count: 7 }],
        scope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "agent-activity", "30d"],
        [
          {
            agent_id: "agent-1",
            bucket_at: "2026-08-06T00:00:00Z",
            task_count: 1,
            failed_count: 2,
          },
        ],
        scope,
      ),
    ).toBe(false);
  });

  it("rejects cross-user, cross-workspace, and malformed sidebar pins", () => {
    const pin = {
      id: "pin-1",
      workspace_id: workspaceId,
      user_id: userId,
      item_type: "issue",
      item_id: "issue-1",
      position: 0,
      created_at: "2026-08-06T00:00:00Z",
    };

    expect(
      isReplicableQuery(
        ["pins", workspaceId, "user-2", "list"],
        [{ ...pin, user_id: "user-2" }],
        emptyScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["pins", workspaceId, userId, "list"],
        [{ ...pin, workspace_id: "workspace-2" }],
        emptyScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["pins", workspaceId, userId, "list"],
        [{ ...pin, item_type: "runtime" }],
        emptyScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["pins", workspaceId, userId, "list"],
        [pin, { ...pin, id: "pin-2" }],
        emptyScope,
      ),
    ).toBe(false);
  });

  it("rejects cross-workspace side panel catalogs", () => {
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "squads"],
        [
          {
            id: "squad-1",
            workspace_id: "workspace-2",
            name: "Other",
            leader_id: "agent-1",
          },
        ],
        emptyScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["labels", workspaceId, "list", "issue"],
        {
          labels: [
            {
              id: "label-1",
              workspace_id: workspaceId,
              resource_type: "agent",
            },
          ],
        },
        emptyScope,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["quick-actions", workspaceId, "list", false],
        {
          quick_actions: [
            {
              id: "quick-action-1",
              workspace_id: "workspace-2",
              assignee_type: "agent",
              assignee_id: "agent-1",
            },
          ],
        },
        emptyScope,
      ),
    ).toBe(false);
  });

  it("accepts pull requests only for a trusted issue in this workspace", () => {
    const key = ["github", "pull-requests", "issue-1"];
    const data = {
      pull_requests: [
        {
          id: "pull-request-1",
          workspace_id: workspaceId,
          repo_owner: "multica",
          repo_name: "multica",
          number: 42,
        },
      ],
    };

    expect(isReplicableQuery(key, data, issueScope)).toBe(true);
    expect(isReplicableQuery(key, data, emptyScope)).toBe(false);
    expect(
      isReplicableQuery(
        key,
        {
          pull_requests: [
            {
              ...data.pull_requests[0],
              workspace_id: "workspace-2",
            },
          ],
        },
        issueScope,
      ),
    ).toBe(false);
  });
});

describe("discoverReplicaScope", () => {
  it("discovers issue aliases, table rows, nested children, and chat sessions", () => {
    const scope = discoverReplicaScope(
      [
        {
          queryKey: ["issues", workspaceId, "detail", "LOCAL-1"],
          data: {
            id: "issue-1",
            identifier: "LOCAL-1",
            workspace_id: workspaceId,
          },
        },
        {
          queryKey: ["issues", workspaceId, "children", "issue-2"],
          data: [
            {
              id: "issue-3",
              workspace_id: workspaceId,
              parent_issue_id: "issue-2",
            },
          ],
        },
        {
          queryKey: ["issues", workspaceId, "children", "issue-1"],
          data: [
            {
              id: "issue-2",
              workspace_id: workspaceId,
              parent_issue_id: "issue-1",
            },
          ],
        },
        {
          queryKey: ["chat", workspaceId, "sessions"],
          data: [
            {
              id: "session-1",
              workspace_id: workspaceId,
              agent_id: "agent-1",
            },
          ],
        },
      ],
      workspaceId,
      userId,
    );

    expect([...scope.issueIds].sort()).toEqual([
      "issue-1",
      "issue-2",
      "issue-3",
    ]);
    expect([...scope.chatSessionIds]).toEqual(["session-1"]);
  });

  it("discovers trusted agents independently of persisted row order", () => {
    const scope = discoverReplicaScope(
      [
        {
          queryKey: ["workspaces", workspaceId, "agent-run-counts", "30d"],
          data: [{ agent_id: "agent-1", run_count: 3 }],
        },
        {
          queryKey: ["workspaces", workspaceId, "agents"],
          data: [{ id: "agent-1", workspace_id: workspaceId }],
        },
      ],
      workspaceId,
      userId,
    );

    expect([...scope.agentIds]).toEqual(["agent-1"]);
    expect(
      isReplicableQuery(
        ["workspaces", workspaceId, "agent-run-counts", "30d"],
        [{ agent_id: "agent-1", run_count: 3 }],
        scope,
      ),
    ).toBe(true);
  });

  it("does not trust a tampered persisted scope seed", () => {
    const key = ["issues", workspaceId, "detail", "issue-1"];
    const scope = discoverReplicaScopeFromEntries(
      [
        {
          queryHash: "tampered",
          queryKeyJson: JSON.stringify(key),
          dataJson: JSON.stringify({
            id: "issue-1",
            workspace_id: workspaceId,
          }),
          updatedAt: 1,
        },
      ],
      workspaceId,
      userId,
    );
    expect(scope.issueIds.size).toBe(0);
  });
});

describe("isReplicaQueryKey", () => {
  it("whitelists issue table and chat page replica keys", () => {
    expect(
      isReplicaQueryKey(
        ["issues", workspaceId, "list", {}],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["issues", workspaceId, "detail", "issue-1"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["chat", workspaceId, "sessions"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["chat", "messages", "session-1"],
        workspaceId,
      ),
    ).toBe(false);
    expect(
      isReplicaQueryKey(
        [
          "issues",
          workspaceId,
          "table-query",
          "facets",
          { query: tableQuery, facets: [{ kind: "status" }] },
        ],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["chat", "messages-page", "session-1"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["issues", "timeline", "issue-1"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["labels", workspaceId, "issue", "issue-1"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["workspaces", workspaceId, "assignee-frequency"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["labels", workspaceId, "list", "issue"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["quick-actions", workspaceId, "list", false],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["github", "pull-requests", "issue-1"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["projects", "workspace-2", "list"],
        workspaceId,
      ),
    ).toBe(false);
    expect(
      isReplicaQueryKey(
        ["pins", workspaceId, userId, "list"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["pins", workspaceId, "user-2", "list"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["workspaces", workspaceId, "skills"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["autopilots", workspaceId, "list"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["runtimes", workspaceId, "list"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["runtime-profiles", workspaceId, "list"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["workspaces", workspaceId, "agent-activity", "30d"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["workspaces", workspaceId, "agent-run-counts", "30d"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["runtimes", workspaceId, "list", "mine"],
        workspaceId,
      ),
    ).toBe(false);
  });
});
