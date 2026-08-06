// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setApiInstance } from "../api";
import type { ApiClient } from "../api/client";
import { createAuthStore, registerAuthStore, useAuthStore } from "../auth";
import type { StorageAdapter, User, Workspace } from "../types";
import { workspaceKeys } from "../workspace/queries";
import { AuthInitializer } from "./auth-initializer";
import type { AuthBootstrapAdapter } from "./types";

const user = {
  id: "user-1",
  name: "Local User",
  email: "local@example.com",
  avatar_url: null,
} as User;

const workspaces = [
  {
    id: "workspace-1",
    slug: "local",
    name: "Local Workspace",
  } as Workspace,
];

function Probe() {
  const currentUser = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.isLoading);
  const queryClient = useQueryClient();
  const cachedWorkspaces =
    queryClient.getQueryData<Workspace[]>(workspaceKeys.list()) ?? [];
  return (
    <div>
      {loading ? "loading" : currentUser?.email ?? "signed-out"}
      <span>{cachedWorkspaces[0]?.slug ?? "no-workspace"}</span>
    </div>
  );
}

function makeStorage(): StorageAdapter & { hasToken: () => boolean } {
  const values = new Map([["multica_token", "secret-token"]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key);
    },
    hasToken: () => values.has("multica_token"),
  };
}

function makeBootstrap(): AuthBootstrapAdapter & {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn().mockResolvedValue({
      user,
      workspaces,
      updatedAt: 100,
    }),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function renderInitializer({
  api,
  storage,
  bootstrap,
  onLogout,
}: {
  api: Pick<ApiClient, "getConfig" | "getMe" | "listWorkspaces" | "setToken">;
  storage: StorageAdapter;
  bootstrap: AuthBootstrapAdapter;
  onLogout?: () => void;
}) {
  setApiInstance(api as ApiClient);
  registerAuthStore(
    createAuthStore({
      api: api as ApiClient,
      storage,
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthInitializer
        storage={storage}
        authBootstrap={bootstrap}
        onLogout={onLogout}
      >
        <Probe />
      </AuthInitializer>
    </QueryClientProvider>,
  );
}

function makeApi(
  getMe: () => Promise<User>,
  listWorkspaces: () => Promise<Workspace[]>,
) {
  return {
    setToken: vi.fn(),
    getConfig: vi.fn().mockRejectedValue(new Error("config unavailable")),
    getMe: vi.fn(getMe),
    listWorkspaces: vi.fn(listWorkspaces),
  };
}

describe("AuthInitializer auth bootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("restores user and workspace cache before remote calibration finishes", async () => {
    const never = new Promise<never>(() => undefined);
    const storage = makeStorage();
    const bootstrap = makeBootstrap();
    const api = makeApi(() => never, () => never);

    renderInitializer({ api, storage, bootstrap });

    expect(await screen.findByText("local@example.com")).toBeTruthy();
    expect(screen.getByText("local")).toBeTruthy();
    expect(api.getMe).toHaveBeenCalledOnce();
    expect(api.listWorkspaces).toHaveBeenCalledOnce();
  });

  it("keeps restored state and token after a transient remote failure", async () => {
    const storage = makeStorage();
    const bootstrap = makeBootstrap();
    const onLogout = vi.fn();
    const api = makeApi(
      () => Promise.reject(new TypeError("fetch failed")),
      () => Promise.reject(new TypeError("fetch failed")),
    );

    renderInitializer({ api, storage, bootstrap, onLogout });

    expect(await screen.findByText("local@example.com")).toBeTruthy();
    await waitFor(() => expect(api.getMe).toHaveBeenCalledOnce());
    expect(storage.hasToken()).toBe(true);
    expect(onLogout).not.toHaveBeenCalled();
    expect(bootstrap.remove).not.toHaveBeenCalled();
  });

  it("removes restored state and bootstrap after a 401", async () => {
    const storage = makeStorage();
    const bootstrap = makeBootstrap();
    const onLogout = vi.fn();
    const api = makeApi(
      () => Promise.reject(new ApiError("unauthorized", 401, "Unauthorized")),
      () => Promise.resolve(workspaces),
    );

    renderInitializer({ api, storage, bootstrap, onLogout });

    expect(await screen.findByText("local@example.com")).toBeTruthy();
    expect(await screen.findByText("signed-out")).toBeTruthy();
    expect(storage.hasToken()).toBe(false);
    expect(bootstrap.remove).toHaveBeenCalledWith("secret-token");
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
