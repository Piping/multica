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

export interface ReplicaScope {
  workspaceId: string;
  issueIds: ReadonlySet<string>;
  chatSessionIds: ReadonlySet<string>;
}

export interface ReplicaCandidate {
  queryKey: readonly unknown[];
  data: unknown;
}

export function restoreReplicaEntry(
  entry: ReplicaEntry,
  scope: ReplicaScope,
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
    if (!isReplicableQuery(queryKey, data, scope)) {
      return null;
    }
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
  scope: ReplicaScope,
): boolean {
  const { workspaceId, issueIds, chatSessionIds } = scope;

  if (
    queryKey[1] === workspaceId &&
    queryKey.length === 4 &&
    queryKey[0] === "issues" &&
    queryKey[2] === "list"
  ) {
    return isIssueListCache(data, workspaceId);
  }

  if (
    queryKey[1] === workspaceId &&
    queryKey.length === 4 &&
    queryKey[0] === "issues" &&
    queryKey[2] === "detail" &&
    typeof queryKey[3] === "string"
  ) {
    return isIssueDetailCache(data, workspaceId, queryKey[3]);
  }

  if (
    queryKey[1] === workspaceId &&
    queryKey.length === 4 &&
    queryKey[0] === "issues" &&
    queryKey[2] === "identifier" &&
    typeof queryKey[3] === "string"
  ) {
    return (
      data === null ||
      (isIssueRecord(data, workspaceId) &&
        data.identifier === queryKey[3])
    );
  }

  if (
    queryKey[1] === workspaceId &&
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

  if (
    queryKey[1] === workspaceId &&
    queryKey[0] === "issues" &&
    queryKey[2] === "table-query"
  ) {
    return isIssueTableQuery(queryKey, data, workspaceId);
  }

  if (
    queryKey.length === 3 &&
    queryKey[0] === "chat" &&
    queryKey[1] === "messages-page" &&
    typeof queryKey[2] === "string"
  ) {
    return (
      chatSessionIds.has(queryKey[2]) &&
      isChatMessagesInfiniteData(data, queryKey[2])
    );
  }

  if (
    queryKey[0] === "issues" &&
    queryKey.length === 3 &&
    typeof queryKey[2] === "string" &&
    issueIds.has(queryKey[2])
  ) {
    const issueId = queryKey[2];
    switch (queryKey[1]) {
      case "timeline":
        return isTimeline(data, workspaceId, issueId);
      case "reactions":
        return isIssueReactions(data, issueId);
      case "subscribers":
        return isIssueSubscribers(data, issueId);
      case "usage":
        return isIssueUsage(data);
      case "attachments":
        return isIssueAttachments(data, workspaceId, issueId);
      case "tasks":
        return isIssueTasks(data, issueId);
    }
  }

  if (
    queryKey[0] === "issues" &&
    queryKey[1] === workspaceId &&
    queryKey.length === 4 &&
    queryKey[2] === "children" &&
    typeof queryKey[3] === "string" &&
    issueIds.has(queryKey[3])
  ) {
    return isChildIssues(data, workspaceId, queryKey[3]);
  }

  if (
    queryKey[0] === "issues" &&
    queryKey[1] === workspaceId &&
    queryKey.length === 3 &&
    queryKey[2] === "child-progress"
  ) {
    return isChildProgress(data);
  }

  if (
    queryKey[0] === "labels" &&
    queryKey[1] === workspaceId &&
    queryKey.length === 4 &&
    queryKey[2] === "issue" &&
    typeof queryKey[3] === "string" &&
    issueIds.has(queryKey[3])
  ) {
    return isIssueLabels(data, workspaceId);
  }

  if (
    queryKey[0] === "labels" &&
    queryKey[1] === workspaceId &&
    queryKey.length === 4 &&
    queryKey[2] === "list" &&
    typeof queryKey[3] === "string"
  ) {
    return isLabelCatalog(data, workspaceId, queryKey[3]);
  }

  if (
    queryKey[0] === "workspaces" &&
    queryKey[1] === workspaceId &&
    queryKey.length === 3
  ) {
    if (
      queryKey[2] === "members" ||
      queryKey[2] === "agents" ||
      queryKey[2] === "squads"
    ) {
      return isWorkspaceRecordArray(data, workspaceId);
    }
    if (queryKey[2] === "assignee-frequency") {
      return isAssigneeFrequency(data);
    }
  }

  if (
    queryKey[0] === "quick-actions" &&
    queryKey[1] === workspaceId &&
    queryKey.length === 4 &&
    queryKey[2] === "list" &&
    typeof queryKey[3] === "boolean"
  ) {
    return isWorkspaceCollection(data, "quick_actions", workspaceId);
  }

  if (
    queryKey[0] === "github" &&
    queryKey[1] === "pull-requests" &&
    queryKey.length === 3 &&
    typeof queryKey[2] === "string" &&
    issueIds.has(queryKey[2])
  ) {
    return isWorkspaceCollection(data, "pull_requests", workspaceId);
  }

  if (
    queryKey[0] === "projects" &&
    queryKey[1] === workspaceId
  ) {
    if (queryKey.length === 3 && queryKey[2] === "list") {
      return isWorkspaceCollection(data, "projects", workspaceId);
    }
    if (
      queryKey.length === 4 &&
      queryKey[2] === "detail" &&
      typeof queryKey[3] === "string"
    ) {
      return (
        isWorkspaceRecord(data, workspaceId) &&
        data.id === queryKey[3]
      );
    }
  }

  if (
    queryKey[0] === "properties" &&
    queryKey[1] === workspaceId &&
    queryKey.length === 4 &&
    queryKey[2] === "list" &&
    typeof queryKey[3] === "boolean"
  ) {
    return isWorkspaceCollection(data, "properties", workspaceId);
  }

  return false;
}

export function isReplicaQueryKey(
  queryKey: readonly unknown[],
  workspaceId: string,
): boolean {
  return (
    (queryKey[1] === workspaceId &&
      queryKey.length === 4 &&
      queryKey[0] === "issues" &&
      queryKey[2] === "list") ||
    (queryKey[1] === workspaceId &&
      queryKey.length === 4 &&
      queryKey[0] === "issues" &&
      queryKey[2] === "detail" &&
      typeof queryKey[3] === "string") ||
    (queryKey[1] === workspaceId &&
      queryKey.length === 4 &&
      queryKey[0] === "issues" &&
      queryKey[2] === "identifier" &&
      typeof queryKey[3] === "string") ||
    (queryKey[1] === workspaceId &&
      queryKey.length === 3 &&
      queryKey[0] === "chat" &&
      queryKey[2] === "sessions") ||
    (queryKey[1] === workspaceId &&
      queryKey[0] === "issues" &&
      queryKey[2] === "table-query") ||
    (queryKey.length === 3 &&
      queryKey[0] === "chat" &&
      queryKey[1] === "messages-page" &&
      typeof queryKey[2] === "string") ||
    (queryKey.length === 3 &&
      queryKey[0] === "issues" &&
      isIssueDetailResource(queryKey[1]) &&
      typeof queryKey[2] === "string") ||
    (queryKey[0] === "issues" &&
      queryKey[1] === workspaceId &&
      queryKey.length === 4 &&
      queryKey[2] === "children" &&
      typeof queryKey[3] === "string") ||
    (queryKey[0] === "issues" &&
      queryKey[1] === workspaceId &&
      queryKey.length === 3 &&
      queryKey[2] === "child-progress") ||
    (queryKey[0] === "labels" &&
      queryKey[1] === workspaceId &&
      queryKey.length === 4 &&
      queryKey[2] === "issue" &&
      typeof queryKey[3] === "string") ||
    (queryKey[0] === "labels" &&
      queryKey[1] === workspaceId &&
      queryKey.length === 4 &&
      queryKey[2] === "list" &&
      typeof queryKey[3] === "string") ||
    (queryKey[0] === "workspaces" &&
      queryKey[1] === workspaceId &&
      queryKey.length === 3 &&
      (queryKey[2] === "members" ||
        queryKey[2] === "agents" ||
        queryKey[2] === "squads" ||
        queryKey[2] === "assignee-frequency")) ||
    (queryKey[0] === "quick-actions" &&
      queryKey[1] === workspaceId &&
      queryKey.length === 4 &&
      queryKey[2] === "list" &&
      typeof queryKey[3] === "boolean") ||
    (queryKey[0] === "github" &&
      queryKey[1] === "pull-requests" &&
      queryKey.length === 3 &&
      typeof queryKey[2] === "string") ||
    (queryKey[0] === "projects" &&
      queryKey[1] === workspaceId &&
      ((queryKey.length === 3 && queryKey[2] === "list") ||
        (queryKey.length === 4 &&
          queryKey[2] === "detail" &&
          typeof queryKey[3] === "string"))) ||
    (queryKey[0] === "properties" &&
      queryKey[1] === workspaceId &&
      queryKey.length === 4 &&
      queryKey[2] === "list" &&
      typeof queryKey[3] === "boolean")
  );
}

export function discoverReplicaScope(
  candidates: Iterable<ReplicaCandidate>,
  workspaceId: string,
): ReplicaScope {
  const allCandidates = [...candidates];
  const issueIds = new Set<string>();
  const chatSessionIds = new Set<string>();

  for (const { queryKey, data } of allCandidates) {
    collectChatSessionIds(queryKey, data, workspaceId, chatSessionIds);
    collectIssueIds(queryKey, data, workspaceId, issueIds);
  }

  // Children can establish further trusted issue IDs, including nested
  // descendants. Iterate to a fixed point so SQLite row order is irrelevant.
  let previousSize = -1;
  while (previousSize !== issueIds.size) {
    previousSize = issueIds.size;
    for (const { queryKey, data } of allCandidates) {
      collectChildIssueIds(queryKey, data, workspaceId, issueIds);
    }
  }

  return { workspaceId, issueIds, chatSessionIds };
}

export function discoverReplicaScopeFromEntries(
  entries: ReplicaEntry[],
  workspaceId: string,
): ReplicaScope {
  const candidates: ReplicaCandidate[] = [];
  for (const entry of entries) {
    try {
      const queryKey: unknown = JSON.parse(entry.queryKeyJson);
      const data: unknown = JSON.parse(entry.dataJson);
      if (!Array.isArray(queryKey)) continue;
      if (hashKey(queryKey) !== entry.queryHash) continue;
      candidates.push({ queryKey, data });
    } catch {
      // The restore pass deletes malformed rows after scope discovery.
    }
  }
  return discoverReplicaScope(candidates, workspaceId);
}

function collectChatSessionIds(
  queryKey: readonly unknown[],
  data: unknown,
  workspaceId: string,
  target: Set<string>,
): void {
  if (
    queryKey[0] !== "chat" ||
    queryKey[1] !== workspaceId ||
    queryKey[2] !== "sessions" ||
    queryKey.length !== 3 ||
    !Array.isArray(data)
  ) {
    return;
  }
  for (const session of data) {
    if (
      isWorkspaceRecord(session, workspaceId) &&
      typeof session.id === "string" &&
      typeof session.agent_id === "string"
    ) {
      target.add(session.id);
    }
  }
}

function collectIssueIds(
  queryKey: readonly unknown[],
  data: unknown,
  workspaceId: string,
  target: Set<string>,
): void {
  if (
    queryKey[0] !== "issues" ||
    queryKey[1] !== workspaceId
  ) {
    return;
  }

  if (
    queryKey.length === 4 &&
    queryKey[2] === "detail" &&
    typeof queryKey[3] === "string" &&
    isIssueDetailCache(data, workspaceId, queryKey[3])
  ) {
    target.add(data.id);
    return;
  }

  if (
    queryKey.length === 4 &&
    queryKey[2] === "identifier" &&
    typeof queryKey[3] === "string" &&
    data !== null &&
    isIssueRecord(data, workspaceId) &&
    data.identifier === queryKey[3]
  ) {
    target.add(data.id);
    return;
  }

  if (
    queryKey.length === 4 &&
    queryKey[2] === "list" &&
    isIssueListCache(data, workspaceId)
  ) {
    for (const bucket of Object.values(data.byStatus)) {
      for (const issue of bucket.issues) target.add(issue.id);
    }
    return;
  }

  if (
    queryKey[2] === "table-query" &&
    queryKey[3] === "rows" &&
    isIssueTableQuery(queryKey, data, workspaceId) &&
    isRecord(data) &&
    Array.isArray(data.rows)
  ) {
    for (const row of data.rows) {
      if (
        isRecord(row) &&
        isIssueRecord(row.issue, workspaceId)
      ) {
        target.add(row.issue.id);
      }
    }
  }
}

function collectChildIssueIds(
  queryKey: readonly unknown[],
  data: unknown,
  workspaceId: string,
  target: Set<string>,
): void {
  if (
    queryKey[0] !== "issues" ||
    queryKey[1] !== workspaceId ||
    queryKey[2] !== "children" ||
    queryKey.length !== 4 ||
    typeof queryKey[3] !== "string" ||
    !target.has(queryKey[3]) ||
    !isChildIssues(data, workspaceId, queryKey[3])
  ) {
    return;
  }
  for (const issue of data) target.add(issue.id);
}

function isIssueDetailResource(value: unknown): boolean {
  return (
    value === "timeline" ||
    value === "reactions" ||
    value === "subscribers" ||
    value === "usage" ||
    value === "attachments" ||
    value === "tasks"
  );
}

function isIssueDetailCache(
  value: unknown,
  workspaceId: string,
  keyId: string,
): value is Record<string, unknown> & { id: string } {
  return (
    isIssueRecord(value, workspaceId) &&
    (value.id === keyId || value.identifier === keyId)
  );
}

function isIssueRecord(
  value: unknown,
  workspaceId: string,
): value is Record<string, unknown> & { id: string } {
  return (
    isWorkspaceRecord(value, workspaceId) &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}

function isTimeline(
  value: unknown,
  workspaceId: string,
  issueId: string,
): boolean {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (
        !isRecord(entry) ||
        (entry.type !== "activity" && entry.type !== "comment") ||
        typeof entry.id !== "string" ||
        typeof entry.actor_type !== "string" ||
        typeof entry.actor_id !== "string" ||
        typeof entry.created_at !== "string"
      ) {
        return false;
      }
      if (entry.type === "comment" && typeof entry.content !== "string") {
        return false;
      }
      return (
        (entry.reactions === undefined ||
          (Array.isArray(entry.reactions) &&
            entry.reactions.every(isCommentReaction))) &&
        (entry.attachments === undefined ||
          (Array.isArray(entry.attachments) &&
            entry.attachments.every((attachment) =>
              isTimelineAttachment(attachment, workspaceId, issueId),
            )))
      );
    })
  );
}

