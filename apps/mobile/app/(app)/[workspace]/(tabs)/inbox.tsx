import { useMemo } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useQueries, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { AgentTask, InboxItem } from "@multica/core/types";
import type { RuntimeHealth } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/ui/header";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { SwipeableInboxRow } from "@/components/inbox/swipeable-inbox-row";
import { agentListOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { chatSessionsOptions, pendingChatTasksOptions } from "@/data/queries/chat";
import { inboxListOptions } from "@/data/queries/inbox";
import { runtimeListOptions } from "@/data/queries/runtimes";
import {
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
  useArchiveInbox,
  useMarkAllInboxRead,
  useMarkInboxRead,
} from "@/data/mutations/inbox";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { deduplicateInboxItems } from "@/lib/inbox-display";
import { showActionMenu } from "@/lib/action-menu";
import { timeAgo } from "@/lib/time-ago";
import { failureReasonLabel } from "@/lib/failure-reason-label";
import {
  buildTodayAttentionSignals,
  type TodayAttentionSignal,
} from "@/lib/today-attention";
import { cn } from "@/lib/utils";

type TodayRow =
  | { kind: "summary" }
  | { kind: "attention"; signal: TodayAttentionSignal }
  | { kind: "section"; title: string; count?: number }
  | { kind: "inbox"; item: InboxItem }
  | { kind: "empty" };

export default function Today() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();

  const queries = useQueries({
    queries: [
      inboxListOptions(wsId),
      agentListOptions(wsId),
      runtimeListOptions(wsId),
      agentTaskSnapshotOptions(wsId),
      pendingChatTasksOptions(wsId),
      chatSessionsOptions(wsId),
    ],
  });
  const [inboxQuery, agentsQuery, runtimesQuery, tasksQuery, pendingChatQuery, sessionsQuery] = queries;

  const inboxItems = useMemo(
    () => deduplicateInboxItems(inboxQuery.data ?? []),
    [inboxQuery.data],
  );
  const attentionSignals = useMemo(
    () => buildTodayAttentionSignals({
      agents: agentsQuery.data ?? [],
      runtimes: runtimesQuery.data ?? [],
      tasks: tasksQuery.data ?? [],
      pendingChatTasks: pendingChatQuery.data?.tasks ?? [],
      chatSessions: sessionsQuery.data ?? [],
      now: Date.now(),
    }),
    [agentsQuery.data, runtimesQuery.data, tasksQuery.data, pendingChatQuery.data, sessionsQuery.data],
  );

  const markRead = useMarkInboxRead();
  const markAllRead = useMarkAllInboxRead();
  const archive = useArchiveInbox();
  const archiveAll = useArchiveAllInbox();
  const archiveAllRead = useArchiveAllReadInbox();
  const archiveCompleted = useArchiveCompletedInbox();

  const isLoading = queries.some((q) => q.isLoading);
  const isRefetching = queries.some((q) => q.isRefetching);
  const firstError = queries.find((q) => q.error)?.error;

  const rows = useMemo<TodayRow[]>(() => {
    if (attentionSignals.length === 0 && inboxItems.length === 0) {
      return [{ kind: "empty" }];
    }
    const out: TodayRow[] = [{ kind: "summary" }];
    if (attentionSignals.length > 0) {
      out.push({ kind: "section", title: "Needs attention", count: attentionSignals.length });
      for (const signal of attentionSignals) out.push({ kind: "attention", signal });
    }
    out.push({ kind: "section", title: "Notifications", count: inboxItems.length });
    for (const item of inboxItems) out.push({ kind: "inbox", item });
    return out;
  }, [attentionSignals, inboxItems]);

  const onRefresh = () => {
    for (const q of queries) void q.refetch();
  };

  const onPressItem = (item: InboxItem) => {
    if (!item.read) markRead.mutate(item.id);
    if (item.issue_id && wsSlug) {
      router.push({
        pathname: "/[workspace]/issue/[id]",
        params: {
          workspace: wsSlug,
          id: item.issue_id,
          highlight: item.details?.comment_id,
          h: String(Date.now()),
        },
      });
    }
  };

  const onPressAttention = (signal: TodayAttentionSignal) => {
    if (signal.kind === "runtime") {
      if (wsSlug) router.push(`/${wsSlug}/more/agents`);
      return;
    }
    const task = signal.task;
    if (task.issue_id && wsSlug) {
      router.push({ pathname: "/[workspace]/issue/[id]/runs", params: { workspace: wsSlug, id: task.issue_id } });
      return;
    }
    if (task.chat_session_id && wsSlug) {
      router.push(`/${wsSlug}/chat`);
    }
  };

  const onPressMenu = () => {
    void (async () => {
      const action = await showActionMenu({
        title: "Today",
        options: [
          { key: "read", label: "Mark all read" },
          { key: "archiveRead", label: "Archive all read" },
          { key: "archiveCompleted", label: "Archive completed" },
          { key: "archiveAll", label: "Archive all", destructive: true },
        ],
      });
      if (action === "read") markAllRead.mutate();
      else if (action === "archiveRead") archiveAllRead.mutate();
      else if (action === "archiveCompleted") archiveCompleted.mutate();
      else if (action === "archiveAll") {
        Alert.alert(
          "Archive all?",
          "This archives every notification, read or unread. You can still find them via the issue pages.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Archive all", style: "destructive", onPress: () => archiveAll.mutate() },
          ],
        );
      }
    })();
  };

  return (
    <View className="flex-1 bg-background">
      <Header
        title="Today"
        subtitle="Attention queue"
        right={
          <>
            <IconButton name="ellipsis-horizontal" onPress={onPressMenu} accessibilityLabel="Today actions" />
            <HeaderActions />
          </>
        }
      />
      {isLoading ? (
        <TodayLoading />
      ) : firstError ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            Failed to load Today: {firstError instanceof Error ? firstError.message : "unknown error"}
          </Text>
          <Button variant="outline" onPress={onRefresh}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row, index) => rowKey(row, index)}
          contentContainerClassName="pb-6"
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
          renderItem={({ item }) => {
            if (item.kind === "summary") {
              return <TodaySummary attentionCount={attentionSignals.length} notificationCount={inboxItems.length} />;
            }
            if (item.kind === "section") {
              return <SectionHeader title={item.title} count={item.count} />;
            }
            if (item.kind === "attention") {
              return <AttentionRow signal={item.signal} onPress={() => onPressAttention(item.signal)} />;
            }
            if (item.kind === "inbox") {
              return (
                <SwipeableInboxRow
                  item={item.item}
                  onPress={() => onPressItem(item.item)}
                  onArchive={() => archive.mutate(item.item.id)}
                />
              );
            }
            return <TodayEmpty iconColor={THEME[colorScheme].mutedForeground} />;
          }}
          ItemSeparatorComponent={({ leadingItem }) =>
            leadingItem?.kind === "inbox" ? <View className="h-px bg-border ml-16" /> : null
          }
        />
      )}
    </View>
  );
}

