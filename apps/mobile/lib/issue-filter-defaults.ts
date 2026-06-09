import type { IssuePriority, IssueStatus } from "@multica/core/types";
import { BOARD_STATUSES } from "@/lib/issue-status";

/**
 * Mobile issue lists default to active work only. Completed issues remain
 * available through the filter sheet, but the first render hides them so the
 * phone list behaves like a triage queue instead of an archive.
 */
export const DEFAULT_MOBILE_ISSUE_STATUS_FILTERS: IssueStatus[] =
  BOARD_STATUSES.filter((status) => status !== "done");

export function isDefaultMobileIssueStatusFilters(
  statusFilters: IssueStatus[],
): boolean {
  return (
    statusFilters.length === DEFAULT_MOBILE_ISSUE_STATUS_FILTERS.length &&
    DEFAULT_MOBILE_ISSUE_STATUS_FILTERS.every((status) =>
      statusFilters.includes(status),
    )
  );
}

export function hasCustomMobileIssueFilters(
  statusFilters: IssueStatus[],
  priorityFilters: IssuePriority[],
): boolean {
  return (
    priorityFilters.length > 0 ||
    !isDefaultMobileIssueStatusFilters(statusFilters)
  );
}