function isTimelineAttachment(
  value: unknown,
  workspaceId: string,
  issueId: string,
): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.workspace_id === undefined || value.workspace_id === workspaceId) &&
    (value.issue_id === undefined ||
      value.issue_id === null ||
      value.issue_id === issueId)
  );
}

function isCommentReaction(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.emoji === "string" &&
    typeof value.actor_type === "string" &&
    typeof value.actor_id === "string"
  );
}

function isIssueReactions(value: unknown, issueId: string): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (reaction) =>
        isRecord(reaction) &&
        typeof reaction.id === "string" &&
        reaction.issue_id === issueId &&
        typeof reaction.actor_type === "string" &&
        typeof reaction.actor_id === "string" &&
        typeof reaction.emoji === "string",
    )
  );
}

function isIssueSubscribers(value: unknown, issueId: string): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (subscriber) =>
        isRecord(subscriber) &&
        subscriber.issue_id === issueId &&
        (subscriber.user_type === "member" ||
          subscriber.user_type === "agent") &&
        typeof subscriber.user_id === "string" &&
        typeof subscriber.reason === "string",
    )
  );
}

function isIssueUsage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const required = [
    "total_input_tokens",
    "total_output_tokens",
    "total_cache_read_tokens",
    "total_cache_write_tokens",
    "task_count",
  ];
  return required.every((key) => isNonNegativeInteger(value[key]));
}

