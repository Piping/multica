import type { TimelineEntry } from "@multica/core/types";

export interface CommentThreadOption {
  rootCommentId: string | null;
  actorName: string;
  preview: string;
  replyCount: number;
  resolved: boolean;
  lastActivityAt: string;
}

export function buildCommentThreadOptions(args: {
  entries: TimelineEntry[] | undefined;
  getActorName: (
    type: "member" | "agent" | "squad" | null | undefined,
    id: string | null | undefined,
  ) => string;
}): CommentThreadOption[] {
  const { entries, getActorName } = args;
  if (!entries || entries.length === 0) return [];

  const rootIds = new Set<string>();
  const replyCounts = new Map<string, number>();
  const lastActivity = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type !== "comment") continue;
    if (!entry.parent_id) {
      rootIds.add(entry.id);
      if (!replyCounts.has(entry.id)) replyCounts.set(entry.id, 0);
      lastActivity.set(entry.id, entry.created_at);
      continue;
    }
    replyCounts.set(entry.parent_id, (replyCounts.get(entry.parent_id) ?? 0) + 1);
    const prev = lastActivity.get(entry.parent_id);
    if (!prev || prev.localeCompare(entry.created_at) < 0) {
      lastActivity.set(entry.parent_id, entry.created_at);
    }
  }

  const options: CommentThreadOption[] = [];
  for (const entry of entries) {
    if (entry.type !== "comment" || entry.parent_id || !rootIds.has(entry.id)) {
      continue;
    }
    options.push({
      rootCommentId: entry.id,
      actorName: getActorName(
        entry.actor_type as "member" | "agent" | "squad" | null | undefined,
        entry.actor_id,
      ),
      preview: entry.content ?? "",
      replyCount: replyCounts.get(entry.id) ?? 0,
      resolved: !!entry.resolved_at,
      lastActivityAt: lastActivity.get(entry.id) ?? entry.created_at,
    });
  }

  options.sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt));
  return options;
}
