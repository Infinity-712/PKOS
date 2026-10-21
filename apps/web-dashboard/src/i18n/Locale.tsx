import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { labels, messages } from "./copy.js";
import { readLocale, saveLocale, type Locale } from "./preference.js";

function translations(locale: Locale) {
  const index = locale === "en" ? 1 : 0;
  return {
    t: (zh: string, en: string) => locale === "en" ? en : zh,
    label: (value: string) => labels[value]?.[index] ?? value,
    message: (value: string) => messages[value]?.[index] ?? value,
  };
}

const LocaleContext = createContext({
  locale: "zh-CN" as Locale,
  setLocale: (_locale: Locale) => {},
  ...translations("zh-CN"),
});

export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, updateLocale] = useState<Locale>(() => initialLocale ?? readLocale());
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo(() => ({
    locale,
    setLocale: (next: Locale) => { updateLocale(next); saveLocale(next); },
    ...translations(locale),
  }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() { return useContext(LocaleContext); }

export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="language-switch" role="group" aria-label={t("界面语言", "Interface language")}>
      <button type="button" lang="zh-CN" aria-pressed={locale === "zh-CN"} onClick={() => setLocale("zh-CN")}>中文</button>
      <button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
    </div>
  );
}