function isIssueAttachments(
  value: unknown,
  workspaceId: string,
  issueId: string,
): boolean {
  return (
    Array.isArray(value) &&
    value.every((attachment) =>
      isIssueAttachment(attachment, workspaceId, issueId),
    )
  );
}

function isIssueAttachment(
  value: unknown,
  workspaceId: string,
  issueId: string,
): boolean {
  return (
    isWorkspaceRecord(value, workspaceId) &&
    typeof value.id === "string" &&
    value.issue_id === issueId &&
    typeof value.filename === "string" &&
    typeof value.content_type === "string" &&
    isNonNegativeInteger(value.size_bytes)
  );
}

function isIssueTasks(value: unknown, issueId: string): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (task) =>
        isRecord(task) &&
        typeof task.id === "string" &&
        task.issue_id === issueId &&
        typeof task.agent_id === "string" &&
        typeof task.runtime_id === "string" &&
        typeof task.status === "string",
    )
  );
}

function isChildIssues(
  value: unknown,
  workspaceId: string,
  parentIssueId: string,
): value is Array<Record<string, unknown> & { id: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (issue) =>
        isIssueRecord(issue, workspaceId) &&
        issue.parent_issue_id === parentIssueId,
    )
  );
}

function isChildProgress(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.progress) &&
    value.progress.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.parent_issue_id === "string" &&
        isNonNegativeInteger(entry.done) &&
        isNonNegativeInteger(entry.total) &&
        (entry.done as number) <= (entry.total as number),
    )
  );
}

