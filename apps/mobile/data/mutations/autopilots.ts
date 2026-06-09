import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  Autopilot,
  AutopilotRun,
  AutopilotTrigger,
  CreateAutopilotRequest,
  CreateAutopilotTriggerRequest,
  GetAutopilotResponse,
  UpdateAutopilotRequest,
  UpdateAutopilotTriggerRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { autopilotKeys } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useCreateAutopilot() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (body: CreateAutopilotRequest) => api.createAutopilot(body),
    onSuccess: (autopilot) => {
      qc.setQueryData<Autopilot[]>(autopilotKeys.list(wsId), (old) =>
        old
          ? [autopilot, ...old.filter((item) => item.id !== autopilot.id)]
          : [autopilot],
      );
      qc.setQueryData<GetAutopilotResponse>(
        autopilotKeys.detail(wsId, autopilot.id),
        { autopilot, triggers: [] },
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: autopilotKeys.lists(wsId) });
    },
  });
}

export function useUpdateAutopilot(autopilotId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (patch: UpdateAutopilotRequest) =>
      api.updateAutopilot(autopilotId, patch),
    onMutate: async (patch) => {
      const listKey = autopilotKeys.list(wsId);
      const detailKey = autopilotKeys.detail(wsId, autopilotId);
      await Promise.all([
        qc.cancelQueries({ queryKey: autopilotKeys.lists(wsId) }),
        qc.cancelQueries({ queryKey: detailKey }),
      ]);

      const prevList = qc.getQueryData<Autopilot[]>(listKey);
      const prevDetail = qc.getQueryData<GetAutopilotResponse>(detailKey);

      qc.setQueryData<Autopilot[]>(listKey, (old) =>
        old?.map((item) =>
          item.id === autopilotId ? ({ ...item, ...patch } as Autopilot) : item,
        ),
      );
      qc.setQueryData<GetAutopilotResponse>(detailKey, (old) =>
        old
          ? {
              ...old,
              autopilot: { ...old.autopilot, ...patch } as Autopilot,
            }
          : old,
      );

      return { listKey, detailKey, prevList, prevDetail };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      if (ctx.prevList !== undefined) qc.setQueryData(ctx.listKey, ctx.prevList);
      if (ctx.prevDetail !== undefined) {
        qc.setQueryData(ctx.detailKey, ctx.prevDetail);
      }
    },
    onSuccess: (autopilot) => {
      qc.setQueryData<Autopilot[]>(autopilotKeys.list(wsId), (old) =>
        old?.map((item) => (item.id === autopilot.id ? autopilot : item)),
      );
      qc.setQueryData<GetAutopilotResponse>(
        autopilotKeys.detail(wsId, autopilot.id),
        (old) =>
          old
            ? {
                ...old,
                autopilot,
              }
            : { autopilot, triggers: [] },
      );
      qc.invalidateQueries({ queryKey: autopilotKeys.lists(wsId) });
    },
  });
}

export function useDeleteAutopilot(autopilotId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: () => api.deleteAutopilot(autopilotId),
    onMutate: async () => {
      const listKey = autopilotKeys.list(wsId);
      await qc.cancelQueries({ queryKey: listKey });
      const prevList = qc.getQueryData<Autopilot[]>(listKey);
      qc.setQueryData<Autopilot[]>(listKey, (old) =>
        old ? old.filter((item) => item.id !== autopilotId) : old,
      );
      return { listKey, prevList };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList !== undefined) {
        qc.setQueryData(ctx.listKey, ctx.prevList);
      }
    },
    onSettled: () => {
      qc.removeQueries({ queryKey: autopilotKeys.detail(wsId, autopilotId) });
      qc.removeQueries({ queryKey: autopilotKeys.runs(wsId, autopilotId) });
      qc.invalidateQueries({ queryKey: autopilotKeys.lists(wsId) });
    },
  });
}

export function useTriggerAutopilot(autopilotId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: () => api.triggerAutopilot(autopilotId),
    onSuccess: (run) => {
      qc.setQueryData<AutopilotRun[]>(autopilotKeys.runs(wsId, autopilotId), (old) =>
        old ? [run, ...old.filter((item) => item.id !== run.id)] : [run],
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: autopilotKeys.detail(wsId, autopilotId) });
      qc.invalidateQueries({ queryKey: autopilotKeys.lists(wsId) });
      qc.invalidateQueries({ queryKey: autopilotKeys.runs(wsId, autopilotId) });
    },
  });
}

export function useCreateAutopilotTrigger(autopilotId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (body: CreateAutopilotTriggerRequest) =>
      api.createAutopilotTrigger(autopilotId, body),
    onSuccess: (trigger) => {
      qc.setQueryData<GetAutopilotResponse>(
        autopilotKeys.detail(wsId, autopilotId),
        (old) =>
          old
            ? {
                ...old,
                triggers: [...old.triggers.filter((item) => item.id !== trigger.id), trigger],
              }
            : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: autopilotKeys.detail(wsId, autopilotId) });
    },
  });
}

export function useUpdateAutopilotTrigger(
  autopilotId: string,
  triggerId: string,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (body: UpdateAutopilotTriggerRequest) =>
      api.updateAutopilotTrigger(autopilotId, triggerId, body),
    onSuccess: (trigger) => {
      patchTriggerInDetail(qc, wsId, autopilotId, trigger);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: autopilotKeys.detail(wsId, autopilotId) });
    },
  });
}

export function useDeleteAutopilotTrigger(
  autopilotId: string,
  triggerId: string,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: () => api.deleteAutopilotTrigger(autopilotId, triggerId),
    onSuccess: () => {
      qc.setQueryData<GetAutopilotResponse>(
        autopilotKeys.detail(wsId, autopilotId),
        (old) =>
          old
            ? {
                ...old,
                triggers: old.triggers.filter((trigger) => trigger.id !== triggerId),
              }
            : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: autopilotKeys.detail(wsId, autopilotId) });
    },
  });
}

export function useRotateAutopilotTriggerWebhookToken(
  autopilotId: string,
  triggerId: string,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: () =>
      api.rotateAutopilotTriggerWebhookToken(autopilotId, triggerId),
    onSuccess: (trigger) => {
      patchTriggerInDetail(qc, wsId, autopilotId, trigger);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: autopilotKeys.detail(wsId, autopilotId) });
    },
  });
}

function patchTriggerInDetail(
  qc: QueryClient,
  wsId: string | null,
  autopilotId: string,
  trigger: AutopilotTrigger,
) {
  qc.setQueryData<GetAutopilotResponse>(
    autopilotKeys.detail(wsId, autopilotId),
    (old) =>
      old
        ? {
            ...old,
            triggers: old.triggers.map((item) =>
              item.id === trigger.id ? trigger : item,
            ),
          }
        : old,
  );
}
