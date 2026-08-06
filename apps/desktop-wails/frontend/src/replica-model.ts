import { hashKey, type QueryKey } from "@tanstack/react-query";

export interface ReplicaEntry {
  queryHash: string;
  queryKeyJson: string;
  dataJson: string;
  updatedAt: number;
}

export interface RestoredReplicaEntry {
  queryHash: string;
  queryKey: QueryKey;
  data: unknown;
  dataJson: string;
  updatedAt: number;
}

export function restoreReplicaEntry(
  entry: ReplicaEntry,
  workspaceId: string,
): RestoredReplicaEntry | null {
  if (
    !entry.queryHash ||
    !Number.isSafeInteger(entry.updatedAt) ||
    entry.updatedAt < 0
  ) {
    return null;
  }

  try {
    const queryKey: unknown = JSON.parse(entry.queryKeyJson);
    const data: unknown = JSON.parse(entry.dataJson);
    if (!Array.isArray(queryKey)) return null;
    if (hashKey(queryKey) !== entry.queryHash) return null;
    if (!isReplicableQuery(queryKey, data, workspaceId)) return null;
    return {
      queryHash: entry.queryHash,
      queryKey,
      data,
      dataJson: entry.dataJson,
      updatedAt: entry.updatedAt,
    };
  } catch {
    return null;
  }
}

export function isReplicableQuery(
  queryKey: readonly unknown[],
  data: unknown,
  workspaceId: string,
): boolean {
  if (queryKey[1] !== workspaceId) return false;

  if (
    queryKey.length === 4 &&
    queryKey[0] === "issues" &&
    queryKey[2] === "list"
  ) {
    return isIssueListCache(data, workspaceId);
  }

  if (
    queryKey.length === 4 &&
    queryKey[0] === "issues" &&
    queryKey[2] === "detail" &&
    typeof queryKey[3] === "string"
  ) {
    return (
      isWorkspaceRecord(data, workspaceId) && data.id === queryKey[3]
    );
  }

  if (
    queryKey.length === 3 &&
    queryKey[0] === "chat" &&
    queryKey[2] === "sessions"
  ) {
    return (
      Array.isArray(data) &&
      data.every(
        (session) =>
          isWorkspaceRecord(session, workspaceId) &&
          typeof session.id === "string" &&
          typeof session.agent_id === "string",
      )
    );
  }

  return false;
}

export function isReplicaQueryKey(
  queryKey: readonly unknown[],
  workspaceId: string,
): boolean {
  if (queryKey[1] !== workspaceId) return false;
  return (
    (queryKey.length === 4 &&
      queryKey[0] === "issues" &&
      queryKey[2] === "list") ||
    (queryKey.length === 4 &&
      queryKey[0] === "issues" &&
      queryKey[2] === "detail" &&
      typeof queryKey[3] === "string") ||
    (queryKey.length === 3 &&
      queryKey[0] === "chat" &&
      queryKey[2] === "sessions")
  );
}

function isIssueListCache(
  value: unknown,
  workspaceId: string,
): value is {
  byStatus: Record<string, { issues: unknown[]; total: number }>;
} {
  if (!isRecord(value) || !isRecord(value.byStatus)) return false;
  return Object.values(value.byStatus).every(
    (bucket) =>
      isRecord(bucket) &&
      Array.isArray(bucket.issues) &&
      typeof bucket.total === "number" &&
      Number.isSafeInteger(bucket.total) &&
      bucket.total >= 0 &&
      bucket.issues.every((issue) => isWorkspaceRecord(issue, workspaceId)),
  );
}

function isWorkspaceRecord(
  value: unknown,
  workspaceId: string,
): value is Record<string, unknown> {
  return isRecord(value) && value.workspace_id === workspaceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
