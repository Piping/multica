"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@multica/ui/components/ui/resizable";
import { Sheet, SheetContent } from "@multica/ui/components/ui/sheet";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { cn } from "@multica/ui/lib/utils";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import { canAssignAgent } from "@multica/views/issues/components";
import { api } from "@multica/core/api";
import { useAgentPresenceDetail, useWorkspaceAgentAvailability } from "@multica/core/agents";
import { useFileUpload } from "@multica/core/hooks/use-file-upload";
import { ActorAvatar } from "../../common/actor-avatar";
import { OfflineBanner } from "./offline-banner";
import { NoAgentBanner } from "./no-agent-banner";
import {
  chatKeys,
  chatMessagesOptions,
  chatSessionsOptions,
  pendingChatTaskOptions,
  pendingChatTasksOptions,
} from "@multica/core/chat/queries";
import {
  useCreateChatSession,
  useDeleteChatSession,
  useMarkChatSessionRead,
  useRegenerateLastChatMessage,
  useResendLastChatMessage,
  useUpdateChatSession,
  useWithdrawLastChatMessage,
} from "@multica/core/chat/mutations";
import { useChatStore } from "@multica/core/chat";
import { ChatInput } from "./chat-input";
import { ChatMessageList, ChatMessageSkeleton } from "./chat-message-list";
import {
  buildAnchorMarkdown,
  ContextAnchorButton,
  ContextAnchorCard,
  useRouteAnchorCandidate,
} from "./context-anchor";
import { createLogger } from "@multica/core/logger";
import type { Agent, ChatMessage, ChatPendingTask, ChatSession } from "@multica/core/types";
import { useT } from "../../i18n";

const apiLogger = createLogger("chat.api");

