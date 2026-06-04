/**
 * Long-press handler for a comment bubble. Exposes `onLongPress` (drives a
 * native iOS ActionSheetIOS) and `isPressed` (drives the caller's highlight
 * ring while the sheet is on screen).
 *
 * iOS-native first per apps/mobile/CLAUDE.md §UI components → waterfall step
 * 1: `ActionSheetIOS.showActionSheetWithOptions`. Zero custom layout, zero
 * animation, zero overflow math, zero new deps.
 *
 * Item set (conditional, mirrors web's comment context menu):
 *   Reply (stub) · React… (opens nested sheet) · Copy · Select Text ·
 *   Copy Link · Resolve/Unresolve Thread (root only) · Delete (own only) ·
 *   Cancel
 *
 * The nested React… sheet (5 quick emojis + More reactions… + Cancel) is
 * fired from INSIDE the outer sheet's completion callback rather than
 * inline, because iOS will refuse to present a second ActionSheet while the
 * first is still dismissing — the callback runs after dismissal completes.
 */
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import type { Reaction, TimelineEntry } from "@multica/core/types";
import { useAuthStore } from "@/data/auth-store";
import { getCurrentWebUrl } from "@/data/backend-config";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useActorLookup } from "@/data/use-actor-name";
import {
  useDeleteComment,
  useResolveComment,
  useToggleCommentReaction,
} from "@/data/mutations/issues";
import { QUICK_EMOJIS } from "@/lib/quick-emojis";
import { showActionMenu } from "@/lib/action-menu";

const QUICK_ROW_SIZE = 5;

export function useCommentLongPress(
  entry: TimelineEntry,
  issueId: string,
  issueIdentifier: string | undefined,
): { onLongPress: () => void; isPressed: boolean } {
  const [isPressed, setIsPressed] = useState(false);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id);
  const toggleReaction = useToggleCommentReaction(issueId);
  const deleteComment = useDeleteComment(issueId);
  const resolveComment = useResolveComment(issueId);
  const { getName } = useActorLookup();

  const onLongPress = useCallback(() => {
    const isOwn = entry.actor_type === "member" && entry.actor_id === userId;
    const isRoot = !entry.parent_id;
    const resolved = !!entry.resolved_at;
    const hasContent = !!entry.content;
    const webUrl = getCurrentWebUrl();
    const canCopyLink = !!(webUrl && wsSlug && issueIdentifier);
    const reactions = (entry.reactions ?? []) as Reaction[];

    Haptics.selectionAsync().catch(() => {});
    setIsPressed(true);

    void (async () => {
      const action = await showActionMenu({
        options: [
          { key: "reply", label: "Reply" },
          { key: "react", label: "React…" },
          ...(hasContent
            ? [
                { key: "copy", label: "Copy" },
                { key: "select", label: "Select Text" },
              ]
            : []),
          ...(canCopyLink ? [{ key: "copyLink", label: "Copy Link" }] : []),
          ...(isRoot
            ? [
                {
                  key: "resolve",
                  label: resolved ? "Unresolve Thread" : "Resolve Thread",
                },
              ]
            : []),
          ...(isOwn
            ? [{ key: "delete", label: "Delete", destructive: true }]
            : []),
        ],
      });
      setIsPressed(false);
      if (!action) return;

      switch (action) {
        case "reply": {
          const actorName = getName(
            entry.actor_type as "member" | "agent" | null | undefined,
            entry.actor_id,
          );
          useReplyTargetStore.getState().setTarget({
            commentId: entry.id,
            actorName: actorName || "comment",
            preview: entry.content ?? "",
          });
          return;
        }
        case "react":
          void presentReactSheet({
            entry,
            reactions,
            userId,
            wsSlug,
            issueId,
            toggle: (emoji, existing) =>
              toggleReaction.mutate({
                commentId: entry.id,
                emoji,
                existing,
              }),
          });
          return;
        case "copy":
          if (entry.content) {
            Clipboard.setStringAsync(entry.content);
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => {});
          }
          return;
        case "select":
          useCommentSelectStore.getState().setSelecting(entry.id);
          return;
        case "copyLink": {
          if (!canCopyLink) return;
          const url = `${webUrl}/${wsSlug}/issue/${issueIdentifier}#comment-${entry.id}`;
          Clipboard.setStringAsync(url);
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});
          return;
        }
        case "resolve":
          resolveComment.mutate({
            commentId: entry.id,
            resolved: !entry.resolved_at,
          });
          return;
        case "delete":
          Alert.alert(
            "Delete comment?",
            "This comment will be permanently deleted. Replies in the thread will also be removed. This cannot be undone.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => deleteComment.mutate(entry.id),
              },
            ],
          );
          return;
      }
    })();
  }, [
    entry,
    issueId,
    issueIdentifier,
    userId,
    wsSlug,
    toggleReaction,
    deleteComment,
    resolveComment,
  ]);

  return { onLongPress, isPressed };
}

async function presentReactSheet(args: {
  entry: TimelineEntry;
  reactions: Reaction[];
  userId: string | undefined;
  wsSlug: string | null;
  issueId: string;
  toggle: (emoji: string, existing: Reaction | undefined) => void;
}) {
  const { entry, reactions, userId, wsSlug, issueId, toggle } = args;
  const emojis = QUICK_EMOJIS.slice(0, QUICK_ROW_SIZE);
  const action = await showActionMenu({
    options: [
      ...emojis.map((emoji) => ({ key: emoji, label: emoji })),
      { key: "more", label: "More reactions…" },
    ],
  });
  if (!action) return;
  if (action === "more") {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issue/[id]/comment/[commentId]/emoji-picker",
      params: {
        workspace: wsSlug,
        id: issueId,
        commentId: entry.id,
      },
    });
    return;
  }
  const existing = reactions.find(
    (r) =>
      r.emoji === action &&
      r.actor_type === "member" &&
      r.actor_id === userId,
  );
  toggle(action, existing);
}
