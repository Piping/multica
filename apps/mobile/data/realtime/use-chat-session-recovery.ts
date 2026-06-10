/**
 * Mobile-only recovery poll for the active chat session.
 *
 * The normal path is still fully event-driven (WS updates patch/invalidate
 * caches in real time). This hook exists only as a narrow safety net for
 * mobile transport reality: if the foreground socket misses a terminal event
 * (most visibly `chat:done` / `task:completed`), the UI can otherwise sit on
 * "Starting up" / "Thinking" until a cold restart fetches the truth.
 *
 * Scope is intentionally tiny:
 *   - runs only while the chat screen is focused
 *   - runs only while the active session has an in-flight task id
 *   - refetches only the three caches that own the currently visible state
 *     (messages, pendingTask, live task timeline)
 *
 * This keeps the mobile client self-healing without turning chat into a
 * polling surface.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys, isTaskMessageTaskId } from "@/data/queries/chat";

const RECOVERY_POLL_MS = 5_000;

export function useChatSessionRecovery(
  sessionId: string | null,
  taskId: string | null | undefined,
  enabled: boolean,
) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || !sessionId || !taskId) return;

    const tick = () => {
      const jobs: Promise<unknown>[] = [
        qc.refetchQueries({
          queryKey: chatKeys.messages(sessionId),
          type: "active",
          exact: true,
        }),
        qc.refetchQueries({
          queryKey: chatKeys.pendingTask(sessionId),
          type: "active",
          exact: true,
        }),
      ];
      if (isTaskMessageTaskId(taskId)) {
        jobs.push(
          qc.refetchQueries({
            queryKey: chatKeys.taskMessages(taskId),
            type: "active",
            exact: true,
          }),
        );
      }
      void Promise.allSettled(jobs);
    };

    const id = setInterval(tick, RECOVERY_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, qc, sessionId, taskId]);
}
