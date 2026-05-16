import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

// RFC v6.1 / §6.2: query keys for the Computer aggregate surface. Coexists
// with `runtimes/queries.ts` until the legacy /runtimes UI is removed.
//
// Workspace-scoped keys mean a workspace switch automatically swaps the
// cache; we never have to invalidate manually on a slug change.
export const computerKeys = {
  all: (wsId: string) => ["computers", wsId] as const,
  list: (wsId: string) => [...computerKeys.all(wsId), "list"] as const,
  detail: (wsId: string, id: string) => [...computerKeys.all(wsId), "detail", id] as const,
};

// computerListOptions drives the Computers index page. Each row is the
// daemon-level rollup of every agent_runtime under it. The Install page
// (which polls until the new daemon appears) reuses this same query and
// just filters on the returned list.
export function computerListOptions(wsId: string) {
  return queryOptions({
    queryKey: computerKeys.list(wsId),
    queryFn: () => api.listComputers(),
  });
}

// computerDetailOptions returns the per-daemon aggregate including the
// nested runtimes[] array, used by the detail page (Overview / Agent
// runtimes / Activity tabs).
export function computerDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: computerKeys.detail(wsId, id),
    queryFn: () => api.getComputer(id),
    // Detail page polls the same key on a 30s rhythm so "Last seen" stays
    // fresh while the user is looking at the page. Stale-time stays low so
    // a manual refresh always re-fetches.
    staleTime: 15 * 1000,
  });
}
