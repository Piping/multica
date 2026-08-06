import type {
  LocaleAdapter,
  SupportedLocale,
} from "@multica/core/i18n";

const STORAGE_KEY = "multica-locale";

export function createWailsLocaleAdapter(
  systemLocale: string,
): LocaleAdapter {
  return {
    getUserChoice() {
      try {
        return window.localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },
    getSystemPreferences() {
      return systemLocale ? [systemLocale] : [];
    },
    persist(locale: SupportedLocale) {
      try {
        window.localStorage.setItem(STORAGE_KEY, locale);
      } catch {
        // Locale persistence is best effort.
      }
    },
  };
}
