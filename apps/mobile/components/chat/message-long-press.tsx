/**
 * Long-press handler for a chat message bubble. Exposes `onLongPress`
 * (drives a native iOS ActionSheetIOS) and `isPressed` (drives the
 * caller's highlight ring while the sheet is on screen).
 *
 * iOS-native first per apps/mobile/CLAUDE.md §UI components → waterfall
 * step 1: `ActionSheetIOS.showActionSheetWithOptions`. Zero custom
 * layout, zero animation, zero overflow math, zero new deps.
 *
 * Item set (v1, conditional):
 *   Copy · Select Text · Cancel
 *
 * Mirrors `useCommentLongPress` in `components/issue/comment-context-
 * menu.tsx` — kept as a sibling rather than a shared primitive because
 * we have only 2 callers (chat + comments). Below the "3 callers + no
 * native alternative" threshold in apps/mobile/CLAUDE.md.
 */
import { useCallback, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import type { ChatMessage } from "@multica/core/types";
import { useChatSelectStore } from "@/data/chat-select-store";
import { showActionMenu } from "@/lib/action-menu";

export function useChatMessageLongPress(
  message: ChatMessage,
  actions?: {
    canRegenerate?: boolean;
    canResend?: boolean;
    canWithdraw?: boolean;
    onRegenerate?: () => void;
    onResend?: () => void;
    onWithdraw?: () => void;
    onEdit?: (message: ChatMessage) => void;
  },
): { onLongPress: () => void; isPressed: boolean } {
  const [isPressed, setIsPressed] = useState(false);

  const onLongPress = useCallback(() => {
    const hasContent = !!message.content;

    Haptics.selectionAsync().catch(() => {});
    setIsPressed(true);

    void (async () => {
      const action = await showActionMenu({
        options: [
          ...(hasContent
            ? [
                { key: "copy", label: "Copy" },
                { key: "select", label: "Select Text" },
              ]
            : []),
          ...(message.role === "user" && actions?.canResend
            ? [{ key: "resend", label: "Retry" }]
            : []),
          ...(message.role === "user" && actions?.canWithdraw
            ? [{ key: "edit", label: "Edit" }]
            : []),
          ...(message.role === "assistant" && actions?.canRegenerate
            ? [{ key: "regenerate", label: "Regenerate" }]
            : []),
          ...(message.role === "user" && actions?.canWithdraw
            ? [{ key: "withdraw", label: "Withdraw", destructive: true }]
            : []),
        ],
      });
      setIsPressed(false);
      if (action === "copy" && message.content) {
        Clipboard.setStringAsync(message.content);
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
        return;
      }
      if (action === "select") {
        useChatSelectStore.getState().setSelecting(message.id);
        return;
      }
      if (action === "resend") actions?.onResend?.();
      else if (action === "edit") actions?.onEdit?.(message);
      else if (action === "regenerate") actions?.onRegenerate?.();
      else if (action === "withdraw") actions?.onWithdraw?.();
    })();
  }, [actions, message]);

  return { onLongPress, isPressed };
}
