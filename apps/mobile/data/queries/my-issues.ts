/**
 * "My Issues" list, server-filtered by scope. Mobile adds an `all` scope as
 * the default phone landing view so the tab works as a quick workspace issue
 * inbox instead of hiding everything not assigned to the current user.
 * The other three scopes mirror web's My Issues page:
 *   - all:      every issue in the workspace
 *   - assigned: issues where assignee_id = me
 *   - created:  issues where creator_id  = me
 *   - agents:   issues where the assignee is an *indirect* extension of me —
 *               an owned agent, OR a squad I'm a human member of, lead, or
 *               have an owned agent inside. Driven server-side by the
 *               `involves_user_id` predicate (see MUL-2397, 2026-05-19).
 *               Direct member assignment is intentionally EXCLUDED — that's
 *               the `assigned` scope's meaning.
 *
 * Cache key shape is `issueKeys.myList(wsId, scope, filter)` — same prefix
 * as web's `packages/core/issues/queries.ts` so a future WS handler can
 * invalidate `issueKeys.myAll(wsId)` and reach both clients.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import {
  issueKeys,
  type MyIssuesFilter,
  type MyIssuesScope,
} from "./issue-keys";

export function buildMyIssuesFilter(
  scope: MyIssuesScope,
  userId: string,
): MyIssuesFilter {
  switch (scope) {
    case "all":
      return {};
    case "assigned":
      return { assignee_id: userId };
    case "created":
      return { creator_id: userId };
    case "agents":
      return { involves_user_id: userId };
  }
}

export const myIssueListOptions = (
  wsId: string | null,
  scope: MyIssuesScope,
  filter: MyIssuesFilter,
) =>
  queryOptions({
    queryKey: issueKeys.myList(wsId, scope, filter),
    queryFn: async ({ signal }) => {
      const res = await api.listIssues(filter, { signal });
      return res.issues;
    },
    enabled: !!wsId,
  });
