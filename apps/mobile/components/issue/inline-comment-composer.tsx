/**
 * Inline issue-comment composer — thin wrapper around the shared
 * `<MessageComposer>` with comment-specific wiring:
 *
 *   - `onSubmit` → `useCreateComment(issueId).mutateAsync`
 *   - Explicit thread selection sourced from
 *     `useCommentThreadTargetStore` (set by the long-press action sheet
 *     or the composer's own thread picker)
 *   - Mention picker path → `/[workspace]/mention-picker?mode=comment`
 *   - Upload context binds attachments to this issue
 *
 * All UI / state / chip plumbing lives in `MessageComposer`. The chat
 * composer (`components/chat/chat-composer.tsx`) uses the same component
 * with chat-mode props.
 */
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TimelineEntry } from "@multica/core/types";
import { useCreateComment } from "@/data/mutations/issues";
import { useCommentThreadTargetStore } from "@/data/stores/comment-thread-target-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { MessageComposer } from "@/components/composer/message-composer";
import { Text } from "@/components/ui/text";
import { showActionMenu } from "@/lib/action-menu";
import type { ActionMenuOption } from "@/lib/action-menu";
import { stripMarkdown } from "@/lib/strip-markdown";
import { useActorLookup } from "@/data/use-actor-name";
import {
  buildCommentThreadOptions,
  type CommentThreadOption,
} from "@/lib/comment-thread-options";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

