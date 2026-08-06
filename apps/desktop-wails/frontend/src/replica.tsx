import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import {
  discoverReplicaScope,
  discoverReplicaScopeFromEntries,
  isReplicableQuery,
  isReplicaQueryKey,
  restoreReplicaEntry,
} from "./replica-model";

const WRITE_DEBOUNCE_MS = 250;
const RESTORE_TIMEOUT_MS = 1_500;

export function ReplicaBoundary({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [restoredScope, setRestoredScope] = useState<string | null>(null);
  const generationRef = useRef(0);
  const scope = userId ? `${userId}:${workspaceId}` : null;

  useEffect(() => {
    const generation = ++generationRef.current;
    setRestoredScope(null);
    if (!userId) return;

    queryClient.removeQueries({
      predicate: (query) =>
        isReplicaQueryKey(query.queryKey, workspaceId),
    });

    let cancelled = false;
    const restoredHashes = new Set<string>();

    void withTimeout(
      window.replicaAPI.load(userId, workspaceId),
      RESTORE_TIMEOUT_MS,
      "Local state restore timed out",
    )
      .then(async (entries) => {
        if (cancelled || generationRef.current !== generation) return;
        const invalidHashes: string[] = [];
        const replicaScope = discoverReplicaScopeFromEntries(
          entries,
          workspaceId,
        );
        for (const entry of entries) {
          const restored = restoreReplicaEntry(entry, replicaScope);
          if (!restored) {
            invalidHashes.push(entry.queryHash);
            continue;
          }
          const current = queryClient.getQueryState(restored.queryKey);
          if (
            current?.data !== undefined &&
            current.dataUpdatedAt >= restored.updatedAt
          ) {
            continue;
          }
          queryClient.setQueryData(
            restored.queryKey,
            restored.data,
            { updatedAt: restored.updatedAt },
          );
          restoredHashes.add(restored.queryHash);
        }

        await Promise.allSettled(
          invalidHashes.map((queryHash) =>
            window.replicaAPI.delete(userId, workspaceId, queryHash),
          ),
        );
      })
      .catch((error) => {
        console.warn("Failed to restore the local state replica", error);
      })
      .finally(() => {
        if (cancelled || generationRef.current !== generation) return;
        if (restoredHashes.size > 0) {
          // Mark restored snapshots stale before their observers mount. The
          // observer renders local data immediately and starts remote
          // calibration in the background despite the global Infinity
          // staleTime.
          void queryClient.invalidateQueries({
            refetchType: "none",
            predicate: (query) => restoredHashes.has(query.queryHash),
          });
        }
        setRestoredScope(scope);
      });

    return () => {
      cancelled = true;
    };
  }, [queryClient, scope, userId, workspaceId]);

  useEffect(() => {
    if (!userId) return;

    const pending = new Map<
      string,
      {
        timer: number;
        dataJson: string;
        updatedAt: number;
        queryKeyJson: string;
        queryHash: string;
      }
    >();

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const { query } = event;
      const { data, dataUpdatedAt, status } = query.state;
      const replicaScope = discoverReplicaScope(
        queryClient
          .getQueryCache()
          .getAll()
          .flatMap((cachedQuery) =>
            cachedQuery.state.data === undefined
              ? []
              : [
                  {
                    queryKey: cachedQuery.queryKey,
                    data: cachedQuery.state.data,
                  },
                ],
          ),
        workspaceId,
      );
      if (
        status !== "success" ||
        data === undefined ||
        !isReplicableQuery(
          query.queryKey,
          data,
          replicaScope,
        )
      ) {
        return;
      }

      let dataJson: string;
      let queryKeyJson: string;
      try {
        dataJson = JSON.stringify(data);
        queryKeyJson = JSON.stringify(query.queryKey);
      } catch {
        return;
      }
      const existing = pending.get(query.queryHash);
      if (
        existing &&
        existing.updatedAt === dataUpdatedAt &&
        existing.dataJson === dataJson
      ) {
        return;
      }
      if (existing) window.clearTimeout(existing.timer);
      const timer = window.setTimeout(() => {
        pending.delete(query.queryHash);
        void window.replicaAPI
          .put(
            userId,
            workspaceId,
            query.queryHash,
            queryKeyJson,
            dataJson,
            dataUpdatedAt,
          )
          .catch((error) => {
            console.warn("Failed to persist local replica state", error);
          });
      }, WRITE_DEBOUNCE_MS);
      pending.set(query.queryHash, {
        timer,
        dataJson,
        updatedAt: dataUpdatedAt,
        queryKeyJson,
        queryHash: query.queryHash,
      });
    });

    return () => {
      unsubscribe();
      for (const value of pending.values()) {
        window.clearTimeout(value.timer);
        void window.replicaAPI
          .put(
            userId,
            workspaceId,
            value.queryHash,
            value.queryKeyJson,
            value.dataJson,
            value.updatedAt,
          )
          .catch((error) => {
            console.warn("Failed to flush local replica state", error);
          });
      }
    };
  }, [queryClient, userId, workspaceId]);

  if (!userId || restoredScope !== scope) {
    return (
      <div className="flex h-svh items-center justify-center">
        <MulticaIcon className="size-6 animate-pulse" />
      </div>
    );
  }
  return children;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
