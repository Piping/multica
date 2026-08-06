/// <reference types="vite/client" />

type RuntimeConfigResult =
  | {
      ok: true;
      config: {
        schemaVersion: number;
        apiUrl: string;
        wsUrl: string;
        appUrl: string;
      };
    }
  | { ok: false; error: { message: string } };

type WailsWindowContext =
  | { kind: "main" }
  | {
      kind: "issue";
      path: string;
      title: string;
      workspaceSlug: string;
      issueId: string;
    };

type DaemonState =
  | "running"
  | "stopped"
  | "starting"
  | "stopping"
  | "installing_cli"
  | "cli_not_found"
  | "auth_expired";

interface DaemonStatus {
  state: DaemonState;
  pid?: number;
  uptime?: string;
  daemonId?: string;
  deviceName?: string;
  agents?: string[];
  workspaceCount?: number;
  profile?: string;
  serverUrl?: string;
  externallyManaged?: boolean;
}

interface DesktopAPI {
  appInfo: {
    version: string;
    os: "macos" | "windows" | "linux" | "unknown";
  };
  systemLocale: string;
  runtimeConfig: RuntimeConfigResult;
  windowContext: WailsWindowContext;
  onSystemLocaleChanged: (callback: (locale: string) => void) => () => void;
  getLastFreeze: () => null;
  ackFreeze: (timestamp: number) => void;
  reportAuthSession: (userId: string | null) => void;
  onAuthToken: (callback: (token: string) => void) => () => void;
  onInviteOpen: (callback: (invitationId: string) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  downloadURL: (url: string) => Promise<void>;
  setImmersiveMode: (immersive: boolean) => Promise<void>;
  showNotification: (payload: {
    slug: string;
    itemId: string;
    issueKey: string;
    title: string;
    body: string;
  }) => void;
  setUnreadBadge: (count: number) => void;
  onInboxOpen: (
    callback: (payload: {
      slug: string;
      itemId: string;
      issueKey: string;
    }) => void,
  ) => () => void;
  onNavigationGesture: (
    callback: (gesture: "back" | "forward") => void,
  ) => () => void;
  setRendererRouteContext: (context: unknown) => void;
  setDiagnosticsControl: (control: unknown) => void;
  pickDirectory: (defaultPath?: string) => Promise<{
    ok: boolean;
    path?: string;
    basename?: string;
    reason?: "cancelled" | "no_window" | "error";
    error?: string;
  }>;
  validateLocalDirectory: (path: string) => Promise<{
    ok: boolean;
    reason?:
      | "not_absolute"
      | "not_found"
      | "not_a_directory"
      | "not_readable"
      | "not_writable"
      | "error";
    error?: string;
  }>;
  onCloseActiveTab: (callback: () => void) => () => void;
  closeWindow: () => void;
  openIssueWindow: (request: {
    path: string;
    title: string;
  }) => Promise<{ ok: boolean; reason?: string }>;
}

interface DaemonAPI {
  start: () => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  restart: () => Promise<{ success: boolean; error?: string }>;
  getStatus: () => Promise<DaemonStatus>;
  probeRuntimes: () => Promise<{
    probeResult: "success" | "error";
    runtimeCount?: number;
    providerSummary?: Record<string, number>;
    onlineCount?: number;
    offlineCount?: number;
  }>;
  getHostName: () => Promise<string>;
  onStatusChange: (callback: (status: DaemonStatus) => void) => () => void;
  setTargetApiUrl: (url: string) => Promise<void>;
  syncToken: (token: string, userId: string) => Promise<void>;
  clearToken: () => Promise<void>;
  reauthenticate: (
    token: string,
    userId: string,
  ) => Promise<
    | { ok: true }
    | { ok: false; reason: string; message?: string }
  >;
  isCliInstalled: () => Promise<boolean>;
  getPrefs: () => Promise<{ autoStart: boolean; autoStop: boolean }>;
  setPrefs: (
    prefs: Partial<{ autoStart: boolean; autoStop: boolean }>,
  ) => Promise<{ autoStart: boolean; autoStop: boolean }>;
  autoStart: () => Promise<void>;
  retryInstall: () => Promise<void>;
  startLogStream: () => void;
  stopLogStream: () => void;
  onLogLine: (callback: (line: string) => void) => () => void;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;
}

interface ReplicaAPI {
  load: (userId: string, workspaceId: string) => Promise<
    Array<{
      queryHash: string;
      queryKeyJson: string;
      dataJson: string;
      updatedAt: number;
    }>
  >;
  put: (
    userId: string,
    workspaceId: string,
    queryHash: string,
    queryKeyJson: string,
    dataJson: string,
    updatedAt: number,
  ) => Promise<void>;
  delete: (
    userId: string,
    workspaceId: string,
    queryHash: string,
  ) => Promise<void>;
  clearUser: (userId: string) => Promise<void>;
  loadBootstrap: (tokenHash: string) => Promise<{
    tokenHash: string;
    userJson: string;
    workspacesJson: string;
    updatedAt: number;
  } | null>;
  putBootstrap: (
    tokenHash: string,
    userJson: string,
    workspacesJson: string,
    updatedAt: number,
  ) => Promise<void>;
  deleteBootstrap: (tokenHash: string) => Promise<void>;
}

interface UpdaterAPI {
  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes?: string }) => void,
  ) => () => void;
  onDownloadProgress: (
    callback: (progress: { percent: number }) => void,
  ) => () => void;
  onUpdateDownloaded: (
    callback: (info: { version: string; releaseNotes?: string }) => void,
  ) => () => void;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getPreferences: () => Promise<{ automaticUpdates: boolean }>;
  setAutomaticUpdates: (
    enabled: boolean,
  ) => Promise<{ automaticUpdates: boolean }>;
  checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    desktopAPI: DesktopAPI;
    daemonAPI: DaemonAPI;
    replicaAPI: ReplicaAPI;
    updater: UpdaterAPI;
  }
}

export {};
