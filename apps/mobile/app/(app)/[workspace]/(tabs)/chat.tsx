/**
 * Chat tab — single-screen IA.
 *
 * Layout:
 *   View ─ Header(center: ChatTitleButton, right: ChatSessionActions)
 *        ─ (NoAgentBanner?)
 *        ─ View ─ ChatMessageList (includes live status + timeline in
 *                                  its ListFooterComponent)
 *               ─ OfflineBanner
 *               ─ ChatComposer (sticks to keyboard via KeyboardStickyView)
 *
 * Session switching, agent selection, and session deletion all happen
 * inside this screen via Modal sheets — there is no `/chat/[id]` sub-route.
 *
 * State:
 *   - activeSessionId   — locally controlled current session id
 *                         (last non-null value is persisted per workspace so
 *                         app remounts reopen the same conversation)
 *   - selectedAgentId   — overrides currentSession.agent_id when set (used
 *                         when starting a new chat with a freshly-picked agent)
 *   - sessionSheetOpen  — bottom modal visibility
 *   - agentPickerOpen   — bottom modal visibility
 *
 * Side effects:
 *   - useChatSessionRealtime(activeSessionId) for per-record WS events
 *   - auto markRead when entering a session with has_unread
 *   - ensureSession dedupe ref for concurrent first-message sends
 *
 * Optimistic send burst mirrors web's chat-window.tsx send sequence
 * (packages/views/chat/components/chat-window.tsx ~262-345):
 *   seed messages → seed pendingTask → flip activeSessionId → POST →
 *   patch pendingTask with server task_id + created_at.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  View,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  ChatMessage,
  ChatPendingTask,
} from "@multica/core/types";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import {
  chatKeys,
  chatMessagesOptions,
  chatSessionsOptions,
  pendingChatTaskOptions,
  taskMessagesOptions,
} from "@/data/queries/chat";
import {
  useCreateChatSession,
  useDeleteChatSession,
  useMarkChatSessionRead,
  useRegenerateLastChatMessage,
  useResendLastChatMessage,
  useUpdateChatMessage,
  useWithdrawLastChatMessage,
} from "@/data/mutations/chat";
import {
  DRAFT_NEW_SESSION,
  useChatDraftsStore,
} from "@/data/stores/chat-drafts-store";
import { useChatLastSessionStore } from "@/data/stores/chat-last-session-store";
import { useChatSessionPickerStore } from "@/data/stores/chat-session-picker-store";
import { useChatSessionRealtime } from "@/data/realtime/use-chat-session-realtime";
import { useChatSessionRecovery } from "@/data/realtime/use-chat-session-recovery";
import { canAssignAgent } from "@/lib/can-assign-agent";
import { useWorkspaceAgentAvailability } from "@/lib/workspace-agent-availability";
import { useAgentPresence } from "@/lib/use-agent-presence";
import { Header } from "@/components/ui/header";
import { ChatTitleButton } from "@/components/chat/chat-title-button";
import { ChatSessionActions } from "@/components/chat/chat-session-actions";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatComposer } from "@/components/chat/chat-composer";
import { AgentPickerSheet } from "@/components/chat/agent-picker-sheet";
import { NoAgentBanner } from "@/components/chat/no-agent-banner";
import { OfflineBanner } from "@/components/chat/offline-banner";
import { EditMessageSheet } from "@/components/chat/edit-message-sheet";
import { useChatSelectStore } from "@/data/chat-select-store";

export default function ChatTab() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);

  // Bridge to the chat-sessions formSheet route. Mirror local
  // activeSessionId into the store so the picker can render the current
  // selection's check mark; consume the picker's one-shot select request
  // via useEffect.
  const setStoreActiveSessionId = useChatSessionPickerStore(
    (s) => s.setActiveSessionId,
  );
  const selectRequest = useChatSessionPickerStore((s) => s.selectRequest);
  const consumeSelect = useChatSessionPickerStore((s) => s.consumeSelect);
  useEffect(() => {
    setStoreActiveSessionId(activeSessionId);
  }, [activeSessionId, setStoreActiveSessionId]);

  const lastSessionHydrated = useChatLastSessionStore((s) => s.hydrated);
  const lastSessionByWorkspace = useChatLastSessionStore((s) => s.byWorkspace);
  const rememberLastSession = useChatLastSessionStore((s) => s.remember);
  const restoreLastSessions = useChatLastSessionStore((s) => s.restore);
  useEffect(() => {
    if (lastSessionHydrated) return;
    void restoreLastSessions();
  }, [lastSessionHydrated, restoreLastSessions]);

  // ── Server state ───────────────────────────────────────────────────────
  const {
    data: sessions = [],
    isFetched: sessionsFetched,
  } = useQuery(chatSessionsOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  // ── Auto-hydrate active session on first Chat tab entry ────────────────
  // Mobile-only deviation from web: web's chat-window opens to an empty
  // state when no `activeSessionId` is persisted; on a phone, picking
  // a session is 4 taps, so jump straight to the most recent session.
  // Hydration is one-shot per workspace.
  const [hydratedWorkspaceId, setHydratedWorkspaceId] = useState<string | null>(
    null,
  );
  const rememberedSessionId = wsId ? lastSessionByWorkspace[wsId] ?? null : null;
  useEffect(() => {
    if (!wsId) return;
    if (!sessionsFetched || !lastSessionHydrated) return;
    if (hydratedWorkspaceId === wsId) return;
    if (sessions.length === 0) {
      setHydratedWorkspaceId(wsId);
      return;
    }
    const nextSessionId =
      rememberedSessionId &&
      sessions.some((session) => session.id === rememberedSessionId)
        ? rememberedSessionId
        : sessions[0].id;
    setSelectedAgentId(null);
    setActiveSessionId(nextSessionId);
    setHydratedWorkspaceId(wsId);
  }, [
    wsId,
    sessions,
    sessionsFetched,
    lastSessionHydrated,
    rememberedSessionId,
    hydratedWorkspaceId,
  ]);

  useEffect(() => {
    if (!wsId || !activeSessionId) return;
    void rememberLastSession(wsId, activeSessionId);
  }, [wsId, activeSessionId, rememberLastSession]);
  const { data: messages = [], isLoading: messagesLoading } = useQuery(
    chatMessagesOptions(activeSessionId),
  );
  const { data: pendingTask } = useQuery(
    pendingChatTaskOptions(activeSessionId),
  );
  // Live execution trace for the in-flight task. `task:message` WS events
  // append rows to this same cache key via `appendTaskMessage`, so the
  // list/pill stay in sync without a polling fetch. `enabled` is gated by
  // `isTaskMessageTaskId` inside taskMessagesOptions — optimistic ids
  // never hit the network.
  const { data: liveTaskMessages = [] } = useQuery(
    taskMessagesOptions(pendingTask?.task_id),
  );

  // ── Derived ────────────────────────────────────────────────────────────
  const memberRole = useMemo(
    () => members.find((m) => m.user_id === userId)?.role,
    [members, userId],
  );

  const availableAgents = useMemo(
    () =>
      agents.filter(
        (a) => !a.archived_at && canAssignAgent(a, userId, memberRole),
      ),
    [agents, userId, memberRole],
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // Active agent: explicit selection wins; otherwise inherit from the
  // active session; otherwise pick the first available agent.
  const currentAgent: Agent | null = useMemo(() => {
    if (selectedAgentId) {
      return availableAgents.find((a) => a.id === selectedAgentId) ?? null;
    }
    if (activeSession) {
      return agents.find((a) => a.id === activeSession.agent_id) ?? null;
    }
    return availableAgents[0] ?? null;
  }, [selectedAgentId, availableAgents, activeSession, agents]);

  const availability = useWorkspaceAgentAvailability();
  const presenceDetail = useAgentPresence(wsId, currentAgent?.id);
  const presenceAvailability =
    presenceDetail === "loading" ? undefined : presenceDetail.availability;
  const isArchived = activeSession?.status === "archived";
  const sending = !!pendingTask?.task_id;

  // ── Drafts ─────────────────────────────────────────────────────────────
  const draftKey = activeSessionId ?? DRAFT_NEW_SESSION;
  const draft = useChatDraftsStore((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChatDraftsStore((s) => s.setDraft);
  const clearDraft = useChatDraftsStore((s) => s.clearDraft);
  const promoteNewDraft = useChatDraftsStore((s) => s.promoteNewDraft);
  const isFocused = useIsFocused();

  // ── Realtime ───────────────────────────────────────────────────────────
  const handleSessionDeleted = useCallback(() => {
    setActiveSessionId(null);
  }, []);
  useChatSessionRealtime(activeSessionId, handleSessionDeleted);
  useChatSessionRecovery(
    activeSessionId,
    pendingTask?.task_id,
    isFocused && !!pendingTask?.task_id,
  );

  // Exit text-selection mode whenever the chat tab loses focus. Expo
  // Router bottom tabs stay mounted across tab switches, so a plain
  // useEffect cleanup wouldn't fire — useFocusEffect is the navigation-
  // aware equivalent.
  useFocusEffect(
    useCallback(() => () => useChatSelectStore.getState().clear(), []),
  );

  // ── Auto markRead while viewing a session with unread state ──────────
  const markRead = useMarkChatSessionRead();
  useEffect(() => {
    if (!isFocused) return;
    if (!activeSessionId) return;
    if (!activeSession?.has_unread) return;
    markRead.mutate(activeSessionId);
  }, [isFocused, activeSessionId, activeSession?.has_unread, markRead]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const createSession = useCreateChatSession();
  const deleteSession = useDeleteChatSession();
  const withdrawLast = useWithdrawLastChatMessage();
  const regenerateLast = useRegenerateLastChatMessage();
  const resendLast = useResendLastChatMessage();
  const updateMessage = useUpdateChatMessage();

  // ── Send burst ─────────────────────────────────────────────────────────
  const sessionPromiseRef = useRef<Promise<string | null> | null>(null);

  const ensureSession = useCallback(
    async (titleSeed: string): Promise<string | null> => {
      if (activeSessionId) return activeSessionId;
      if (!currentAgent) return null;
      if (sessionPromiseRef.current) return sessionPromiseRef.current;

      const promise = (async () => {
        try {
          const session = await createSession.mutateAsync({
            agent_id: currentAgent.id,
            title: titleSeed.slice(0, 50),
          });
          return session.id;
        } finally {
          sessionPromiseRef.current = null;
        }
      })();
      sessionPromiseRef.current = promise;
      return promise;
    },
    [activeSessionId, currentAgent, createSession],
  );

  const handleSend = useCallback(
    async (content: string, attachmentIds: string[] = []) => {
      if (!currentAgent) return;

      const isNewSession = !activeSessionId;
      const sessionId = await ensureSession(content);
      if (!sessionId) return;

      const sentAt = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        chat_session_id: sessionId,
        role: "user",
        content,
        task_id: null,
        created_at: sentAt,
      };
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
        task_id: `optimistic-${optimistic.id}`,
        status: "queued",
        created_at: sentAt,
      });
      if (isNewSession) {
        promoteNewDraft(sessionId);
        setActiveSessionId(sessionId);
      }

      try {
        const result = await api.sendChatMessage(sessionId, content, {
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        });
        qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
          task_id: result.task_id,
          status: "queued",
          created_at: result.created_at,
        });
        qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
        clearDraft(sessionId);
      } catch (err) {
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
          old ? old.filter((m) => m.id !== optimistic.id) : old,
        );
        qc.setQueryData(chatKeys.pendingTask(sessionId), {});
        throw err;
      }
    },
    [
      activeSessionId,
      currentAgent,
      ensureSession,
      qc,
      promoteNewDraft,
      clearDraft,
    ],
  );

  // ── Cancel in-flight ───────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    if (!pendingTask?.task_id || !activeSessionId) return;
    qc.setQueryData(chatKeys.pendingTask(activeSessionId), {});
    void api.cancelTaskById(pendingTask.task_id).catch(() => {
      // Silent — task may have already terminated server-side.
    });
  }, [pendingTask?.task_id, activeSessionId, qc]);

  const mutateLastTurn = useCallback(
    (kind: "withdraw" | "regenerate" | "resend") => {
      if (!activeSessionId) return;
      if (kind === "withdraw") withdrawLast.mutate(activeSessionId);
      else if (kind === "regenerate") regenerateLast.mutate(activeSessionId);
      else resendLast.mutate(activeSessionId);
    },
    [activeSessionId, regenerateLast, resendLast, withdrawLast],
  );

  const handleSaveEditedMessage = useCallback(
    (message: ChatMessage, content: string) => {
      if (!activeSessionId) return;
      updateMessage.mutate(
        { sessionId: activeSessionId, messageId: message.id, content },
        { onSuccess: () => setEditingMessage(null) },
      );
    },
    [activeSessionId, updateMessage],
  );

  // ── Header / sheet actions ─────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    if (availableAgents.length > 1) {
      setAgentPickerOpen(true);
      return;
    }
    setSelectedAgentId(null);
    setActiveSessionId(null);
  }, [availableAgents.length]);

  const handlePickAgent = useCallback((agent: Agent) => {
    setSelectedAgentId(agent.id);
    setActiveSessionId(null);
  }, []);

  // Apply the user's pick from the chat-sessions route (or "no session"
  // when they delete the active one in the sheet).
  useEffect(() => {
    if (!selectRequest) return;
    setSelectedAgentId(null);
    setActiveSessionId(selectRequest.id);
    consumeSelect();
  }, [selectRequest, consumeSelect]);

  const handleDeleteActive = useCallback(() => {
    if (!activeSession) return;
    Alert.alert(
      "Delete this chat?",
      activeSession.title || "Untitled chat",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const id = activeSession.id;
            setActiveSessionId(null);
            deleteSession.mutate(id);
          },
        },
      ],
      { cancelable: true },
    );
  }, [activeSession, deleteSession]);

  // ── Composer disabled-state ────────────────────────────────────────────
  const disabled =
    !currentAgent || availability === "none" || isArchived === true;
  const disabledReason = !currentAgent
    ? "No agent selected"
    : availability === "none"
      ? "No agents in this workspace"
      : isArchived
        ? "This chat is archived"
        : undefined;

  const sessionSelectionPending =
    !!wsId && (!sessionsFetched || !lastSessionHydrated || hydratedWorkspaceId !== wsId);

  return (
    <View className="flex-1 bg-background">
      <Header
        center={
          <ChatTitleButton
            currentSession={activeSession}
            currentAgent={currentAgent}
            onPress={() => {
              if (!wsSlug) return;
              router.push({
                pathname: "/[workspace]/chat-sessions",
                params: { workspace: wsSlug },
              });
            }}
          />
        }
        right={
          <ChatSessionActions
            showMore={!!activeSession}
            onMorePress={handleDeleteActive}
            onNewPress={handleNewChat}
          />
        }
      />
      {availability === "none" ? <NoAgentBanner /> : null}
      <View className="flex-1">
        <ChatMessageList
          messages={messages}
          loading={sessionSelectionPending || messagesLoading}
          hasSessions={sessions.length > 0}
          agentName={currentAgent?.name}
          onPickPrompt={(text) => setDraft(draftKey, text)}
          pendingTask={pendingTask}
          liveTaskMessages={liveTaskMessages}
          availability={presenceAvailability}
          onRegenerateLast={() => mutateLastTurn("regenerate")}
          onResendLast={() => mutateLastTurn("resend")}
          onWithdrawLast={() => mutateLastTurn("withdraw")}
          onEditMessage={setEditingMessage}
        />
        <OfflineBanner
          agentName={currentAgent?.name}
          availability={presenceAvailability}
        />
        <ChatComposer
          value={draft}
          onChangeText={(next) => setDraft(draftKey, next)}
          onSend={handleSend}
          onStop={handleStop}
          sending={sending}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      </View>

      <AgentPickerSheet
        visible={agentPickerOpen}
        agents={availableAgents}
        currentAgentId={currentAgent?.id ?? null}
        onPick={handlePickAgent}
        onClose={() => setAgentPickerOpen(false)}
      />
      <EditMessageSheet
        message={editingMessage}
        submitting={updateMessage.isPending}
        onClose={() => setEditingMessage(null)}
        onSave={handleSaveEditedMessage}
      />
    </View>
  );
}
