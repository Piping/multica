import type {
  AuthBootstrapAdapter,
  AuthBootstrapSnapshot,
} from "@multica/core/platform";
import type { User, Workspace } from "@multica/core/types";

export const wailsAuthBootstrap: AuthBootstrapAdapter = {
  async load(token) {
    const tokenHash = await hashToken(token);
    const stored = await window.replicaAPI.loadBootstrap(tokenHash);
    if (!stored) return null;

    const snapshot = parseSnapshot(stored);
    if (snapshot) return snapshot;

    await window.replicaAPI.deleteBootstrap(tokenHash);
    return null;
  },

  async save(token, snapshot) {
    const tokenHash = await hashToken(token);
    await window.replicaAPI.putBootstrap(
      tokenHash,
      JSON.stringify(snapshot.user),
      JSON.stringify(snapshot.workspaces),
      Date.now(),
    );
  },

  async remove(token) {
    const tokenHash = await hashToken(token);
    await window.replicaAPI.deleteBootstrap(tokenHash);
  },
};

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parseSnapshot(stored: {
  tokenHash: string;
  userJson: string;
  workspacesJson: string;
  updatedAt: number;
}): AuthBootstrapSnapshot | null {
  if (
    !/^[0-9a-f]{64}$/.test(stored.tokenHash) ||
    !Number.isSafeInteger(stored.updatedAt) ||
    stored.updatedAt < 0
  ) {
    return null;
  }

  try {
    const user: unknown = JSON.parse(stored.userJson);
    const workspaces: unknown = JSON.parse(stored.workspacesJson);
    if (!isUser(user) || !isWorkspaceList(workspaces)) return null;
    return { user, workspaces, updatedAt: stored.updatedAt };
  } catch {
    return null;
  }
}

function isUser(value: unknown): value is User {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.email === "string" &&
    typeof value.name === "string"
  );
}

function isWorkspaceList(value: unknown): value is Workspace[] {
  return (
    Array.isArray(value) &&
    value.every(
      (workspace) =>
        isRecord(workspace) &&
        typeof workspace.id === "string" &&
        workspace.id.length > 0 &&
        typeof workspace.slug === "string" &&
        workspace.slug.length > 0 &&
        typeof workspace.name === "string",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