export function InlineCommentComposer({
  issueId,
  entries,
  onCreateTopLevelComment,
  onCreateThreadReply,
}: {
  issueId: string;
  entries?: TimelineEntry[];
  onCreateTopLevelComment?: () => void;
  onCreateThreadReply?: (rootCommentId: string) => void;
}) {
  const createComment = useCreateComment(issueId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const threadTarget = useCommentThreadTargetStore((s) => s.target);
  const focusKey = useCommentThreadTargetStore((s) => s.focusKey);
  const setThreadTarget = useCommentThreadTargetStore((s) => s.setTarget);
  const resetThreadTarget = useCommentThreadTargetStore((s) => s.reset);
  const { getName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const threadOptions = useMemo(
    () =>
      buildCommentThreadOptions({
        entries,
        getActorName: getName,
      }),
    [entries, getName],
  );
  const mainThread = threadOptions[threadOptions.length - 1] ?? null;
  const selectedThread = useMemo(() => {
    if (threadTarget.mode === "main") return mainThread;
    if (threadTarget.mode !== "thread" || !threadTarget.rootCommentId) return null;
    return (
      threadOptions.find(
        (option) => option.rootCommentId === threadTarget.rootCommentId,
      ) ?? null
    );
  }, [mainThread, threadOptions, threadTarget.mode, threadTarget.rootCommentId]);

  useEffect(() => {
    if (threadTarget.mode !== "thread" || !threadTarget.rootCommentId) return;
    const stillExists = threadOptions.some(
      (option) => option.rootCommentId === threadTarget.rootCommentId,
    );
    if (!stillExists) {
      resetThreadTarget();
    }
  }, [resetThreadTarget, threadOptions, threadTarget.mode, threadTarget.rootCommentId]);

  const onSubmit = useCallback(
    async ({
      content,
      attachmentIds,
    }: {
      content: string;
      attachmentIds: string[];
    }) => {
      const threadRootId = resolveThreadRootId(threadTarget, mainThread);
      const createsTopLevel =
        threadTarget.mode === "new" ||
        (threadTarget.mode === "main" && !mainThread);
      try {
        const created = await createComment.mutateAsync({
          content,
          parentId: threadRootId ?? undefined,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        });
        if (createsTopLevel) {
          onCreateTopLevelComment?.();
        } else if (threadRootId) {
          onCreateThreadReply?.(threadRootId);
        }
        if (threadTarget.mode === "new") {
          setThreadTarget({
            mode: "thread",
            rootCommentId: created.id,
          });
        }
      } catch (err) {
        // Rethrow so MessageComposer's catch path restores text + chips.
        // The optimistic timeline row stays with its inline
        // Failed · Retry · Discard affordance.
        throw err;
      }
    },
    [
      createComment,
      mainThread,
      onCreateThreadReply,
      onCreateTopLevelComment,
      setThreadTarget,
      threadTarget,
    ],
  );

  const openThreadPicker = useCallback((anchor: { x: number; y: number }) => {
    void (async () => {
      const options: ActionMenuOption[] = [
        {
          key: "main-thread",
          label: mainThread
            ? `Main thread · ${buildThreadLabel(mainThread)}`
            : "Main thread · Starts with your next comment",
          icon: "chatbubble-ellipses-outline",
          selected: threadTarget.mode === "main",
        },
        ...threadOptions
          .filter((option) => option.rootCommentId !== mainThread?.rootCommentId)
          .map(
            (option): ActionMenuOption => ({
              key: `thread:${option.rootCommentId}`,
              label: buildThreadLabel(option),
              icon: option.resolved
                ? "checkmark-circle-outline"
                : "chatbubble-ellipses-outline",
              selected:
                threadTarget.mode === "thread" &&
                threadTarget.rootCommentId === option.rootCommentId,
            }),
          ),
        {
          key: "new-thread",
          label: "New thread",
          icon: "add-circle-outline",
          selected: threadTarget.mode === "new",
        },
      ];
      const action = await showActionMenu({
        anchor,
        title: "Reply thread",
        message: "Choose where this comment should land.",
        options,
      });
      if (!action) return;
      if (action === "main-thread") {
        setThreadTarget({ mode: "main", rootCommentId: mainThread?.rootCommentId ?? null });
        return;
      }
      if (action === "new-thread") {
        setThreadTarget({ mode: "new", rootCommentId: null });
        return;
      }
      if (!action.startsWith("thread:")) return;
      const rootCommentId = action.slice("thread:".length);
      const option = threadOptions.find((item) => item.rootCommentId === rootCommentId);
      if (!option || !option.rootCommentId) return;
      setThreadTarget({
        mode: "thread",
        rootCommentId: option.rootCommentId,
      });
    })();
  }, [mainThread, setThreadTarget, threadOptions, threadTarget.mode, threadTarget.rootCommentId]);

  const threadHeader = (
    <View className="px-1">
      <Pressable
        onPress={(event) => {
          const { pageX, pageY } = event.nativeEvent;
          openThreadPicker({ x: pageX, y: pageY + 6 });
        }}
        className="flex-row items-center gap-2 rounded-xl border border-border bg-secondary/60 px-3 py-2 active:bg-secondary"
        accessibilityRole="button"
        accessibilityLabel="Choose reply thread"
      >
        <Ionicons
          name={iconForThreadTarget(threadTarget.mode)}
          size={16}
          color={theme.mutedForeground}
        />
        <View className="flex-1 gap-0.5">
          <Text className="text-[11px] font-medium uppercase text-muted-foreground">
            Thread
          </Text>
          {threadTarget.mode === "new" ? (
            <>
              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                New thread
              </Text>
              <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                This comment will start a separate thread.
              </Text>
            </>
          ) : (
            <>
              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                {threadTarget.mode === "main"
                  ? "Main thread"
                  : buildSelectedThreadTitle(
                      selectedThread?.actorName ?? "Thread",
                      selectedThread?.replyCount ?? 0,
                    )}
              </Text>
              <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                {buildThreadPreview(threadTarget.mode, selectedThread)}
              </Text>
            </>
          )}
        </View>
        {threadTarget.mode !== "main" ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              resetThreadTarget();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Reset to main thread"
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={theme.mutedForeground}
            />
          </Pressable>
        ) : null}
        <Ionicons
          name="chevron-down"
          size={16}
          color={theme.mutedForeground}
        />
      </Pressable>
    </View>
  );

  return (
    <MessageComposer
      onSubmit={onSubmit}
      mentionPickerPath={{
        pathname: "/[workspace]/mention-picker",
        params: { workspace: wsSlug ?? "", mode: "comment" },
      }}
      uploadContext={{ issueId }}
      placeholder="Add a comment…"
      headerContent={threadHeader}
      focusTrigger={focusKey}
    />
  );
}

function buildThreadLabel(option: CommentThreadOption): string {
  const replyLabel =
    option.replyCount > 0
      ? `${option.replyCount} ${option.replyCount === 1 ? "reply" : "replies"}`
      : "No replies yet";
  return `${option.actorName} · ${replyLabel}`;
}

function buildSelectedThreadTitle(actorName: string, replyCount: number): string {
  if (replyCount <= 0) return `Thread started by ${actorName}`;
  return `${actorName}'s thread · ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`;
}

function buildThreadPreview(
  mode: "main" | "thread" | "new",
  option: CommentThreadOption | null,
): string {
  if (mode === "new") return "This comment will start a separate thread.";
  if (!option) {
    return mode === "main"
      ? "Your next comment will create the main thread."
      : "This thread is no longer available.";
  }
  if (!option.preview) {
    return option.replyCount > 0
      ? `${option.replyCount} ${option.replyCount === 1 ? "reply" : "replies"}`
      : "No replies yet";
  }
  return stripMarkdown(option.preview);
}

function iconForThreadTarget(mode: "main" | "thread" | "new") {
  if (mode === "new") return "add-circle-outline" as const;
  if (mode === "thread") return "git-branch-outline" as const;
  return "chatbubble-ellipses-outline" as const;
}

function resolveThreadRootId(
  target: { mode: "main" | "thread" | "new"; rootCommentId: string | null },
  mainThread: CommentThreadOption | null,
) {
  if (target.mode === "new") return null;
  if (target.mode === "thread") return target.rootCommentId;
  return mainThread?.rootCommentId ?? null;
}
