import { useMemo } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Agent, AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Separator } from "@/components/ui/separator";
import { agentListOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { memberListOptions } from "@/data/queries/members";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: agents = [], isLoading, error, refetch } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: tasks = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  const { byAgent: presenceMap } = useWorkspacePresenceMap(wsId);

  const agent = agents.find((candidate) => candidate.id === id) ?? null;
  const runtime = agent ? runtimes.find((candidate) => candidate.id === agent.runtime_id) ?? null : null;
  const owner = agent?.owner_id ? members.find((member) => member.user_id === agent.owner_id) ?? null : null;
  const memberRole = members.find((member) => member.user_id === userId)?.role ?? null;
  const canEdit = !!agent && (memberRole === "owner" || memberRole === "admin" || agent.owner_id === userId);
  const activeTasks = useMemo(
    () => tasks.filter((task) => task.agent_id === id && isActiveTask(task)),
    [tasks, id],
  );
  const latestTask = activeTasks[0] ?? tasks.find((task) => task.agent_id === id) ?? null;
  const presence = id ? presenceMap.get(id) : undefined;

  if (isLoading) {
    return <View className="flex-1 items-center justify-center bg-background"><ActivityIndicator /></View>;
  }

  if (error || !agent) {
    return (
      <View className="flex-1 bg-background px-4 pt-4 gap-3">
        <Text className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Agent not found"}
        </Text>
        <Button variant="outline" onPress={() => refetch()}><Text>Retry</Text></Button>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 py-4 gap-4 pb-8">
      <View className="rounded-md border border-border bg-card p-4 gap-4">
        <View className="flex-row items-start gap-3">
          <ActorAvatar type="agent" id={agent.id} size={52} showPresence />
          <View className="flex-1 min-w-0 gap-1">
            <Text className="text-xl font-semibold text-foreground" numberOfLines={1}>{agent.name}</Text>
            <Text className="text-sm text-muted-foreground" numberOfLines={2}>{agent.description || "No description"}</Text>
            <View className="flex-row flex-wrap gap-2 mt-1">
              <Pill label={availabilityLabel(presence?.availability)} tone={presence?.availability === "online" ? "good" : presence?.availability === "unstable" ? "warn" : "muted"} />
              {agent.archived_at ? <Pill label="Archived" tone="muted" /> : null}
              <Pill label={agent.visibility === "workspace" ? "Workspace" : "Private"} tone="muted" />
            </View>
          </View>
        </View>
        {canEdit ? (
          <Button onPress={() => wsSlug && router.push(`/${wsSlug}/more/agents/${agent.id}/edit`)}>
            <Ionicons name="settings-outline" size={16} color="white" />
            <Text>Configure Agent</Text>
          </Button>
        ) : (
          <View className="rounded-md bg-secondary px-3 py-2">
            <Text className="text-xs text-muted-foreground">Only the agent owner and workspace admins can edit this agent.</Text>
          </View>
        )}
      </View>

      <Section title="Runtime">
        <InfoRow label="Runtime" value={runtime?.name ?? "Unknown runtime"} />
        <InfoRow label="Provider" value={runtime?.provider || agent.runtime_mode} />
        <InfoRow label="Runtime status" value={runtime?.status ?? "unknown"} />
        <InfoRow label="Model" value={agent.model || "CLI default"} />
        <InfoRow label="Thinking" value={agent.thinking_level || "CLI config"} />
        <InfoRow label="Concurrency" value={String(agent.max_concurrent_tasks)} />
      </Section>

      <Section title="CLI Arguments">
        {agent.custom_args.length > 0 ? (
          <View className="gap-2">
            {agent.custom_args.map((arg, index) => (
              <View key={`${arg}:${index}`} className="rounded-md bg-secondary px-3 py-2">
                <Text className="font-mono text-xs text-foreground">{arg}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">No custom CLI args. Codex uses the runtime&apos;s CODEX_HOME config.</Text>
        )}
      </Section>

      <Section title="Activity">
        <InfoRow label="Active tasks" value={String(activeTasks.length)} />
        <InfoRow label="Latest task" value={latestTask ? taskSummary(latestTask) : "No recent task"} />
        <InfoRow label="Updated" value={agent.updated_at ? timeAgo(agent.updated_at) : "Unknown"} />
        {owner ? <InfoRow label="Owner" value={owner.name} /> : null}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-md border border-border bg-card">
      <View className="px-4 py-3"><Text className="text-xs uppercase tracking-wider text-muted-foreground">{title}</Text></View>
      <Separator />
      <View className="p-4 gap-3">{children}</View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <Text className="w-28 text-xs text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-sm text-foreground" numberOfLines={3}>{value}</Text>
    </View>
  );
}

function Pill({ label, tone }: { label: string; tone: "good" | "warn" | "muted" }) {
  return (
    <View className={cn("rounded-full px-2 py-1", tone === "good" ? "bg-brand/10" : tone === "warn" ? "bg-amber-500/10" : "bg-secondary")}>
      <Text className={cn("text-xs", tone === "good" ? "text-brand" : tone === "warn" ? "text-amber-700" : "text-muted-foreground")}>{label}</Text>
    </View>
  );
}

function availabilityLabel(value: string | undefined): string {
  if (value === "online") return "Online";
  if (value === "unstable") return "Reconnecting";
  return "Offline";
}

function isActiveTask(task: AgentTask): boolean {
  return task.status === "queued" || task.status === "dispatched" || task.status === "waiting_local_directory" || task.status === "running";
}

function taskSummary(task: AgentTask): string {
  const prefix = task.status === "failed" ? "Failed" : task.status === "completed" ? "Completed" : task.status;
  return `${prefix} · ${task.trigger_summary || task.kind || "Task"}`;
}
