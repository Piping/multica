/**
 * Workspace tab. This is the mobile replacement for the desktop sidebar: a
 * stable destination that gathers workspace navigation, live agent status,
 * account/workspace switching, and settings. Keep it read-mostly; detail
 * management still lives in the pushed screens.
 */
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { AgentAvailability } from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { Header } from "@/components/ui/header";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PresenceDot } from "@/components/ui/presence-dot";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { agentListOptions } from "@/data/queries/agents";
import { projectListOptions } from "@/data/queries/projects";
import { pinListOptions } from "@/data/queries/pins";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const NAV_ITEMS = [
  {
    label: "Issues",
    subtitle: "Browse every workspace issue",
    icon: "list-outline" as IoniconName,
    path: "/more/issues",
  },
  {
    label: "Projects",
    subtitle: "Milestones, leads, and resources",
    icon: "layers-outline" as IoniconName,
    path: "/more/projects",
  },
  {
    label: "Agents",
    subtitle: "Availability and current workload",
    icon: "sparkles-outline" as IoniconName,
    path: "/more/agents",
  },
  {
    label: "Pinned",
    subtitle: "Saved issues and projects",
    icon: "pin-outline" as IoniconName,
    path: "/more/pins",
  },
  {
    label: "Settings",
    subtitle: "Account, workspace, backend",
    icon: "settings-outline" as IoniconName,
    path: "/more/settings",
  },
] as const;

export default function WorkspaceTab() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { colorScheme } = useColorScheme();
  const iconColor = THEME[colorScheme].mutedForeground;

  const { data: agents = [], isLoading: agentsLoading } = useQuery(
    agentListOptions(wsId),
  );
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: pins = [] } = useQuery(pinListOptions(wsId, userId));
  const { byAgent: presenceMap, loading: presenceLoading } =
    useWorkspacePresenceMap(wsId);

  const activeAgents = useMemo(
    () => agents.filter((a) => !a.archived_at),
    [agents],
  );
  const previewAgents = activeAgents.slice(0, 3);
  const availabilityCounts = useMemo(() => {
    const counts: Record<AgentAvailability, number> = {
      online: 0,
      unstable: 0,
      offline: 0,
    };
    for (const agent of activeAgents) {
      const detail = presenceMap.get(agent.id);
      counts[detail?.availability ?? "offline"] += 1;
    }
    return counts;
  }, [activeAgents, presenceMap]);

  const go = (path: string) => {
    if (wsSlug) router.push(`/${wsSlug}${path}`);
  };
  const goNewIssue = () => {
    if (wsSlug) router.push(`/${wsSlug}/new-issue`);
  };
  const goChat = () => {
    if (wsSlug) router.push(`/${wsSlug}/chat`);
  };

  return (
    <View className="flex-1 bg-background">
      <Header
        title="Workspace"
        right={<HeaderActions actions={["search", "new-project"]} />}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 py-4 gap-5 pb-8"
        showsVerticalScrollIndicator={false}
      >
        <View className="rounded-md border border-border bg-card p-4 gap-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 min-w-0">
              <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                Agents
              </Text>
              <Text className="text-xl font-semibold text-foreground mt-1">
                {activeAgents.length} active
              </Text>
              <Text className="text-sm text-muted-foreground mt-1">
                {availabilityCounts.online} online · {availabilityCounts.unstable} reconnecting
              </Text>
            </View>
            {presenceLoading || agentsLoading ? <ActivityIndicator /> : null}
          </View>

          {previewAgents.length > 0 ? (
            <View className="gap-3">
              {previewAgents.map((agent) => {
                const detail = presenceMap.get(agent.id);
                return (
                  <Pressable
                    key={agent.id}
                    onPress={() => go("/more/agents")}
                    className="flex-row items-center gap-3 active:bg-secondary rounded-md"
                  >
                    <ActorAvatar type="agent" id={agent.id} size={34} showPresence />
                    <View className="flex-1 min-w-0">
                      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                        {agent.name}
                      </Text>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                        {agent.model || "Default model"}
                      </Text>
                    </View>
                    {detail ? (
                      <WorkloadPill
                        running={detail.runningCount}
                        queued={detail.queuedCount}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text className="text-sm text-muted-foreground">
              Add an agent on desktop or web, then use mobile to hand off and monitor work.
            </Text>
          )}

          <View className="flex-row gap-2">
            <QuickAction label="New Issue" icon="add" onPress={goNewIssue} />
            <QuickAction label="Ask Agent" icon="chatbubble-outline" onPress={goChat} />
          </View>
        </View>

        <View className="flex-row gap-2">
          <Metric label="Projects" value={projects.length} />
          <Metric label="Pinned" value={pins.length} />
          <Metric label="Offline" value={availabilityCounts.offline} />
        </View>

        <View className="rounded-md border border-border bg-card overflow-hidden">
          {NAV_ITEMS.map((item, idx) => (
            <View key={item.path}>
              {idx > 0 ? <View className="h-px bg-border ml-14" /> : null}
              <Pressable
                onPress={() => go(item.path)}
                className="flex-row items-center gap-3 px-4 py-3.5 active:bg-secondary"
              >
                <View className="size-8 rounded-md bg-secondary items-center justify-center">
                  <Ionicons name={item.icon} size={17} color={iconColor} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-base font-medium text-foreground" numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={iconColor} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function WorkloadPill({ running, queued }: { running: number; queued: number }) {
  const active = running > 0 || queued > 0;
  return (
    <View
      className={cn(
        "flex-row items-center gap-1 rounded-full px-2 py-1",
        active ? "bg-brand/10" : "bg-secondary",
      )}
    >
      {active ? <PresenceDot availability="online" size={7} /> : null}
      <Text className={cn("text-xs", active ? "text-brand" : "text-muted-foreground")}>
        {running > 0 ? `${running} running` : queued > 0 ? `${queued} queued` : "Idle"}
      </Text>
    </View>
  );
}

function QuickAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: IoniconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 flex-row items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 active:opacity-85"
    >
      <Ionicons name={icon} size={16} color={THEME.light.primaryForeground} />
      <Text className="text-sm font-medium text-primary-foreground">{label}</Text>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 rounded-md border border-border bg-card px-3 py-3">
      <Text className="text-xl font-semibold text-foreground">{value}</Text>
      <Text className="text-xs text-muted-foreground mt-0.5">{label}</Text>
    </View>
  );
}
