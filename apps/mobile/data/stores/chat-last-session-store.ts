/**
 * Device-local memory of the last viewed chat session per workspace.
 *
 * Purpose:
 *   - survive app remount / cold start
 *   - reopen the same conversation the user was reading, not a blank
 *     "new chat" surface
 *
 * Scope is workspace-local because chat sessions do not cross workspaces.
 * Persistence uses SecureStore alongside the existing workspace/backend
 * selectors; volume is tiny (a single JSON map).
 */
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const STORAGE_KEY = "multica_last_chat_session_by_workspace";

type LastSessionMap = Record<string, string>;

interface ChatLastSessionState {
  byWorkspace: LastSessionMap;
  hydrated: boolean;
  restore: () => Promise<LastSessionMap>;
  remember: (workspaceId: string, sessionId: string) => Promise<void>;
  clearWorkspace: (workspaceId: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useChatLastSessionStore = create<ChatLastSessionState>(
  (set, get) => ({
    byWorkspace: {},
    hydrated: false,

    restore: async () => {
      if (get().hydrated) return get().byWorkspace;
      let raw: string | null = null;
      try {
        raw = await SecureStore.getItemAsync(STORAGE_KEY);
      } catch {
        raw = null;
      }
      const next = parseStoredMap(raw);
      set({ byWorkspace: next, hydrated: true });
      return next;
    },

    remember: async (workspaceId, sessionId) => {
      const current = get().byWorkspace;
      if (current[workspaceId] === sessionId) {
        if (!get().hydrated) set({ hydrated: true });
        return;
      }
      const next = { ...current, [workspaceId]: sessionId };
      set({ byWorkspace: next, hydrated: true });
      await persistMap(next);
    },

    clearWorkspace: async (workspaceId) => {
      const current = get().byWorkspace;
      if (!(workspaceId in current)) {
        if (!get().hydrated) set({ hydrated: true });
        return;
      }
      const next = { ...current };
      delete next[workspaceId];
      set({ byWorkspace: next, hydrated: true });
      await persistMap(next);
    },

    clearAll: async () => {
      set({ byWorkspace: {}, hydrated: true });
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    },
  }),
);

function parseStoredMap(raw: string | null): LastSessionMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: LastSessionMap = {};
    for (const [workspaceId, sessionId] of Object.entries(parsed)) {
      if (
        typeof workspaceId === "string" &&
        workspaceId.length > 0 &&
        typeof sessionId === "string" &&
        sessionId.length > 0
      ) {
        out[workspaceId] = sessionId;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function persistMap(map: LastSessionMap): Promise<void> {
  if (Object.keys(map).length === 0) {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(map));
}
