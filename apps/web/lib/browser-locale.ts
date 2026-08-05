import { LOCALE_COOKIE, type SupportedLocale } from "@multica/core/i18n";
import { resolveLocaleFromSignals } from "./locale-routing";

function readCookie(name: string): string | undefined {
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return value ? decodeURIComponent(value) : undefined;
}

export function resolveBrowserLocale(): SupportedLocale {
  return resolveLocaleFromSignals({
    cookieLocale: readCookie(LOCALE_COOKIE),
    acceptLanguage: navigator.languages.join(","),
  });
}