function isIssueLabels(value: unknown, workspaceId: string): boolean {
  return isWorkspaceCollection(value, "labels", workspaceId);
}

function isLabelCatalog(
  value: unknown,
  workspaceId: string,
  resourceType: string,
): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.labels) &&
    value.labels.every(
      (label) =>
        isWorkspaceRecord(label, workspaceId) &&
        (label.resource_type === undefined ||
          label.resource_type === resourceType),
    )
  );
}

function isAssigneeFrequency(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.assignee_type === "string" &&
        entry.assignee_type.length > 0 &&
        typeof entry.assignee_id === "string" &&
        entry.assignee_id.length > 0 &&
        isNonNegativeInteger(entry.frequency),
    )
  );
}

function isWorkspaceCollection(
  value: unknown,
  field: string,
  workspaceId: string,
): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value[field]) &&
    value[field].every((entry) => isWorkspaceRecord(entry, workspaceId))
  );
}

function isWorkspaceRecordArray(
  value: unknown,
  workspaceId: string,
): boolean {
  return (
    Array.isArray(value) &&
    value.every((entry) => isWorkspaceRecord(entry, workspaceId))
  );
}

function isIssueTableQuery(
  queryKey: readonly unknown[],
  data: unknown,
  workspaceId: string,
): boolean {
  const kind = queryKey[3];
  if (kind === "facets" && queryKey.length === 5) {
    return isIssueTableFacets(data);
  }
  if (kind === "groups" && queryKey.length === 6) {
    return isInfiniteData(data, isIssueTableGroupsPage);
  }
  if (
    kind === "rows" &&
    queryKey.length === 10 &&
    queryKey[8] === "page"
  ) {
    return isIssueTableRowsPage(data, workspaceId);
  }
  return false;
}

