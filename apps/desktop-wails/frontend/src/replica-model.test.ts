import { describe, expect, it } from "vitest";
import { hashKey } from "@tanstack/react-query";
import {
  isReplicableQuery,
  isReplicaQueryKey,
  restoreReplicaEntry,
} from "./replica-model";

const workspaceId = "workspace-1";

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
        workspaceId,
      ),
    ).toEqual({
      queryHash: hashKey(queryKey),
      queryKey,
      data,
      dataJson: JSON.stringify(data),
      updatedAt: 100,
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
        workspaceId,
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
        workspaceId,
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
        workspaceId,
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
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicableQuery(
        ["issues", workspaceId, "detail", "issue-1"],
        { id: "issue-1", workspace_id: workspaceId },
        workspaceId,
      ),
    ).toBe(true);
  });

  it("rejects selected issue arrays and mismatched issue detail ids", () => {
    expect(
      isReplicableQuery(
        ["issues", workspaceId, "list", {}],
        [{ id: "issue-1", workspace_id: workspaceId }],
        workspaceId,
      ),
    ).toBe(false);
    expect(
      isReplicableQuery(
        ["issues", workspaceId, "detail", "issue-1"],
        { id: "issue-2", workspace_id: workspaceId },
        workspaceId,
      ),
    ).toBe(false);
  });
});

describe("isReplicaQueryKey", () => {
  it("whitelists only the initial replica keys", () => {
    expect(
      isReplicaQueryKey(["issues", workspaceId, "list", {}], workspaceId),
    ).toBe(true);
    expect(
      isReplicaQueryKey(
        ["issues", workspaceId, "detail", "issue-1"],
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isReplicaQueryKey(["chat", workspaceId, "sessions"], workspaceId),
    ).toBe(true);
    expect(
      isReplicaQueryKey(["chat", "messages", "session-1"], workspaceId),
    ).toBe(false);
  });
});
