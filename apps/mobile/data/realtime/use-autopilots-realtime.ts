/**
 * Autopilots realtime — listing/detail invalidation. Autopilot edits and
 * runs are low-frequency compared with issue/chat traffic, so a coarse
 * invalidate of the workspace autopilot cache stays within the mobile
 * "rare event may refetch" rule while keeping the implementation small.
 */
import { useQueryClient } from "@tanstack/react-query";
import { autopilotKeys } from "@/data/queries/autopilots";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

export function useAutopilotsRealtime() {
  const qc = useQueryClient();

  useWSSubscriptions(
    (ws, wsId) => {
      const invalidate = () =>
        qc.invalidateQueries({ queryKey: autopilotKeys.all(wsId) });

      return [
        ws.onAny((message) => {
          const type = message.type as string;
          if (
            type === "autopilot:created" ||
            type === "autopilot:updated" ||
            type === "autopilot:deleted" ||
            type === "autopilot:run_start" ||
            type === "autopilot:run_done"
          ) {
            invalidate();
          }
        }),
        ws.onReconnect(invalidate),
      ];
    },
    [qc],
  );
}