function isIssueTableFacets(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.query_fingerprint === "string" &&
    isNonNegativeInteger(value.total) &&
    Array.isArray(value.facets) &&
    value.facets.every(
      (facet) =>
        isRecord(facet) &&
        typeof facet.kind === "string" &&
        Array.isArray(facet.values) &&
        facet.values.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.key === "string" &&
            isNonNegativeInteger(entry.count),
        ),
    )
  );
}

function isIssueTableGroupsPage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.query_fingerprint === "string" &&
    isNonNegativeInteger(value.total) &&
    Array.isArray(value.groups) &&
    value.groups.every(isIssueTableGroupDescriptor) &&
    (value.next_cursor === null || typeof value.next_cursor === "string")
  );
}

function isIssueTableGroupDescriptor(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    isRecord(value.value) &&
    typeof value.value.kind === "string" &&
    isNonNegativeInteger(value.count) &&
    (value.secondary_groups === undefined ||
      (Array.isArray(value.secondary_groups) &&
        value.secondary_groups.every(isIssueTableGroupDescriptor)))
  );
}

function isIssueTableRowsPage(
  value: unknown,
  workspaceId: string,
): boolean {
  return (
    isRecord(value) &&
    typeof value.query_fingerprint === "string" &&
    (value.group_key === null || typeof value.group_key === "string") &&
    (value.parent_id === null || typeof value.parent_id === "string") &&
    isNonNegativeInteger(value.total) &&
    isNonNegativeInteger(value.branch_total) &&
    Array.isArray(value.rows) &&
    value.rows.every(
      (row) =>
        isRecord(row) &&
        isWorkspaceRecord(row.issue, workspaceId) &&
        typeof row.issue.id === "string" &&
        isNonNegativeInteger(row.direct_child_count),
    ) &&
    (value.next_cursor === null || typeof value.next_cursor === "string")
  );
}

