/**
 * Slim header for the issue detail screen.
 *
 * Linear iOS-inspired layout:
 *   - identifier (MUL-NN) above as a small muted label
 *   - title in a large bold treatment
 *   - attribute chip row below (status / priority / assignee / labels /
 *     project / due date) — tappable, opens picker sheets
 *
 * The native iOS Stack header still renders `issue.identifier` as the
 * navigation title; the body re-renders it more prominently per the
 * reference screenshot.
 */
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { AttributeRow } from "./attribute-row";
import { AgentActivityRow } from "./agent-activity-row";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function IssueHeaderCard({ issue }: { issue: Issue }) {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <View className="px-4 pt-4 pb-3 gap-3">
      <Text className="text-xs text-muted-foreground">{issue.identifier}</Text>
      <Text className="text-2xl font-bold text-foreground">
        {issue.title}
      </Text>
      {/* Activity row sits between title and attributes — it represents
       *  "who's doing this issue right now / who has done it" (dynamic),
       *  which is higher-IA than the static property chips below.
       *  Conditionally renders null when there are no tasks at all. */}
      <AgentActivityRow issueId={issue.id} />
      <Pressable
        onPress={() => {
          if (!wsSlug) return;
          router.push({
            pathname: "/[workspace]/issue/[id]/history",
            params: { workspace: wsSlug, id: issue.id },
          });
        }}
        className="flex-row items-center gap-2 self-start rounded-full border border-border bg-secondary/60 px-3 py-1.5 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel="Open issue history"
      >
        <Ionicons
          name="time-outline"
          size={14}
          color={theme.mutedForeground}
        />
        <Text className="text-xs font-medium text-muted-foreground">
          History
        </Text>
      </Pressable>
      <AttributeRow issue={issue} />
    </View>
  );
}
