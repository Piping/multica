import { useEffect, useLayoutEffect, useMemo } from "react";
import { CoreProvider } from "@multica/core/platform";
import { pickLocale, type SupportedLocale } from "@multica/core/i18n";
import { useAuthStore } from "@multica/core/auth";
import { useWelcomeStore } from "@multica/core/onboarding";
import { ThemeProvider } from "@multica/ui/components/common/theme-provider";
import { Toaster } from "@multica/ui/components/ui/sonner";
import { RESOURCES } from "@multica/views/locales";
import { createWailsLocaleAdapter } from "./locale";
import { AppRouter } from "./router";

const HTML_LANG: Record<SupportedLocale, string> = {
  en: "en",
  "zh-Hans": "zh-CN",
  ko: "ko-KR",
  ja: "ja-JP",
};

function DaemonSessionBridge() {
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.isLoading);
  const runtimeConfig = window.desktopAPI.runtimeConfig;

  useEffect(() => {
    if (!runtimeConfig.ok) return;
    void window.daemonAPI.setTargetApiUrl(runtimeConfig.config.apiUrl);
  }, [runtimeConfig]);

  useEffect(() => {
    if (loading) return;
    window.desktopAPI.reportAuthSession(user?.id ?? null);
  }, [loading, user?.id]);

  useEffect(() => {
    if (!user) return;
    const token = window.localStorage.getItem("multica_token");
    if (!token) return;
    void window.daemonAPI
      .syncToken(token, user.id)
      .then(() => window.daemonAPI.autoStart())
      .catch((error) => {
        console.error("Failed to start the Wails daemon", error);
      });
  }, [user]);

  return null;
}

async function handleLogout(): Promise<void> {
  window.desktopAPI.reportAuthSession(null);
  useWelcomeStore.getState().reset();
  try {
    await window.daemonAPI.clearToken();
  } finally {
    await window.daemonAPI.stop().catch(() => undefined);
  }
}

function ConfigurationError({ message }: { message: string }) {
  return (
    <div className="flex h-svh items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-xl rounded-md border bg-card p-6 shadow-sm">
        <h1 className="text-title font-semibold">Desktop configuration error</h1>
        <p className="mt-3 text-body text-muted-foreground">
          Multica could not load <code>~/.multica/desktop.json</code>.
        </p>
        <pre className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-caption text-muted-foreground">
          {message}
        </pre>
      </div>
    </div>
  );
}

export function App() {
  const { version, os } = window.desktopAPI.appInfo;
  const runtimeConfig = window.desktopAPI.runtimeConfig;
  const localeAdapter = useMemo(
    () => createWailsLocaleAdapter(window.desktopAPI.systemLocale),
    [],
  );
  const locale = useMemo(() => pickLocale(localeAdapter), [localeAdapter]);
  const identity = useMemo(
    () => ({ platform: "desktop", version, os }),
    [os, version],
  );

  useLayoutEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);

  useEffect(
    () =>
      window.desktopAPI.onSystemLocaleChanged((systemLocale) => {
        if (localeAdapter.getUserChoice()) return;
        const next = pickLocale({
          ...localeAdapter,
          getSystemPreferences: () => [systemLocale],
        });
        if (next !== locale) window.location.reload();
      }),
    [locale, localeAdapter],
  );

  return (
    <ThemeProvider>
      {runtimeConfig.ok ? (
        <CoreProvider
          apiBaseUrl={runtimeConfig.config.apiUrl}
          wsUrl={runtimeConfig.config.wsUrl}
          identity={identity}
          locale={locale}
          resources={{ [locale]: RESOURCES[locale] }}
          localeAdapter={localeAdapter}
          onLogout={handleLogout}
        >
          <DaemonSessionBridge />
          <AppRouter />
        </CoreProvider>
      ) : (
        <ConfigurationError message={runtimeConfig.error.message} />
      )}
      <Toaster />
    </ThemeProvider>
  );
}
