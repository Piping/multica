"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, getApi } from "../api";
import { useAuthStore } from "../auth";
import {
  captureSignupSource,
  identify as identifyAnalytics,
  initAnalytics,
  resetAnalytics,
} from "../analytics";
import { configStore } from "../config";
import { workspaceKeys } from "../workspace/queries";
import { createLogger } from "../logger";
import { defaultStorage } from "./storage";
import { setCurrentWorkspace } from "./workspace-storage";
import type { AuthBootstrapAdapter, ClientIdentity } from "./types";
import type { StorageAdapter } from "../types/storage";
import type { User, Workspace } from "../types";

const logger = createLogger("auth");

export function AuthInitializer({
  children,
  onLogin,
  onLogout,
  storage = defaultStorage,
  cookieAuth,
  identity,
  authBootstrap,
}: {
  children: ReactNode;
  onLogin?: () => void;
  onLogout?: () => void;
  storage?: StorageAdapter;
  cookieAuth?: boolean;
  identity?: ClientIdentity;
  authBootstrap?: AuthBootstrapAdapter;
}) {
  const qc = useQueryClient();
  const bootstrapTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authBootstrap || cookieAuth) return;

    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (!queryKeysEqual(event.query.queryKey, workspaceKeys.list())) return;
      const workspaces = event.query.state.data;
      const user = useAuthStore.getState().user;
      const token =
        bootstrapTokenRef.current ?? storage.getItem("multica_token");
      if (!token || !user || !isWorkspaceList(workspaces)) return;
      void authBootstrap.save(token, { user, workspaces }).catch((error) => {
        logger.warn("failed to persist auth bootstrap", error);
      });
    });
    return unsubscribe;
  }, [authBootstrap, cookieAuth, qc, storage]);

  useEffect(() => {
    const api = getApi();

    // Stamp attribution before anything else — the signup event (server-side)
    // reads this cookie, so it has to be present before the user hits submit.
    captureSignupSource();

    // Fetch app config (CDN domain, PostHog key, …) in the background — non-blocking.
    api
      .getConfig()
      .then((cfg) => {
        if (cfg.cdn_domain) {
          configStore.getState().setCdnConfig({
            cdnDomain: cfg.cdn_domain,
            // Old servers omit this — false keeps the previous behavior.
            cdnSigned: cfg.cdn_signed === true,
          });
        }
        configStore.getState().setAuthConfig({
          allowSignup: cfg.allow_signup,
          googleClientId: cfg.google_client_id,
          // Old servers omit this field — treat that as "creation allowed"
          // (the managed-cloud default) rather than blocking the UI.
          workspaceCreationDisabled: cfg.workspace_creation_disabled === true,
          // Absent/false on the managed cloud and older servers → section hidden.
          vcsIntegrationAvailable: cfg.vcs_integration_available === true,
        });
        configStore.getState().setDaemonConfig({
          daemonServerUrl: cfg.daemon_server_url,
          daemonAppUrl: cfg.daemon_app_url,
        });
        configStore.getState().setFeatureFlags(cfg.feature_flags);
        configStore.getState().setServerVersion(cfg.server_version);
        if (cfg.posthog_key) {
          initAnalytics({
            key: cfg.posthog_key,
            host: cfg.posthog_host || "",
            appVersion: identity?.version,
            environment: cfg.analytics_environment,
          });
        }
      })
      .catch(() => {
        /* config is optional — legacy file card matching degrades gracefully */
      });

    const onAuthSuccess = (user: User) => {
      onLogin?.();
      useAuthStore.setState({ user, isLoading: false });
      identifyAnalytics(user.id, { email: user.email, name: user.name });
    };

    const onAuthFailure = () => {
      onLogout?.();
      resetAnalytics();
      useAuthStore.setState({ user: null, isLoading: false });
    };

    if (cookieAuth) {
      // Cookie mode: the HttpOnly cookie is sent automatically by the browser.
      // Call the API to check if the session is still valid.
      //
      // Seed the workspace list into React Query so the URL-driven layout can
      // resolve the slug without a second fetch. The active workspace itself
      // is derived from the URL by [workspaceSlug]/layout.tsx — no imperative
      // selection here.
      Promise.all([api.getMe(), api.listWorkspaces()])
        .then(([user, wsList]) => {
          onAuthSuccess(user);
          qc.setQueryData(workspaceKeys.list(), wsList);
        })
        .catch((err) => {
          logger.error("cookie auth init failed", err);
          onAuthFailure();
        });
      return;
    }

    // Token mode: read from localStorage (Electron / legacy).
    const token = storage.getItem("multica_token");
    if (!token) {
      onLogout?.();
      useAuthStore.setState({ isLoading: false });
      return;
    }

    api.setToken(token);
    bootstrapTokenRef.current = token;

    const calibrateRemote = () =>
      Promise.all([api.getMe(), api.listWorkspaces()])
      .then(([user, wsList]) => {
        onAuthSuccess(user);
        qc.setQueryData(workspaceKeys.list(), wsList);
        void authBootstrap
          ?.save(token, { user, workspaces: wsList })
          .catch((error) => {
            logger.warn("failed to persist calibrated auth bootstrap", error);
          });
      })
      .catch((err) => {
        logger.error("auth init failed", err);
        const tokenWasRejected =
          (err instanceof ApiError && err.status === 401) ||
          storage.getItem("multica_token") !== token;
        if (tokenWasRejected) {
          bootstrapTokenRef.current = null;
          api.setToken(null);
          setCurrentWorkspace(null, null);
          storage.removeItem("multica_token");
          void authBootstrap?.remove(token).catch((removeError) => {
            logger.warn("failed to remove rejected auth bootstrap", removeError);
          });
          onAuthFailure();
          return;
        }
        // A local snapshot remains usable through network failures and 5xx
        // responses. Only finish loading without a user when no snapshot was
        // available.
        if (!useAuthStore.getState().user) onAuthFailure();
      });

    if (!authBootstrap) {
      void calibrateRemote();
      return;
    }

    void authBootstrap
      .load(token)
      .then((snapshot) => {
        if (snapshot) {
          qc.setQueryData(
            workspaceKeys.list(),
            snapshot.workspaces,
            { updatedAt: snapshot.updatedAt },
          );
          onAuthSuccess(snapshot.user);
        }
      })
      .catch((err) => {
        logger.warn("auth bootstrap restore failed", err);
      })
      .finally(() => {
        void calibrateRemote();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

function queryKeysEqual(
  first: readonly unknown[],
  second: readonly unknown[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function isWorkspaceList(value: unknown): value is Workspace[] {
  return (
    Array.isArray(value) &&
    value.every(
      (workspace) =>
        typeof workspace === "object" &&
        workspace !== null &&
        typeof (workspace as { id?: unknown }).id === "string" &&
        typeof (workspace as { slug?: unknown }).slug === "string",
    )
  );
}