function isChatMessagesInfiniteData(
  value: unknown,
  sessionId: string,
): boolean {
  return isInfiniteData(value, (page) => isChatMessagesPage(page, sessionId));
}

function isChatMessagesPage(value: unknown, sessionId: string): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.messages) &&
    value.messages.every(
      (message) =>
        isRecord(message) &&
        typeof message.id === "string" &&
        message.chat_session_id === sessionId &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    ) &&
    isNonNegativeInteger(value.limit) &&
    typeof value.has_more === "boolean" &&
    (value.next_cursor === undefined ||
      value.next_cursor === null ||
      (isRecord(value.next_cursor) &&
        typeof value.next_cursor.created_at === "string" &&
        typeof value.next_cursor.id === "string"))
  );
}

function isInfiniteData(
  value: unknown,
  validatePage: (page: unknown) => boolean,
): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.pages) &&
    value.pages.length > 0 &&
    value.pages.every(validatePage) &&
    Array.isArray(value.pageParams) &&
    value.pageParams.length === value.pages.length
  );
}

function isIssueListCache(
  value: unknown,
  workspaceId: string,
): value is {
  byStatus: Record<
    string,
    {
      issues: Array<Record<string, unknown> & { id: string }>;
      total: number;
    }
  >;
} {
  if (!isRecord(value) || !isRecord(value.byStatus)) return false;
  return Object.values(value.byStatus).every(
    (bucket) =>
      isRecord(bucket) &&
      Array.isArray(bucket.issues) &&
      typeof bucket.total === "number" &&
      Number.isSafeInteger(bucket.total) &&
      bucket.total >= 0 &&
      bucket.issues.every((issue) => isIssueRecord(issue, workspaceId)),
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

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
