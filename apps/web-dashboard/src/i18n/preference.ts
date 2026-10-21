export type Locale = "zh-CN" | "en";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const LOCALE_KEY = "pkos.ui.locale";

export function readLocale(storage?: PreferenceStorage): Locale {
  try {
    const value = (storage ?? window.localStorage).getItem(LOCALE_KEY);
    return value === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

export function saveLocale(locale: Locale, storage?: PreferenceStorage): void {
  if (locale !== "zh-CN" && locale !== "en") return;
  try {
    // This is the only persistent UI preference; never store application data here.
    (storage ?? window.localStorage).setItem(LOCALE_KEY, locale);
  } catch {
    // Language switching still works when browser storage is disabled.
  }
}

