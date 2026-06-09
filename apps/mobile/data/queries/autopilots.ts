import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const autopilotKeys = {
  all: (wsId: string | null) => ["autopilots", wsId] as const,
  lists: (wsId: string | null) => [...autopilotKeys.all(wsId), "list"] as const,
  list: (wsId: string | null, status?: string) =>
    [...autopilotKeys.lists(wsId), status ?? "all"] as const,
  detail: (wsId: string | null, id: string) =>
    [...autopilotKeys.all(wsId), "detail", id] as const,
  runs: (wsId: string | null, id: string) =>
    [...autopilotKeys.all(wsId), "runs", id] as const,
};

export const autopilotListOptions = (
  wsId: string | null,
  opts?: { status?: string },
) =>
  queryOptions({
    queryKey: autopilotKeys.list(wsId, opts?.status),
    queryFn: async ({ signal }) => {
      const res = await api.listAutopilots({
        status: opts?.status,
        signal,
      });
      return res.autopilots;
    },
    enabled: !!wsId,
  });

export const autopilotDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: autopilotKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getAutopilot(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const autopilotRunsOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: autopilotKeys.runs(wsId, id),
    queryFn: async ({ signal }) => {
      const res = await api.listAutopilotRuns(id, { signal, limit: 20 });
      return res.runs;
    },
    enabled: !!wsId && !!id,
  });
