/**
 * Mobile Agents page — read-only operational view. Web owns full agent
 * management; mobile surfaces the pieces that matter while away from desk:
 * availability, active workload, model/runtime hints, and archive state.
 */
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Agent, AgentTask } from "@multica/core/types";
import type { AgentAvailability } from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PresenceDot } from "@/components/ui/presence-dot";
import { agentListOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ACTIVE_TASK_STATUSES = new Set<AgentTask["status"]>([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
]);

export default function AgentsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const mutedColor = THEME[colorScheme].mutedForeground;
  const { data: agents = [], isLoading, error, refetch, isRefetching } =
    useQuery(agentListOptions(wsId));
  const { data: tasks = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  const { byAgent: presenceMap } = useWorkspacePresenceMap(wsId);

  const visibleAgents = useMemo(
    () => [...agents].sort(sortAgents(presenceMap, tasks)),
    [agents, presenceMap, tasks],
  );

  const counts = useMemo(() => {
    const result = { active: 0, online: 0, working: 0 };
    for (const agent of agents) {
      if (!agent.archived_at) result.active += 1;
      const presence = presenceMap.get(agent.id);
      if (presence?.availability === "online") result.online += 1;
      if ((presence?.runningCount ?? 0) + (presence?.queuedCount ?? 0) > 0) {
        result.working += 1;
      }
    }
    return result;
  }, [agents, presenceMap]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-background px-4 gap-3 pt-4">
        <Text className="text-sm text-destructive">
          Failed to load agents: {error instanceof Error ? error.message : "unknown error"}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>Retry</Text>
        </Button>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="h-12 border-b border-border px-4 flex-row items-center justify-between">
        <Text className="text-lg font-semibold text-foreground">Agents</Text>
        <View className="flex-row items-center gap-1">
          <IconButton
            name="hardware-chip-outline"
            accessibilityLabel="Add runtime"
            onPress={() => wsSlug && router.push(`/${wsSlug}/more/runtimes/new`)}
          />
          <IconButton
            name="add"
            accessibilityLabel="New agent"
            onPress={() => wsSlug && router.push(`/${wsSlug}/more/agents/new`)}
          />
        </View>
      </View>
      <FlatList
        className="flex-1 bg-background"
        data={visibleAgents}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListHeaderComponent={
          <View className="px-4 pt-4 pb-3 gap-4">
            <View className="rounded-md border border-border bg-card p-4 gap-3">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                    Team Capacity
                  </Text>
                  <Text className="text-2xl font-semibold text-foreground mt-1">
                    {counts.working} working
                  </Text>
                </View>
                <Ionicons name="sparkles-outline" size={24} color={mutedColor} />
              </View>
              <View className="flex-row gap-2">
                <Metric label="Active" value={counts.active} />
                <Metric label="Online" value={counts.online} />
                <Metric label="Total" value={agents.length} />
              </View>
            </View>
          </View>
        }
        ItemSeparatorComponent={() => <View className="h-px bg-border ml-16" />}
        renderItem={({ item }) => (
          <AgentRow
            agent={item}
            tasks={tasks}
            availability={presenceMap.get(item.id)?.availability}
            onPress={() => {
              if (wsSlug) router.push(`/${wsSlug}/more/agents/${item.id}`);
            }}
          />
        )}
        ListEmptyComponent={<EmptyState />}
        contentContainerClassName="pb-6"
      />
    </View>
  );
}

function sortAgents(
  presenceMap: Map<string, { runningCount: number; queuedCount: number; availability: AgentAvailability }>,
  tasks: AgentTask[],
) {
  return (a: Agent, b: Agent) => {
    const aActive = activeTasksFor(tasks, a.id).length;
    const bActive = activeTasksFor(tasks, b.id).length;
    if (aActive !== bActive) return bActive - aActive;
    const av = availabilityRank(presenceMap.get(a.id)?.availability);
    const bv = availabilityRank(presenceMap.get(b.id)?.availability);
    if (av !== bv) return av - bv;
    if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
    return a.name.localeCompare(b.name);
  };
}

function availabilityRank(value: AgentAvailability | undefined): number {
  if (value === "online") return 0;
  if (value === "unstable") return 1;
  return 2;
}

function activeTasksFor(tasks: AgentTask[], agentId: string): AgentTask[] {
  return tasks.filter((task) => task.agent_id === agentId && ACTIVE_TASK_STATUSES.has(task.status));
}

function AgentRow({
  agent,
  tasks,
  availability,
  onPress,
}: {
  agent: Agent;
  tasks: AgentTask[];
  availability: AgentAvailability | undefined;
  onPress: () => void;
}) {
  const activeTasks = activeTasksFor(tasks, agent.id);
  const latestTask = activeTasks[0] ?? tasks.find((task) => task.agent_id === agent.id);
  const archived = !!agent.archived_at;

  return (
    <Pressable onPress={onPress} className="px-4 py-3.5 active:bg-secondary">
      <View className="flex-row items-start gap-3">
        <ActorAvatar type="agent" id={agent.id} size={40} showPresence />
        <View className="flex-1 min-w-0 gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>
              {agent.name}
            </Text>
            <StatusPill archived={archived} activeCount={activeTasks.length} availability={availability} />
          </View>
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {agent.model || "Default model"}
            {agent.visibility === "private" ? " · Private" : ""}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {latestTask ? taskSummary(latestTask) : agent.description || "Ready for assignment"}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#71717a" />
      </View>
    </Pressable>
  );
}

function StatusPill({
  archived,
  activeCount,
  availability,
}: {
  archived: boolean;
  activeCount: number;
  availability: AgentAvailability | undefined;
}) {
  if (archived) {
    return <Pill label="Archived" muted />;
  }
  if (activeCount > 0) {
    return <Pill label={activeCount === 1 ? "Working" : `${activeCount} active`} active />;
  }
  return <Pill label={availabilityLabel(availability)} availability={availability ?? "offline"} />;
}

function Pill({
  label,
  active,
  muted,
  availability,
}: {
  label: string;
  active?: boolean;
  muted?: boolean;
  availability?: AgentAvailability;
}) {
  return (
    <View
      className={cn(
        "flex-row items-center gap-1 rounded-full px-2 py-1",
        active ? "bg-brand/10" : muted ? "bg-muted" : "bg-secondary",
      )}
    >
      {availability ? <PresenceDot availability={availability} size={7} /> : null}
      <Text className={cn("text-xs", active ? "text-brand" : "text-muted-foreground")}>
        {label}
      </Text>
    </View>
  );
}

function availabilityLabel(value: AgentAvailability | undefined): string {
  if (value === "online") return "Online";
  if (value === "unstable") return "Reconnecting";
  return "Offline";
}

function taskSummary(task: AgentTask): string {
  const summary = task.trigger_summary?.trim();
  if (summary) return summary;
  if (task.kind === "chat") return "Chat task";
  if (task.kind === "autopilot") return "Autopilot run";
  if (task.kind === "quick_create") return "Quick-created issue";
  if (task.kind === "comment") return "Comment task";
  return "Direct assignment";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 rounded-md bg-secondary px-3 py-2.5">
      <Text className="text-lg font-semibold text-foreground">{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

function EmptyState() {
  return (
    <View className="px-6 py-16 items-center gap-2">
      <Text className="text-base font-medium text-foreground text-center">
        No agents yet
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        Create agents on web or desktop, then use mobile to monitor and hand off work.
      </Text>
    </View>
  );
}
