/**
 * Shared issue row used by every list-style issue surface on mobile —
 * (tabs)/my-issues, more/issues (workspace-wide), and project detail's
 * related-issues bucket.
 *
 * Layout mirrors web's `packages/views/issues/components/list-row.tsx`:
 *   [status?]  priority  identifier  title  …  assignee
 *
 * `showStatus` is opt-in because the my-issues SectionList already groups
 * by status (rendering it again per-row would be visual noise). The
 * project-related-issues view doesn't section by status, so it asks for
 * the inline status icon. New callers should default to false unless they
 * mix multiple statuses inside a single ungrouped list.
 *
 * Behavioral parity:
 *   - Same `Issue` type, same `assignee_type`/`assignee_id` semantics
 *     (root CLAUDE.md "Data identity must agree").
 *   - Mirrors web `packages/views/issues/components/list-row.tsx:52`:
 *     render the assignee whenever `assignee_type && assignee_id` are both
 *     truthy — `ActorAvatar` itself handles member / agent / squad rendering
 *     (rounded square + people glyph or `squad.avatar_url` for squads). A
 *     future fourth enum value falls through to ActorAvatar's initials
 *     fallback, which is the real "enum drift downgrades, not crashes"
 *     behavior — earlier whitelist (member/agent only) silently dropped
 *     squad assignees instead.
 */
import { Pressable, View } from "react-native";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { StatusIcon } from "@/components/ui/status-icon";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/issue-status";

interface Props {
  issue: Issue;
  onPress: () => void;
  /** Render the status icon inline at the start of the row. Default: false. */
  showStatus?: boolean;
}

export function IssueRow({ issue, onPress, showStatus = false }: Props) {
  const hasAssignee = !!issue.assignee_type && !!issue.assignee_id;
  return (
    <Pressable onPress={onPress} className="active:bg-secondary px-4 py-3.5">
      <View className="flex-row items-start gap-3">
        <View className="pt-0.5">
          {showStatus ? (
            <StatusIcon status={issue.status} size={16} />
          ) : (
            <PriorityIcon priority={issue.priority} size={16} />
          )}
        </View>
        <View className="flex-1 min-w-0 gap-1.5">
          <Text className="text-base font-medium text-foreground" numberOfLines={2}>
          {issue.title}
        </Text>
          <View className="flex-row items-center gap-2 min-w-0">
            <Text className="text-xs text-muted-foreground shrink-0">
              {issue.identifier}
            </Text>
            <Text className="text-xs text-muted-foreground/50">·</Text>
            {showStatus ? <PriorityIcon priority={issue.priority} size={12} /> : null}
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {showStatus ? PRIORITY_LABEL[issue.priority] : STATUS_LABEL[issue.status]}
            </Text>
          </View>
        </View>
        {hasAssignee ? (
          <ActorAvatar
            type={issue.assignee_type}
            id={issue.assignee_id}
            size={26}
            showPresence
          />
        ) : null}
      </View>
    </Pressable>
  );
}
