/** Inline agent feedback rendered directly after the comment that triggered
 * an active task. It mirrors the chat StatusPill + process fold, but scoped
 * to issue comments so users can see what the agent is doing without opening
 * the Runs sheet. */
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { AgentTask, TaskMessagePayload } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useCancelTask } from "@/data/mutations/issues";
import { taskMessagesOptions } from "@/data/queries/chat";
import { useActorLookup } from "@/data/use-actor-name";
import { formatElapsedSecs } from "@/lib/format-elapsed";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import { PulseDot } from "@/components/ui/pulse-dot";
import { cn } from "@/lib/utils";

interface Props {
  task: AgentTask;
  issueId: string;
}

export function AgentFeedbackInline({ task, issueId }: Props) {
  const { getName } = useActorLookup();
  const cancel = useCancelTask(issueId);
  const { data: taskMessages = [] } = useQuery(taskMessagesOptions(task.id));
  const anchorMs = useTaskAnchor(task);
  useTick(true, 1000);

  const stage = pickStage(task, taskMessages);
  const elapsed = Math.max(0, Math.floor((Date.now() - anchorMs) / 1000));
  const isWaiting = task.status === "queued" || task.status === "waiting_local_directory";

  const onCancel = () => {
    Alert.alert("Cancel task?", "The agent will stop after the current step.", [
      { text: "Keep running", style: "cancel" },
      { text: "Cancel task", style: "destructive", onPress: () => cancel.mutate(task.id) },
    ]);
  };

  return (
    <View className="mx-4 mt-2 rounded-xl border border-border bg-muted/25 px-3 py-2.5 gap-2">
      <View className="flex-row items-center gap-2">
        <ActorAvatar type="agent" id={task.agent_id} size={22} showPresence />
        {isWaiting ? (
          <Ionicons name="time-outline" size={13} color="#71717a" />
        ) : (
          <PulseDot size={7} />
        )}
        <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
          <Text className="text-xs font-medium text-foreground">
            {getName("agent", task.agent_id)}
          </Text>
          <Text className="text-xs text-muted-foreground"> · {stage}</Text>
          <Text className="text-xs text-muted-foreground/70"> · {formatElapsedSecs(elapsed)}</Text>
        </Text>
        <Pressable
          onPress={onCancel}
          disabled={cancel.isPending}
          hitSlop={8}
          className={cn("px-2 py-1 rounded-md bg-secondary", cancel.isPending && "opacity-50")}
        >
          <Text className="text-xs text-muted-foreground">Stop</Text>
        </Pressable>
      </View>
      <ChatTimeline items={taskMessages} isStreaming />
    </View>
  );
}

function pickStage(task: AgentTask, messages: readonly TaskMessagePayload[]): string {
  if (task.status === "queued") return "Queued";
  if (task.status === "dispatched") return "Starting up";
  if (task.status === "waiting_local_directory") return "Waiting for workspace path";

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.type === "tool_result" || msg.type === "error") continue;
    if (msg.type === "thinking") return "Thinking";
    if (msg.type === "text") return "Typing";
    if (msg.type === "tool_use") return toolLabel(msg.tool);
  }
  return "Thinking";
}

function toolLabel(tool: string | undefined): string {
  const slug = (tool ?? "").toLowerCase();
  if (slug === "bash" || slug === "exec") return "Running command";
  if (slug === "read" || slug === "glob") return "Reading files";
  if (slug === "grep") return "Searching code";
  if (slug === "write" || slug === "edit" || slug === "multi_edit") return "Making edits";
  if (slug === "web_search" || slug === "websearch") return "Searching web";
  return "Working";
}

function useTaskAnchor(task: AgentTask): number {
  const id = task.id;
  const stamp = task.started_at ?? task.dispatched_at ?? task.created_at;
  const ref = useRef<{ id: string; ms: number }>({ id: "", ms: Date.now() });
  if (ref.current.id !== id) {
    const parsed = Date.parse(stamp ?? "");
    ref.current = { id, ms: Number.isFinite(parsed) ? parsed : Date.now() };
  }
  return ref.current.ms;
}

function useTick(enabled: boolean, intervalMs: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setN((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
