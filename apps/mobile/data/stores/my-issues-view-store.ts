/**
 * Mobile-only zustand store for the My Issues view (scope + status/priority
 * filters). Mirrors the field shape of web's
 * `packages/core/issues/stores/my-issues-view-store.ts` so the same filter
 * input produces the same visible issue set on both clients (the "same N
 * rule" in apps/mobile/CLAUDE.md). Mobile cannot import core's runtime, so
 * this is re-implemented locally.
 *
 * Mobile seeds statusFilters with the "active work" default set so completed
 * issues stay hidden until the user explicitly opts in from the filter sheet.
 *
 * No persist middleware in v1 — matches the existing mobile pattern
 * (auth-store / workspace-store use SecureStore manually for the few values
 * that need restart survival; everything else is in-memory). v2 can add
 * AsyncStorage persistence if cross-restart filter survival is desired.
 */
import { create } from "zustand";
import type { IssuePriority, IssueStatus } from "@multica/core/types";
import type { MyIssuesScope } from "@/data/queries/issue-keys";
import { DEFAULT_MOBILE_ISSUE_STATUS_FILTERS } from "@/lib/issue-filter-defaults";

interface MyIssuesViewState {
  scope: MyIssuesScope;
  statusFilters: IssueStatus[];
  priorityFilters: IssuePriority[];
  setScope: (scope: MyIssuesScope) => void;
  toggleStatusFilter: (status: IssueStatus) => void;
  togglePriorityFilter: (priority: IssuePriority) => void;
  clearFilters: () => void;
}

export const useMyIssuesViewStore = create<MyIssuesViewState>((set) => ({
  scope: "all",
  statusFilters: DEFAULT_MOBILE_ISSUE_STATUS_FILTERS,
  priorityFilters: [],
  setScope: (scope) => set({ scope }),
  toggleStatusFilter: (status) =>
    set((state) => ({
      statusFilters: state.statusFilters.includes(status)
        ? state.statusFilters.filter((s) => s !== status)
        : [...state.statusFilters, status],
    })),
  togglePriorityFilter: (priority) =>
    set((state) => ({
      priorityFilters: state.priorityFilters.includes(priority)
        ? state.priorityFilters.filter((p) => p !== priority)
        : [...state.priorityFilters, priority],
    })),
  clearFilters: () =>
    set({
      statusFilters: DEFAULT_MOBILE_ISSUE_STATUS_FILTERS,
      priorityFilters: [],
    }),
}));
