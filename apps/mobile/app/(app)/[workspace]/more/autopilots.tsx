import { useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router } from "expo-router";
import type { Autopilot, AutopilotStatus } from "@multica/core/types";
import { useQuery } from "@tanstack/react-query";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { useActorLookup } from "@/data/use-actor-name";
import { autopilotListOptions } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time-ago";

export default function AutopilotsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { data = [], isLoading, error, refetch, isRefetching } = useQuery(
    autopilotListOptions(wsId),
  );

  const counts = useMemo(() => {
    return data.reduce(
      (acc, autopilot) => {
        acc.total += 1;
        acc[autopilot.status] += 1;
        return acc;
      },
      { total: 0, active: 0, paused: 0, archived: 0 } as Record<
        "total" | AutopilotStatus,
        number
      >,
    );
  }, [data]);

  const headerRight = useCallback(() => {
    return (
      <IconButton
        name="add"
        onPress={() => wsSlug && router.push(`/${wsSlug}/more/autopilots/new`)}
        accessibilityLabel="New autopilot"
      />
    );
  }, [wsSlug]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      <Stack.Screen options={{ headerRight }} />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            Failed to load autopilots:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : data.length === 0 ? (
        <EmptyState
          onCreate={() =>
            wsSlug && router.push(`/${wsSlug}/more/autopilots/new`)
          }
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ListHeaderComponent={
            <View className="px-4 pt-4 pb-3 gap-4">
              <View className="rounded-md border border-border bg-card p-4 gap-3">
                <View>
                  <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                    Automation
                  </Text>
                  <Text className="text-2xl font-semibold text-foreground mt-1">
                    {counts.active} active
                  </Text>
                  <Text className="text-sm text-muted-foreground mt-1">
                    {counts.paused} paused · {counts.archived} archived
                  </Text>
                </View>
                <View className="flex-row gap-2">
                  <Metric label="Total" value={counts.total} />
                  <Metric label="Paused" value={counts.paused} />
                  <Metric label="Archived" value={counts.archived} />
                </View>
              </View>
            </View>
          }
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-16" />}
          renderItem={({ item }) => (
            <AutopilotRow
              autopilot={item}
              onPress={() => {
                if (wsSlug) {
                  router.push(`/${wsSlug}/more/autopilots/${item.id}`);
                }
              }}
            />
          )}
          contentContainerClassName="pb-6"
        />
      )}
    </SafeAreaView>
  );
}

function AutopilotRow({
  autopilot,
  onPress,
}: {
  autopilot: Autopilot;
  onPress: () => void;
}) {
  const { getName } = useActorLookup();
  const assigneeName = getName(autopilot.assignee_type, autopilot.assignee_id);
  const lastRunLabel = autopilot.last_run_at
    ? timeAgo(autopilot.last_run_at)
    : "Never";

  return (
    <Pressable onPress={onPress} className="active:bg-secondary px-4 py-3">
      <View className="flex-row items-start gap-3">
        <ActorAvatar
          type={autopilot.assignee_type}
          id={autopilot.assignee_id}
          size={40}
          showPresence={autopilot.assignee_type === "agent"}
        />
        <View className="flex-1 min-w-0 gap-1">
          <View className="flex-row items-center gap-2">
            <Text
              className="flex-1 text-base font-medium text-foreground"
              numberOfLines={1}
            >
              {autopilot.title}
            </Text>
            <StatusPill status={autopilot.status} />
          </View>
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {assigneeName}
            {" · "}
            {autopilot.execution_mode === "create_issue"
              ? "Create issue"
              : "Run only"}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {autopilot.description || "No runbook description"}
          </Text>
        </View>
        <View className="items-end gap-1">
          <Text className="text-xs text-muted-foreground tabular-nums">
            {lastRunLabel}
          </Text>
          <Text className="text-[11px] text-muted-foreground/70">
            Updated {timeAgo(autopilot.updated_at)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function StatusPill({ status }: { status: AutopilotStatus }) {
  const containerClass =
    status === "active"
      ? "bg-brand/10"
      : status === "paused"
        ? "bg-amber-500/10"
        : "bg-secondary";
  const textClass =
    status === "active"
      ? "text-brand"
      : status === "paused"
        ? "text-amber-700"
        : "text-muted-foreground";

  return (
    <View className={cn("rounded-full px-2 py-1", containerClass)}>
      <Text className={cn("text-xs capitalize", textClass)}>
        {status}
      </Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 rounded-md border border-border bg-background px-3 py-3">
      <Text className="text-xl font-semibold text-foreground">{value}</Text>
      <Text className="text-xs text-muted-foreground mt-0.5">{label}</Text>
    </View>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-4">
      <Text className="text-base font-medium text-foreground">
        No autopilots yet
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        Create a workspace automation, then add schedules or webhooks from its
        detail page.
      </Text>
      <Button onPress={onCreate}>
        <Text>Create autopilot</Text>
      </Button>
    </View>
  );
}
