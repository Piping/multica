/**
 * Mobile chat mutations — create session, delete session, mark session read.
 *
 * Send-message is NOT a mutation: the chat screen runs a hand-written
 * optimistic burst (seed messages cache → seed pendingTask cache → flip
 * activeSession → POST → patch with real task_id) that doesn't map cleanly
 * onto useMutation. See the chat tab screen for the send path.
 *
 * Mirrors the optimistic-update + rollback + onSettled-invalidate pattern
 * of data/mutations/inbox.ts and web's packages/core/chat/mutations.ts.
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChatMessage, ChatPendingTask, ChatSession } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import { chatKeys } from "@/data/queries/chat";

export function useCreateChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: { agent_id: string; title?: string }) =>
      api.createChatSession(data),
    onSettled: () => {
      // Optimistic prepend isn't done here — the chat screen seeds caches
      // synchronously around its send burst and uses the returned session
      // id directly. The invalidate ensures the dropdown picks up the new
      // row (and any has_unread / title server defaults) without a refetch
      // race on switch.
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteChatSession(id),
    onMutate: async (id) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old ? old.filter((s) => s.id !== id) : old,
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
      // Detail-side caches the screen may still hold for this id.
      qc.removeQueries({ queryKey: chatKeys.messages(id) });
      qc.removeQueries({ queryKey: chatKeys.pendingTask(id) });
    },
  });
}

export function useMarkChatSessionRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (sessionId: string) => api.markChatSessionRead(sessionId),
    onMutate: async (sessionId) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) =>
          s.id === sessionId ? { ...s, has_unread: false } : s,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

function invalidateSessionChat(qc: QueryClient, sessionId: string) {
  qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
  qc.invalidateQueries({ queryKey: chatKeys.pendingTask(sessionId) });
}

export function useWithdrawLastChatMessage() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (sessionId: string) => api.withdrawLastChatMessage(sessionId),
    onSettled: (_data, _err, sessionId) => {
      invalidateSessionChat(qc, sessionId);
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useRegenerateLastChatMessage() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (sessionId: string) => api.regenerateLastChatMessage(sessionId),
    onSuccess: (res, sessionId) => {
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
        task_id: res.task_id,
        status: "queued",
        created_at: res.created_at,
      });
    },
    onSettled: (_data, _err, sessionId) => {
      qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useResendLastChatMessage() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (sessionId: string) => api.resendLastChatMessage(sessionId),
    onSuccess: (res, sessionId) => {
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
        task_id: res.task_id,
        status: "queued",
        created_at: res.created_at,
      });
    },
    onSettled: (_data, _err, sessionId) => {
      qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useUpdateChatMessage() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({
      sessionId,
      messageId,
      content,
    }: {
      sessionId: string;
      messageId: string;
      content: string;
    }) => api.updateChatMessage(sessionId, messageId, content),
    onSuccess: (message, vars) => {
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(vars.sessionId), (old) => {
        if (!old) return [message];
        const editedAt = new Date(message.created_at).getTime();
        return old
          .filter((m) => {
            const ts = new Date(m.created_at).getTime();
            return Number.isFinite(ts) && Number.isFinite(editedAt)
              ? ts <= editedAt
              : m.id === message.id;
          })
          .map((m) => (m.id === message.id ? message : m));
      });
      qc.setQueryData(chatKeys.pendingTask(vars.sessionId), {});
    },
    onSettled: (_data, _err, vars) => {
      invalidateSessionChat(qc, vars.sessionId);
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}