export function ChatPage() {
  const { t } = useT("chat");
  const wsId = useWorkspaceId();
  const isMobile = useIsMobile();
  const sidebarRef = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "multica_chat_layout",
  });

  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setSelectedAgentId = useChatStore((s) => s.setSelectedAgentId);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const initialSelectionResolvedRef = useRef(false);
  const initialSelectionModeRef = useRef<"auto" | "manual-new">("auto");

  const user = useAuthStore((s) => s.user);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery(chatSessionsOptions(wsId));
  const { data: pendingTasks } = useQuery(pendingChatTasksOptions(wsId));
  const { data: rawMessages, isLoading: messagesLoading } = useQuery(
    chatMessagesOptions(activeSessionId ?? ""),
  );
  const messages = activeSessionId ? rawMessages ?? [] : [];
  const showSkeleton = !!activeSessionId && messagesLoading;

  const { data: pendingTask } = useQuery(
    pendingChatTaskOptions(activeSessionId ?? ""),
  );
  const pendingTaskId = pendingTask?.task_id ?? null;

  const currentSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;
  const isSessionArchived = currentSession?.status === "archived";

  const qc = useQueryClient();
  const createSession = useCreateChatSession();
  const markRead = useMarkChatSessionRead();
  const withdrawLastChatMessage = useWithdrawLastChatMessage();
  const regenerateLastChatMessage = useRegenerateLastChatMessage();
  const resendLastChatMessage = useResendLastChatMessage();
  const currentMember = members.find((member) => member.user_id === user?.id);
  const memberRole = currentMember?.role;
  const availableAgents = agents.filter(
    (agent) => !agent.archived_at && canAssignAgent(agent, user?.id, memberRole),
  );
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const activeAgent =
    availableAgents.find((agent) => agent.id === selectedAgentId) ??
    availableAgents[0] ??
    null;

  const agentAvailability = useWorkspaceAgentAvailability();
  const noAgent = agentAvailability === "none";
  const presenceDetail = useAgentPresenceDetail(wsId, activeAgent?.id);
  const availability =
    presenceDetail === "loading" ? undefined : presenceDetail.availability;

  const { candidate: anchorCandidate } = useRouteAnchorCandidate(wsId);
  const { uploadWithToast } = useFileUpload(api);

  useEffect(() => {
    if (sessionsLoading || initialSelectionResolvedRef.current) return;
    initialSelectionResolvedRef.current = true;
    if (initialSelectionModeRef.current === "manual-new") return;

    const nextSession = activeSessionId
      ? sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null
      : sessions[0] ?? null;

    if (!nextSession) return;
    if (selectedAgentId !== nextSession.agent_id) {
      setSelectedAgentId(nextSession.agent_id);
    }
    if (activeSessionId !== nextSession.id) {
      setActiveSession(nextSession.id);
    }
  }, [
    sessionsLoading,
    sessions,
    activeSessionId,
    selectedAgentId,
    setActiveSession,
    setSelectedAgentId,
  ]);

  const currentHasUnread =
    sessions.find((session) => session.id === activeSessionId)?.has_unread ?? false;
  useEffect(() => {
    if (!activeSessionId || !currentHasUnread) return;
    markRead.mutate(activeSessionId);
  }, [activeSessionId, currentHasUnread, markRead]);

  const sessionPromiseRef = useRef<Promise<string | null> | null>(null);
  const ensureSession = useCallback(
    async (titleSeed: string): Promise<string | null> => {
      if (activeSessionId) return activeSessionId;
      if (!activeAgent) return null;
      if (sessionPromiseRef.current) return sessionPromiseRef.current;

      const promise = (async () => {
        try {
          const session = await createSession.mutateAsync({
            agent_id: activeAgent.id,
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
    [activeSessionId, activeAgent, createSession],
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      const sessionId = await ensureSession("");
      if (!sessionId) return null;
      qc.setQueryData<ChatMessage[]>(
        chatKeys.messages(sessionId),
        (old) => old ?? [],
      );
      setActiveSession(sessionId);
      return uploadWithToast(file, { chatSessionId: sessionId });
    },
    [ensureSession, qc, setActiveSession, uploadWithToast],
  );

  const handleSend = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (!activeAgent) {
        apiLogger.warn("sendChatMessage skipped: no active agent");
        return;
      }

      const focusOn = useChatStore.getState().focusMode;
      const finalContent = focusOn && anchorCandidate
        ? `${buildAnchorMarkdown(anchorCandidate)}\n\n${content}`
        : content;

      const sessionId = await ensureSession(finalContent);
      if (!sessionId) {
        apiLogger.warn("sendChatMessage aborted: ensureSession returned null");
        return;
      }

      const sentAt = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        chat_session_id: sessionId,
        role: "user",
        content: finalContent,
        task_id: null,
        created_at: sentAt,
      };

      qc.setQueryData<ChatMessage[]>(
        chatKeys.messages(sessionId),
        (old) => (old ? [...old, optimistic] : [optimistic]),
      );
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
        task_id: `optimistic-${optimistic.id}`,
        status: "queued",
        created_at: sentAt,
      });
      setActiveSession(sessionId);

      const result = await api.sendChatMessage(sessionId, finalContent, attachmentIds);
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
        task_id: result.task_id,
        status: "queued",
        created_at: result.created_at,
      });
      qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
    },
    [
      activeAgent,
      anchorCandidate,
      ensureSession,
      qc,
      setActiveSession,
    ],
  );

  const handleStop = useCallback(() => {
    if (!pendingTaskId || !activeSessionId) return;
    qc.setQueryData(chatKeys.pendingTask(activeSessionId), {});
    qc.invalidateQueries({ queryKey: chatKeys.messages(activeSessionId) });
    api.cancelTaskById(pendingTaskId).then(
      () => apiLogger.info("cancelTask.success", { taskId: pendingTaskId }),
      (err) =>
        apiLogger.warn("cancelTask.error (task may have already finished)", {
          taskId: pendingTaskId,
          err,
        }),
    );
  }, [activeSessionId, pendingTaskId, qc]);

  const handleSelectAgent = useCallback(
    (agent: Agent) => {
      if (activeAgent && agent.id === activeAgent.id) return;
      initialSelectionModeRef.current = "manual-new";
      setSelectedAgentId(agent.id);
      setActiveSession(null);
    },
    [activeAgent, setActiveSession, setSelectedAgentId],
  );

  const handleNewChat = useCallback(() => {
    initialSelectionModeRef.current = "manual-new";
    if (availableAgents[0] && selectedAgentId !== availableAgents[0].id) {
      setSelectedAgentId(availableAgents[0].id);
    }
    setActiveSession(null);
    if (isMobile) setMobileSidebarOpen(false);
  }, [availableAgents, isMobile, selectedAgentId, setActiveSession, setSelectedAgentId]);

  const handleSelectSession = useCallback(
    (session: ChatSession) => {
      if (selectedAgentId !== session.agent_id) {
        setSelectedAgentId(session.agent_id);
      }
      setActiveSession(session.id);
      if (isMobile) setMobileSidebarOpen(false);
    },
    [isMobile, selectedAgentId, setActiveSession, setSelectedAgentId],
  );

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarOpen((open) => !open);
      return;
    }

    const panel = sidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, [isMobile, sidebarRef]);

  const inFlightSessionIds = useMemo(
    () => new Set((pendingTasks?.tasks ?? []).map((task) => task.chat_session_id)),
    [pendingTasks],
  );
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const candidate = messages[i];
      if (candidate && candidate.role === "user") return candidate;
    }
    return null;
  }, [messages]);
  const lastTurnActionPending =
    withdrawLastChatMessage.isPending ||
    regenerateLastChatMessage.isPending ||
    resendLastChatMessage.isPending;
  const canActOnLastTurn =
    !!activeSessionId &&
    !!currentSession &&
    currentSession.status === "active" &&
    !!lastUserMessage;

  const awaitingInitialSelection =
    !sessionsLoading &&
    !initialSelectionResolvedRef.current &&
    initialSelectionModeRef.current === "auto" &&
    !activeSessionId &&
    sessions.length > 0;
  const hasMessages = messages.length > 0 || !!pendingTaskId;
  const sidebarVisible = isMobile ? mobileSidebarOpen : desktopSidebarOpen;
  const showTopBar = isMobile || !desktopSidebarOpen;
  const headerTitle = currentSession?.title?.trim() || t(($) => $.window.untitled);
  const headerAgent =
    (currentSession ? agentById.get(currentSession.agent_id) ?? null : null) ?? activeAgent;

  const handleWithdrawLastTurn = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await withdrawLastChatMessage.mutateAsync(activeSessionId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.page.undo_last_failed));
    }
  }, [activeSessionId, t, withdrawLastChatMessage]);

  const handleRegenerateLastTurn = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await regenerateLastChatMessage.mutateAsync(activeSessionId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.page.regenerate_last_failed));
    }
  }, [activeSessionId, regenerateLastChatMessage, t]);

  const handleResendLastTurn = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await resendLastChatMessage.mutateAsync(activeSessionId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.page.resend_last_failed));
    }
  }, [activeSessionId, resendLastChatMessage, t]);

  const lastTurnActions = (
    <LastTurnActionsMenu
      disabled={!canActOnLastTurn || lastTurnActionPending}
      onWithdraw={handleWithdrawLastTurn}
      onRegenerate={handleRegenerateLastTurn}
      onResend={handleResendLastTurn}
    />
  );

  const sidebarContent = (
    <ChatSessionSidebar
      sessions={sessions}
      activeSessionId={activeSessionId}
      agents={agents}
      availableAgents={availableAgents}
      activeAgent={activeAgent}
      defaultAgentId={availableAgents[0]?.id ?? null}
      userId={user?.id}
      runningSessionIds={inFlightSessionIds}
      isMobile={isMobile}
      onToggleSidebar={!isMobile ? handleToggleSidebar : undefined}
      onSelectAgent={handleSelectAgent}
      onSelectSession={handleSelectSession}
      onNewChat={handleNewChat}
    />
  );

  const mainContent = (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {showTopBar && (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={handleToggleSidebar}
            aria-label={sidebarVisible
              ? t(($) => $.page.hide_sessions)
              : t(($) => $.page.show_sessions)}
          >
            <PanelLeft className="size-4" />
          </Button>
          {headerAgent && (
            <ActorAvatar
              actorType="agent"
              actorId={headerAgent.id}
              size={24}
              enableHoverCard
              showStatusDot
            />
          )}
          {!headerAgent && <MessageSquare className="size-4 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{headerTitle}</div>
          </div>
          {currentSession && lastTurnActions}
        </div>
      )}

      {!showTopBar && currentSession && (
        <div className="flex shrink-0 justify-end px-3 pt-3">
          {lastTurnActions}
        </div>
      )}

      {showSkeleton || awaitingInitialSelection ? (
        <ChatMessageSkeleton />
      ) : hasMessages ? (
        <ChatMessageList
          messages={messages}
          pendingTask={pendingTask}
          availability={availability}
        />
      ) : (
        <EmptyState
          hasSessions={sessions.length > 0}
          agentName={activeAgent?.name}
          onPickPrompt={(text) => handleSend(text)}
        />
      )}

      {noAgent ? (
        <NoAgentBanner />
      ) : (
        <OfflineBanner agentName={activeAgent?.name} availability={availability} />
      )}

      <ChatInput
        onSend={handleSend}
        onUploadFile={handleUploadFile}
        onStop={handleStop}
        isRunning={!!pendingTaskId}
        disabled={isSessionArchived}
        noAgent={noAgent}
        agentName={activeAgent?.name}
        topSlot={<ContextAnchorCard />}
        rightAdornment={<ContextAnchorButton />}
      />
    </div>
  );

  return (
    <>
      <div className="flex flex-1 min-h-0 flex-col border-t bg-background">
        {isMobile ? (
          <div className="flex min-h-0 flex-1">
            {mainContent}
            <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
              <SheetContent
                side="left"
                showCloseButton={false}
                className="w-[320px] max-w-[calc(100vw-1rem)] overflow-hidden p-0"
              >
                {sidebarContent}
              </SheetContent>
            </Sheet>
          </div>
        ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <ResizablePanel
              id="sessions"
              defaultSize={desktopSidebarOpen ? 320 : 0}
              minSize={260}
              maxSize={420}
              collapsible
              groupResizeBehavior="preserve-pixel-size"
              panelRef={sidebarRef}
              onResize={(size) => setDesktopSidebarOpen(size.inPixels > 0)}
            >
              <div className="h-full border-r bg-card">
                {sidebarContent}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="chat" minSize="45%">
              {mainContent}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </>
  );
}

function LastTurnActionsMenu({
  disabled,
  onWithdraw,
  onRegenerate,
  onResend,
}: {
  disabled: boolean;
  onWithdraw: () => void;
  onRegenerate: () => void;
  onResend: () => void;
}) {
  const { t } = useT("chat");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={t(($) => $.page.last_turn_actions_aria)}
            disabled={disabled}
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={disabled} onSelect={onWithdraw}>
          {t(($) => $.page.undo_last)}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onSelect={onRegenerate}>
          {t(($) => $.page.regenerate_last)}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onSelect={onResend}>
          {t(($) => $.page.resend_last)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChatSessionSidebar({
  sessions,
  activeSessionId,
  agents,
  availableAgents,
  activeAgent,
  defaultAgentId,
  userId,
  runningSessionIds,
  isMobile,
  onToggleSidebar,
  onSelectAgent,
  onSelectSession,
  onNewChat,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  agents: Agent[];
  availableAgents: Agent[];
  activeAgent: Agent | null;
  defaultAgentId: string | null;
  userId: string | undefined;
  runningSessionIds: ReadonlySet<string>;
  isMobile: boolean;
  onToggleSidebar?: () => void;
  onSelectAgent: (agent: Agent) => void;
  onSelectSession: (session: ChatSession) => void;
  onNewChat: () => void;
}) {
  const { t } = useT("chat");
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const deleteSession = useDeleteChatSession();
  const updateSession = useUpdateChatSession();
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setSelectedAgentId = useChatStore((s) => s.setSelectedAgentId);
  const formatTimeAgo = useFormatTimeAgo();

  const handleSubmitRename = useCallback(
    (sessionId: string, raw: string) => {
      const trimmed = raw.trim();
      const current = sessions.find((session) => session.id === sessionId);
      setRenamingId(null);
      if (!trimmed || trimmed === current?.title) return;
      updateSession.mutate({ sessionId, title: trimmed });
    },
    [sessions, updateSession],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const sessionId = pendingDelete.id;
    const fallbackSession = sessions.find((session) => session.id !== sessionId) ?? null;
    if (activeSessionId === sessionId) {
      if (fallbackSession) {
        setSelectedAgentId(fallbackSession.agent_id);
        setActiveSession(fallbackSession.id);
      } else {
        if (defaultAgentId) setSelectedAgentId(defaultAgentId);
        setActiveSession(null);
      }
    }
    deleteSession.mutate(sessionId, {
      onSettled: () => setPendingDelete(null),
    });
  }, [
    activeSessionId,
    deleteSession,
    defaultAgentId,
    pendingDelete,
    sessions,
    setActiveSession,
    setSelectedAgentId,
  ]);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="space-y-3 border-b px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-semibold">{t(($) => $.page.sessions_title)}</h1>
            </div>
            {!isMobile && onToggleSidebar && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                onClick={onToggleSidebar}
                aria-label={t(($) => $.page.hide_sessions)}
              >
                <PanelLeft className="size-4" />
              </Button>
            )}
          </div>

          <Button className="w-full justify-start gap-2" onClick={onNewChat}>
            <Plus className="size-4" />
            {t(($) => $.window.new_chat_tooltip)}
          </Button>

          <SidebarAgentPicker
            agents={availableAgents}
            activeAgent={activeAgent}
            userId={userId}
            onSelect={onSelectAgent}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
              {t(($) => $.window.no_previous)}
            </div>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => {
                const agent = agents.find((candidate) => candidate.id === session.agent_id) ?? null;
                const isCurrent = session.id === activeSessionId;
                const isRunning = runningSessionIds.has(session.id);
                const isRenaming = renamingId === session.id;

                return (
                  <div
                    key={session.id}
                    className={cn(
                      "group rounded-lg border transition-colors",
                      isCurrent
                        ? "border-border bg-accent/70"
                        : "border-transparent hover:bg-accent/40",
                    )}
                  >
                    <div className="flex items-stretch gap-2 px-2 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (isRenaming) return;
                          onSelectSession(session);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        {agent ? (
                          <ActorAvatar
                            actorType="agent"
                            actorId={agent.id}
                            size={28}
                            enableHoverCard
                            showStatusDot
                          />
                        ) : (
                          <span className="size-7 shrink-0 rounded-full bg-muted" />
                        )}

                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <SessionRenameInput
                              initialValue={session.title ?? ""}
                              onSubmit={(value) => handleSubmitRename(session.id, value)}
                              onCancel={() => setRenamingId(null)}
                            />
                          ) : (
                            <>
                              <div className="truncate text-sm font-medium">
                                {session.title?.trim() || t(($) => $.window.untitled)}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {formatTimeAgo(session.updated_at)}
                                {session.status === "archived" && (
                                  <>
                                    {" · "}
                                    {t(($) => $.page.archived_badge)}
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </button>

                      {!isRenaming && (
                        <div className="flex items-center gap-1">
                          {isRunning ? (
                            <span
                              aria-label={t(($) => $.window.running)}
                              title={t(($) => $.window.running)}
                              className="size-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse"
                            />
                          ) : session.has_unread ? (
                            <span
                              aria-label={t(($) => $.window.unread)}
                              title={t(($) => $.window.unread)}
                              className="size-1.5 shrink-0 rounded-full bg-brand"
                            />
                          ) : null}

                          {isCurrent && (
                            <Check className="size-3.5 shrink-0 text-muted-foreground" />
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className={cn(
                                    isMobile
                                      ? "opacity-100"
                                      : "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                                  )}
                                  onClick={(event) => event.stopPropagation()}
                                />
                              }
                            >
                              <MoreHorizontal className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => setRenamingId(session.id)}>
                                <Pencil className="size-3.5" />
                                {t(($) => $.session_history.row_rename_aria)}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setPendingDelete(session)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                                {t(($) => $.session_history.row_delete_aria)}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleteSession.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.session_history.delete_dialog.title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.title
                ? t(($) => $.session_history.delete_dialog.description_with_title, {
                    title: pendingDelete.title,
                  })
                : t(($) => $.session_history.delete_dialog.description_default)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSession.isPending}>
              {t(($) => $.session_history.delete_dialog.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleteSession.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteSession.isPending
                ? t(($) => $.session_history.delete_dialog.confirming)
                : t(($) => $.session_history.delete_dialog.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SidebarAgentPicker({
  agents,
  activeAgent,
  userId,
  onSelect,
}: {
  agents: Agent[];
  activeAgent: Agent | null;
  userId: string | undefined;
  onSelect: (agent: Agent) => void;
}) {
  const { t } = useT("chat");
  const { mine, others } = useMemo(() => {
    const mine: Agent[] = [];
    const others: Agent[] = [];
    for (const agent of agents) {
      if (agent.owner_id === userId) mine.push(agent);
      else others.push(agent);
    }
    return { mine, others };
  }, [agents, userId]);

  if (!activeAgent) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        {t(($) => $.window.no_agents)}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent aria-expanded:bg-accent"
      >
        <ActorAvatar
          actorType="agent"
          actorId={activeAgent.id}
          size={28}
          enableHoverCard
          showStatusDot
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{activeAgent.name}</div>
          <div className="truncate text-xs text-muted-foreground">{t(($) => $.page.agent_picker_hint)}</div>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {mine.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t(($) => $.window.my_agents)}</DropdownMenuLabel>
            {mine.map((agent) => (
              <AgentMenuItem
                key={agent.id}
                agent={agent}
                isCurrent={agent.id === activeAgent.id}
                onSelect={onSelect}
              />
            ))}
          </DropdownMenuGroup>
        )}
        {mine.length > 0 && others.length > 0 && <DropdownMenuSeparator />}
        {others.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t(($) => $.window.others)}</DropdownMenuLabel>
            {others.map((agent) => (
              <AgentMenuItem
                key={agent.id}
                agent={agent}
                isCurrent={agent.id === activeAgent.id}
                onSelect={onSelect}
              />
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentMenuItem({
  agent,
  isCurrent,
  onSelect,
}: {
  agent: Agent;
  isCurrent: boolean;
  onSelect: (agent: Agent) => void;
}) {
  return (
    <DropdownMenuItem
      onClick={() => onSelect(agent)}
      className="flex min-w-0 items-center gap-2"
    >
      <ActorAvatar
        actorType="agent"
        actorId={agent.id}
        size={24}
        enableHoverCard
        showStatusDot
      />
      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
      {isCurrent && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
    </DropdownMenuItem>
  );
}

function SessionRenameInput({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT("chat");
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();

    const handlePointerDown = (event: PointerEvent) => {
      const input = inputRef.current;
      if (!input) return;
      if (input.contains(event.target as Node)) return;
      onSubmitRef.current(valueRef.current);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      maxLength={200}
      aria-label={t(($) => $.session_history.row_rename_aria)}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          onSubmit(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      className="w-full rounded-sm bg-background px-1 py-0.5 text-sm outline-none ring-1 ring-border focus-visible:ring-brand"
    />
  );
}

function useFormatTimeAgo(): (dateStr: string) => string {
  const { t } = useT("chat");
  return (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t(($) => $.session_history.time.just_now);
    if (diffMins < 60) return t(($) => $.session_history.time.minutes, { count: diffMins });
    if (diffHours < 24) return t(($) => $.session_history.time.hours, { count: diffHours });
    if (diffDays < 7) return t(($) => $.session_history.time.days, { count: diffDays });
    return date.toLocaleDateString();
  };
}

const STARTER_KEYS: ("list_open" | "summarize_today" | "plan_next")[] = [
  "list_open",
  "summarize_today",
  "plan_next",
];

const STARTER_ICONS: Record<(typeof STARTER_KEYS)[number], string> = {
  list_open: "📋",
  summarize_today: "📝",
  plan_next: "💡",
};

function EmptyState({
  hasSessions,
  agentName,
  onPickPrompt,
}: {
  hasSessions: boolean;
  agentName?: string;
  onPickPrompt: (text: string) => void;
}) {
  const { t } = useT("chat");

  if (!hasSessions) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8">
        <div className="space-y-3 text-center">
          <h3 className="text-base font-semibold">
            {t(($) => $.empty_state.first_time_title)}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t(($) => $.empty_state.first_time_intro)}{" "}
            <span className="font-medium text-foreground">
              {t(($) => $.empty_state.first_time_pillars)}
            </span>
            {t(($) => $.empty_state.first_time_pillars_suffix)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(($) => $.empty_state.first_time_actions)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-8">
      <div className="space-y-1 text-center">
        <h3 className="text-base font-semibold">
          {agentName
            ? t(($) => $.empty_state.returning_title_named, { name: agentName })
            : t(($) => $.empty_state.returning_title_default)}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(($) => $.empty_state.returning_subtitle)}
        </p>
      </div>
      <div className="w-full max-w-xs space-y-2">
        {STARTER_KEYS.map((key) => {
          const text = t(($) => $.starter_prompts[key]);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPickPrompt(text)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-brand/40 hover:bg-accent"
            >
              <span className="mr-2">{STARTER_ICONS[key]}</span>
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
