/**
 * Chat session-switch sheet — presented as a formSheet by the parent Stack.
 * Reads the session list from the chat cache and writes the user's pick
 * through a shared "active session" store so the chat tab picks it up on
 * dismiss.
 *
 * Why a tiny dedicated store: the chat tab's `activeSessionId` used to live
 * as a `useState` inside `chat.tsx`, but now that session picking happens
 * on a separate route screen, we need a cross-screen channel. Same minimum
 * pattern as `useNewIssueDraftStore` for the new-issue form.
 */
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Separator } from "@/components/ui/separator";
import { chatSessionsOptions } from "@/data/queries/chat";
import { useDeleteChatSession } from "@/data/mutations/chat";
import { useChatSessionPickerStore } from "@/data/stores/chat-session-picker-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

export default function ChatSessionsRoute() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: sessions = [] } = useQuery(chatSessionsOptions(wsId));
  const activeSessionId = useChatSessionPickerStore((s) => s.activeSessionId);
  const requestSelect = useChatSessionPickerStore((s) => s.requestSelect);
  const deleteSession = useDeleteChatSession();
  const { getName } = useActorLookup();

  const confirmDelete = (session: ChatSession) => {
    Alert.alert(
      "Delete this chat?",
      session.title || "Untitled chat",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteSession.mutate(session.id);
            // If we just deleted the active one, the chat tab clears its
            // local activeSessionId via the picker-store request.
            if (session.id === activeSessionId) {
              requestSelect(null);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={Platform.OS === "android" ? ["top"] : []}
    >
      <View className="px-4 pt-4 pb-3 gap-1">
        <Text className="text-base font-semibold text-foreground">Chats</Text>
        <Text className="text-xs text-muted-foreground">
          Pick a conversation or long-press to delete it.
        </Text>
      </View>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {sessions.length === 0 ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-muted-foreground text-center">
              No chats yet.
            </Text>
          </View>
        ) : (
          sessions.map((session) => {
            const selected = session.id === activeSessionId;
            const archived = session.status === "archived";
            return (
              <View key={session.id} className="px-3 pb-2">
                <Pressable
                  onPress={() => {
                    requestSelect(session.id);
                    router.back();
                  }}
                  onLongPress={() => confirmDelete(session)}
                  className={cn(
                    "rounded-lg border border-border bg-card px-3 py-3 active:bg-secondary",
                    selected && "border-brand/40 bg-brand/5",
                  )}
                >
                  <View className="flex-row items-start gap-3">
                    <ActorAvatar
                      type="agent"
                      id={session.agent_id}
                      size={36}
                      showPresence
                    />
                    <View className="flex-1 min-w-0 gap-1">
                      <View className="flex-row items-center gap-2">
                        {session.has_unread ? (
                          <View className="size-1.5 rounded-full bg-brand" />
                        ) : null}
                        <Text
                          className={cn(
                            "flex-1 text-sm font-medium text-foreground",
                            session.has_unread && "font-semibold",
                          )}
                          numberOfLines={1}
                        >
                          {session.title || "Untitled chat"}
                        </Text>
                        {selected ? (
                          <Text className="text-sm text-primary font-semibold">✓</Text>
                        ) : null}
                      </View>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                        {getName("agent", session.agent_id)} · {timeAgo(session.updated_at || session.created_at)}
                      </Text>
                      {archived ? (
                        <View className="self-start rounded-full bg-secondary px-2 py-0.5">
                          <Text className="text-[10px] text-muted-foreground">Archived</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              </View>
            );
          })
        )}
        <Separator className="opacity-0" />
      </ScrollView>
    </SafeAreaView>
  );
}
