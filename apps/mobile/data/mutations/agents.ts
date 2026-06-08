/** Mobile-owned agent mutations. Mirrors the optimistic list patch used by
 * web's AgentDetailPage, but binds to mobile's `agentListOptions` key shape. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, CreateAgentRequest, UpdateAgentRequest } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";

const agentKeys = {
  list: (wsId: string | null) => ["agents", wsId] as const,
};

export function useUpdateAgent(agentId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (patch: UpdateAgentRequest) => api.updateAgent(agentId, patch),
    onMutate: async (patch) => {
      const key = agentKeys.list(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Agent[]>(key);
      qc.setQueryData<Agent[]>(key, (old) =>
        old?.map((agent) =>
          agent.id === agentId ? ({ ...agent, ...patch } as Agent) : agent,
        ),
      );
      return { key, prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSuccess: (updated) => {
      qc.setQueryData<Agent[]>(agentKeys.list(wsId), (old) =>
        old?.map((agent) => (agent.id === updated.id ? updated : agent)),
      );
    },
    onSettled: (_data, _err, _vars, ctx) => {
      qc.invalidateQueries({ queryKey: ctx?.key ?? agentKeys.list(wsId) });
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (payload: CreateAgentRequest) => api.createAgent(payload),
    onSuccess: (agent) => {
      qc.setQueryData<Agent[]>(agentKeys.list(wsId), (old) =>
        old ? [agent, ...old.filter((candidate) => candidate.id !== agent.id)] : [agent],
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
    },
  });
}
