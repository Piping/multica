import { useMemo } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActivityRow } from "@/components/issue/activity-row";
import { WorkspaceSheetListSurface } from "@/components/ui/workspace-sheet-list-surface";
import { issueTimelineOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { coalesceTimeline } from "@/lib/timeline-coalesce";

export default function IssueHistoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: entries = [] } = useQuery(issueTimelineOptions(wsId, id));

  const activityEntries = useMemo(
    () => coalesceTimeline(entries).filter((entry) => entry.type === "activity"),
    [entries],
  );

  return (
    <WorkspaceSheetListSurface
      title="History"
      subtitle="System updates and issue property changes."
      contentContainerClassName="px-4 pb-4"
    >
      {activityEntries.length > 0 ? (
        <View className="gap-3">
          {activityEntries.map((entry) => (
            <ActivityCard key={entry.id} entry={entry} />
          ))}
        </View>
      ) : (
        <View className="rounded-2xl border border-border bg-surface-1 px-4 py-5">
          <Text className="text-sm text-muted-foreground">
            No system activity yet.
          </Text>
        </View>
      )}
    </WorkspaceSheetListSurface>
  );
}

function ActivityCard({ entry }: { entry: TimelineEntry }) {
  return (
    <View className="rounded-2xl border border-border bg-surface-1 py-3">
      <ActivityRow entry={entry} />
    </View>
  );
}
