import "@fontsource-variable/inter";
import "@fontsource-variable/inter/wght-italic.css";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@multica/ui/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { WebProviders } from "@/components/web-providers";
import { resolveBrowserLocale } from "@/lib/browser-locale";
import { RESOURCES } from "@multica/views/locales";
import { AppRouter } from "./router";
import "@/app/globals.css";

const locale = resolveBrowserLocale();
document.documentElement.lang =
  locale === "zh-Hans"
    ? "zh-CN"
    : locale === "ko"
      ? "ko-KR"
      : locale === "ja"
        ? "ja-JP"
        : "en";

if (import.meta.env.DEV && import.meta.env.VITE_REACT_GRAB) {
  const script = document.createElement("script");
  script.src = "//unpkg.com/react-grab/dist/index.global.js";
  script.crossOrigin = "anonymous";
  document.head.append(script);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <WebProviders
          locale={locale}
          resources={{ [locale]: RESOURCES[locale] }}
          apiBaseUrl={import.meta.env.VITE_API_URL}
          wsUrl={import.meta.env.VITE_WS_URL}
        >
          <AppRouter />
        </WebProviders>
        <Toaster />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
