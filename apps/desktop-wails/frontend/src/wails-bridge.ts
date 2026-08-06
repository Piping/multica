import { Call, Events } from "@wailsio/runtime";

type BootstrapResult = {
  appInfo: Window["desktopAPI"]["appInfo"];
  systemLocale: string;
  runtimeConfig: Window["desktopAPI"]["runtimeConfig"];
  windowContext: Window["desktopAPI"]["windowContext"];
};

export const APP_SERVICE = "main.AppService";
const DAEMON_SERVICE = "main.DaemonService";
const REPLICA_SERVICE = "main.ReplicaService";

export async function installWailsBridge(): Promise<void> {
  const windowName =
    new URLSearchParams(window.location.search).get("wailsWindow") || "main";
  const bootstrapMethod = `${APP_SERVICE}.Bootstrap`;
  let bootstrap: BootstrapResult;
  try {
    bootstrap = await callWithTransportRetry<BootstrapResult>(
      bootstrapMethod,
      windowName,
    );
  } catch (error) {
    throw new Error(
      `Wails bootstrap call failed (${bootstrapMethod}): ${errorMessage(error)}`,
      { cause: error },
    );
  }

  const desktopAPI: Window["desktopAPI"] = {
    appInfo: bootstrap.appInfo,
    systemLocale: bootstrap.systemLocale,
    runtimeConfig: bootstrap.runtimeConfig,
    windowContext: bootstrap.windowContext,
    onSystemLocaleChanged: (callback) =>
      subscribe("locale:system-changed", callback),
    getLastFreeze: () => null,
    ackFreeze: () => undefined,
    reportAuthSession: () => undefined,
    onAuthToken: (callback) => subscribe("auth:token", callback),
    onInviteOpen: (callback) => subscribe("invite:open", callback),
    openExternal: (url) => call<void>(`${APP_SERVICE}.OpenExternal`, url),
    downloadURL: (url) => call<void>(`${APP_SERVICE}.DownloadURL`, url),
    setImmersiveMode: (immersive) =>
      call<void>(`${APP_SERVICE}.SetImmersiveMode`, immersive),
    showNotification: (payload) => {
      void call<void>(`${APP_SERVICE}.ShowNotification`, payload).catch(
        console.error,
      );
    },
    setUnreadBadge: (count) => {
      void call<void>(`${APP_SERVICE}.SetUnreadBadge`, count).catch(
        console.error,
      );
    },
    onInboxOpen: (callback) => subscribe("inbox:open", callback),
    onNavigationGesture: () => () => undefined,
    setRendererRouteContext: () => undefined,
    setDiagnosticsControl: () => undefined,
    pickDirectory: (defaultPath = "") =>
      call(`${APP_SERVICE}.PickDirectory`, defaultPath),
    validateLocalDirectory: (path) =>
      call(`${APP_SERVICE}.ValidateLocalDirectory`, path),
    onCloseActiveTab: (callback) =>
      subscribe(`window:close-active-tab:${windowName}`, callback),
    closeWindow: () => {
      void call<void>(`${APP_SERVICE}.CloseWindow`, windowName);
    },
    openIssueWindow: (request) =>
      call(`${APP_SERVICE}.OpenIssueWindow`, request),
  };

  const daemonAPI: Window["daemonAPI"] = {
    start: () => call(`${DAEMON_SERVICE}.Start`),
    stop: () => call(`${DAEMON_SERVICE}.Stop`),
    restart: () => call(`${DAEMON_SERVICE}.Restart`),
    getStatus: () => call(`${DAEMON_SERVICE}.GetStatus`),
    probeRuntimes: () => call(`${DAEMON_SERVICE}.ProbeRuntimes`),
    getHostName: () => call(`${DAEMON_SERVICE}.GetHostName`),
    onStatusChange: (callback) => subscribe("daemon:status", callback),
    setTargetApiUrl: (url) =>
      call<void>(`${DAEMON_SERVICE}.SetTargetAPIURL`, url),
    syncToken: (token, userId) =>
      call<void>(`${DAEMON_SERVICE}.SyncToken`, token, userId),
    clearToken: () => call<void>(`${DAEMON_SERVICE}.ClearToken`),
    reauthenticate: (token, userId) =>
      call(`${DAEMON_SERVICE}.Reauthenticate`, token, userId),
    isCliInstalled: () => call(`${DAEMON_SERVICE}.IsCLIInstalled`),
    getPrefs: () => call(`${DAEMON_SERVICE}.GetPrefs`),
    setPrefs: (prefs) => call(`${DAEMON_SERVICE}.SetPrefs`, prefs),
    autoStart: () => call<void>(`${DAEMON_SERVICE}.AutoStart`),
    retryInstall: () => call<void>(`${DAEMON_SERVICE}.RetryInstall`),
    startLogStream: () => {
      void call<void>(`${DAEMON_SERVICE}.StartLogStream`);
    },
    stopLogStream: () => {
      void call<void>(`${DAEMON_SERVICE}.StopLogStream`);
    },
    onLogLine: (callback) => subscribe("daemon:log-line", callback),
    openLogFile: () => call(`${DAEMON_SERVICE}.OpenLogFile`),
  };

  const replicaAPI: Window["replicaAPI"] = {
    load: (userId, workspaceId) =>
      call(`${REPLICA_SERVICE}.Load`, userId, workspaceId),
    put: (
      userId,
      workspaceId,
      queryHash,
      queryKeyJson,
      dataJson,
      updatedAt,
    ) =>
      call<void>(
        `${REPLICA_SERVICE}.Put`,
        userId,
        workspaceId,
        queryHash,
        queryKeyJson,
        dataJson,
        updatedAt,
      ),
    delete: (userId, workspaceId, queryHash) =>
      call<void>(
        `${REPLICA_SERVICE}.Delete`,
        userId,
        workspaceId,
        queryHash,
      ),
    clearUser: (userId) =>
      call<void>(`${REPLICA_SERVICE}.ClearUser`, userId),
  };

  const updater: Window["updater"] = {
    onUpdateAvailable: () => () => undefined,
    onDownloadProgress: () => () => undefined,
    onUpdateDownloaded: () => () => undefined,
    downloadUpdate: () => unsupportedUpdaterOperation(),
    installUpdate: () => unsupportedUpdaterOperation(),
    getPreferences: async () => ({ automaticUpdates: false }),
    setAutomaticUpdates: async () => ({ automaticUpdates: false }),
    checkForUpdates: async () => ({
      ok: false,
      error: "Automatic updates are not available in the Wails build yet.",
    }),
  };

  Object.defineProperties(window, {
    desktopAPI: {
      configurable: false,
      enumerable: true,
      value: desktopAPI,
      writable: false,
    },
    daemonAPI: {
      configurable: false,
      enumerable: true,
      value: daemonAPI,
      writable: false,
    },
    replicaAPI: {
      configurable: false,
      enumerable: true,
      value: replicaAPI,
      writable: false,
    },
    updater: {
      configurable: false,
      enumerable: true,
      value: updater,
      writable: false,
    },
  });
}

function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(method, ...args) as Promise<T>;
}

async function callWithTransportRetry<T>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  const delays = [100, 250, 500];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call<T>(method, ...args);
    } catch (error) {
      if (attempt >= delays.length || !isTransientTransportError(error)) {
        throw error;
      }
      await sleep(delays[attempt] ?? 0);
    }
  }
}

export function reportWailsStartupError(message: string): void {
  void call<void>(`${APP_SERVICE}.ReportStartupError`, message).catch(
    console.error,
  );
}

function subscribe<T>(
  eventName: string,
  callback: (payload: T) => void,
): () => void {
  return Events.On(eventName, (event) => callback(event.data as T));
}

async function unsupportedUpdaterOperation(): Promise<void> {
  throw new Error("Automatic updates are not available in the Wails build yet.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientTransportError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("load failed") || message.includes("failed to fetch");
}

function sleep(delay: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}