function TodaySummary({ attentionCount, notificationCount }: { attentionCount: number; notificationCount: number }) {
  return (
    <View className="px-4 py-4">
      <View className="rounded-md border border-border bg-card p-4 gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 min-w-0">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground">Now</Text>
            <Text className="text-lg font-semibold text-foreground mt-1" numberOfLines={1}>
              {attentionCount > 0 ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention` : "No urgent attention"}
            </Text>
          </View>
          <View className={cn("size-10 rounded-full items-center justify-center", attentionCount > 0 ? "bg-destructive/10" : "bg-secondary")}>
            <Ionicons name={attentionCount > 0 ? "warning-outline" : "checkmark-circle-outline"} size={22} color={attentionCount > 0 ? "#dc2626" : "#71717a"} />
          </View>
        </View>
        <Text className="text-sm text-muted-foreground">
          {notificationCount} notification{notificationCount === 1 ? "" : "s"} pending.
        </Text>
      </View>
    </View>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View className="px-4 pt-2 pb-2 bg-background">
      <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}{typeof count === "number" ? ` · ${count}` : ""}
      </Text>
    </View>
  );
}

function AttentionRow({ signal, onPress }: { signal: TodayAttentionSignal; onPress: () => void }) {
  const destructive = signal.severity === "critical";
  const icon = attentionIcon(signal);
  return (
    <Pressable onPress={onPress} className="px-4 py-3 active:bg-secondary bg-background">
      <View className="flex-row items-start gap-3">
        <View className={cn("size-9 rounded-full items-center justify-center", destructive ? "bg-destructive/10" : "bg-amber-500/10")}>
          <Ionicons name={icon} size={19} color={destructive ? "#dc2626" : "#a16207"} />
        </View>
        <View className="flex-1 min-w-0 gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>{attentionTitle(signal)}</Text>
            <Ionicons name="chevron-forward" size={16} color="#71717a" />
          </View>
          <Text className="text-xs text-muted-foreground" numberOfLines={2}>{attentionDetail(signal)}</Text>
          {signal.kind !== "runtime" && signal.agent ? (
            <View className="flex-row items-center gap-2 mt-1">
              <ActorAvatar type="agent" id={signal.agent.id} size={18} showPresence />
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>{signal.agent.name}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function TodayLoading() {
  return (
    <View className="px-4 pt-4 gap-4">
      <Skeleton className="h-24 rounded-md" />
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i} className="flex-row gap-3">
          <Skeleton className="size-9 rounded-full" />
          <View className="flex-1 gap-2 pt-1">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </View>
        </View>
      ))}
    </View>
  );
}

function TodayEmpty({ iconColor }: { iconColor: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8 gap-3 py-24">
      <Ionicons name="checkmark-circle-outline" size={42} color={iconColor} />
      <Text className="text-base font-medium text-foreground text-center">Clear for today</Text>
      <Text className="text-sm text-muted-foreground text-center">
        System issues, stalled agent work, and unread notifications will show up here.
      </Text>
    </View>
  );
}

function rowKey(row: TodayRow, index: number): string {
  if (row.kind === "attention") return row.signal.id;
  if (row.kind === "inbox") return row.item.id;
  return `${row.kind}:${index}`;
}

function attentionIcon(signal: TodayAttentionSignal): React.ComponentProps<typeof Ionicons>["name"] {
  if (signal.kind === "runtime") return signal.health === "recently_lost" ? "wifi-outline" : "cloud-offline-outline";
  if (signal.kind === "task_failed") return "alert-circle-outline";
  return signal.task.status === "waiting_local_directory" ? "folder-open-outline" : "time-outline";
}

function attentionTitle(signal: TodayAttentionSignal): string {
  if (signal.kind === "runtime") return runtimeTitle(signal.health);
  if (signal.kind === "task_failed") return "Agent task failed";
  if (signal.task.status === "waiting_local_directory") return "Task waiting for workspace path";
  return signal.task.chat_session_id ? "Chat has been thinking too long" : "Agent task is taking longer than expected";
}

function attentionDetail(signal: TodayAttentionSignal): string {
  if (signal.kind === "runtime") {
    const names = signal.affectedAgents.slice(0, 2).map((a) => a.name).join(", ");
    const more = signal.affectedAgents.length > 2 ? ` +${signal.affectedAgents.length - 2}` : "";
    return `${signal.runtime.name || "Runtime"} affects ${names || "agents"}${more}. Last seen ${signal.runtime.last_seen_at ? timeAgo(signal.runtime.last_seen_at) : "unknown"}.`;
  }
  const task = signal.task;
  const source = signal.chatSession?.title || task.trigger_summary || taskSummary(task);
  if (signal.kind === "task_failed") {
    return `${failureReasonLabel(task.failure_reason)} · ${source} · ${timeAgo(task.completed_at || task.created_at)}`;
  }
  return `${taskStatusLabel(task.status)} for ${formatDuration(signal.ageMs)} · ${source}`;
}

function runtimeTitle(health: RuntimeHealth): string {
  if (health === "recently_lost") return "Agent runtime is unstable";
  if (health === "about_to_gc") return "Agent runtime has been offline for days";
  return "Agent runtime is offline";
}

function taskStatusLabel(status: AgentTask["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "dispatched":
      return "Starting";
    case "waiting_local_directory":
      return "Waiting";
    case "running":
      return "Running";
    default:
      return status;
  }
}

function taskSummary(task: AgentTask): string {
  switch (task.kind) {
    case "chat":
      return "Chat task";
    case "comment":
      return "Comment task";
    case "autopilot":
      return "Autopilot run";
    case "quick_create":
      return "Quick create";
    default:
      return "Task";
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}
