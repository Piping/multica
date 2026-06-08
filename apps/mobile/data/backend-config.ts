/**
 * Mobile runtime backend config — a small persisted selector for which
 * Multica deployment this app talks to.
 *
 * Why this lives in mobile:
 *   - web/desktop already have their own runtime-config shape
 *   - mobile needs a device-local persisted choice (SecureStore), not just
 *     a build-time env constant
 *   - ApiClient.fetch and "Open on web" actions need synchronous access to
 *     the CURRENT selection outside React
 */
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const STORAGE_KEY = "multica_backend_api_url";
const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL;
const ENV_WEB_URL = process.env.EXPO_PUBLIC_WEB_URL;

if (!ENV_API_URL) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set. Add it to apps/mobile/.env.development.local " +
      "(see apps/mobile/.env.staging for an example).",
  );
}

export interface BackendOption {
  id: string;
  label: string;
  apiUrl: string;
  webUrl: string | null;
  subtitle: string;
}

interface StoredBackendSelection {
  apiUrl: string;
  webUrl?: string | null;
}

const AGENT_DIFF_BACKEND = createBackendOption(
  "agent-diff-host",
  "agent.diff.host",
  "https://agent.diff.host",
  "https://agent.diff.host",
);

const MULTICA_CLOUD_BACKEND = createBackendOption(
  "multica-cloud",
  "Multica Cloud",
  "https://api.multica.ai",
  "https://multica.ai",
);

const BUILTIN_BACKENDS = dedupeBackends([
  AGENT_DIFF_BACKEND,
  MULTICA_CLOUD_BACKEND,
]);

const DEFAULT_BACKEND = resolveBackendOption(
  normalizeHttpUrl(ENV_API_URL, "EXPO_PUBLIC_API_URL"),
  ENV_WEB_URL ?? null,
  BUILTIN_BACKENDS,
);

export const BACKEND_OPTIONS = dedupeBackends([
  DEFAULT_BACKEND,
  ...BUILTIN_BACKENDS,
]);

interface BackendState {
  current: BackendOption;
  hydrated: boolean;
  restore: () => Promise<BackendOption>;
  setBackend: (backend: BackendOption) => Promise<void>;
}

export const useBackendStore = create<BackendState>((set) => ({
  current: DEFAULT_BACKEND,
  hydrated: false,

  restore: async () => {
    let storedValue: string | null = null;
    try {
      storedValue = await SecureStore.getItemAsync(STORAGE_KEY);
    } catch {
      storedValue = null;
    }

    const storedSelection = parseStoredBackendSelection(storedValue);
    const next = storedSelection
      ? resolveBackendOption(storedSelection.apiUrl, storedSelection.webUrl)
      : DEFAULT_BACKEND;
    set({ current: next, hydrated: true });
    return next;
  },

  setBackend: async (backend) => {
    const next = resolveBackendOption(backend.apiUrl, backend.webUrl);
    set({ current: next, hydrated: true });
    if (next.apiUrl === DEFAULT_BACKEND.apiUrl) {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
      return;
    }
    await SecureStore.setItemAsync(
      STORAGE_KEY,
      JSON.stringify({
        apiUrl: next.apiUrl,
        webUrl: next.webUrl,
      } satisfies StoredBackendSelection),
    );
  },
}));

export function getCurrentBackend(): BackendOption {
  return useBackendStore.getState().current;
}

export function getCurrentApiUrl(): string {
  return getCurrentBackend().apiUrl;
}

export function getCurrentWebUrl(): string | null {
  return getCurrentBackend().webUrl;
}

export function getCurrentWsUrl(): string {
  return deriveWsUrl(getCurrentApiUrl());
}

export function createCustomBackend(
  apiUrl: string,
  webUrl?: string | null,
): BackendOption {
  const normalizedApiUrl = normalizeHttpUrl(apiUrl, "apiUrl");
  const normalizedWebUrl =
    typeof webUrl === "string" && webUrl.trim().length > 0
      ? normalizeHttpUrl(webUrl, "webUrl")
      : deriveAppUrl(normalizedApiUrl);
  return resolveBackendOption(normalizedApiUrl, normalizedWebUrl);
}

function createBackendOption(
  id: string,
  label: string,
  apiUrl: string,
  webUrl?: string | null,
): BackendOption {
  const normalizedApiUrl = normalizeHttpUrl(apiUrl, "apiUrl");
  const normalizedWebUrl = webUrl
    ? normalizeHttpUrl(webUrl, "webUrl")
    : null;
  return {
    id,
    label,
    apiUrl: normalizedApiUrl,
    webUrl: normalizedWebUrl,
    subtitle: new URL(normalizedApiUrl).host,
  };
}

function resolveBackendOption(
  apiUrl: string,
  webUrl?: string | null,
  options: BackendOption[] = BACKEND_OPTIONS,
): BackendOption {
  const normalizedApiUrl = normalizeHttpUrl(apiUrl, "apiUrl");
  const builtIn = options.find((backend) => backend.apiUrl === normalizedApiUrl);
  if (builtIn) return builtIn;

  const label = labelForApiUrl(normalizedApiUrl);
  return createBackendOption(
    `custom-${new URL(normalizedApiUrl).host}`,
    label,
    normalizedApiUrl,
    webUrl ?? undefined,
  );
}

function labelForApiUrl(apiUrl: string): string {
  const host = new URL(apiUrl).host;
  if (host === "agent.diff.host") return "agent.diff.host";
  if (host === "api.multica.ai" || host === "multica.ai") return "Multica Cloud";
  return host;
}

function dedupeBackends(backends: BackendOption[]): BackendOption[] {
  const seen = new Set<string>();
  return backends.filter((backend) => {
    if (seen.has(backend.apiUrl)) return false;
    seen.add(backend.apiUrl);
    return true;
  });
}

function deriveWsUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error("apiUrl must use http or https");
  url.pathname = joinPath(url.pathname, "/ws");
  url.search = "";
  url.hash = "";
  return trimTrailingSlash(url.toString());
}

function deriveAppUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.port = "3000";
  } else if (
    url.hostname.startsWith("api.") &&
    url.hostname.split(".").length >= 3
  ) {
    url.hostname = url.hostname.slice("api.".length);
  }
  return trimTrailingSlash(url.toString());
}

function parseStoredBackendSelection(
  raw: string | null,
): StoredBackendSelection | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith("{")) {
    return { apiUrl: trimmed, webUrl: null };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const apiUrl =
      typeof parsed.apiUrl === "string" ? parsed.apiUrl.trim() : "";
    const webUrl =
      typeof parsed.webUrl === "string" ? parsed.webUrl.trim() : null;
    if (!apiUrl) return null;
    return { apiUrl, webUrl };
  } catch {
    return null;
  }
}

function normalizeHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field} must use http or https`);
  }
  url.search = "";
  url.hash = "";
  return trimTrailingSlash(url.toString());
}

function joinPath(base: string, suffix: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}${suffix}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
