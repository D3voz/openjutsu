"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LANGUAGE_KEY, preferredLocale, translate, type Locale, type Values } from "../lib/i18n.ts";

const LanguageContext = createContext({
  locale: "en" as Locale,
  setLocale: (_locale: Locale) => {},
  t: (message: string, values?: Values) => translate("en", message, values),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LANGUAGE_KEY); } catch {}
    setLocale(preferredLocale(saved, navigator.languages));
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const chooseLocale = useCallback((value: Locale) => {
    setLocale(value);
    try { localStorage.setItem(LANGUAGE_KEY, value); } catch {}
  }, []);
  const t = useCallback((message: string, values?: Values) => translate(locale, message, values), [locale]);
  return <LanguageContext.Provider value={{ locale, setLocale: chooseLocale, t }}>{children}</LanguageContext.Provider>;
}

export function useLocale() { return useContext(LanguageContext).locale; }

export function useT() { return useContext(LanguageContext).t; }

export function LanguageSwitch() {
  const { locale, setLocale } = useContext(LanguageContext);
  return <label className="language-switch">
    <span>语言 / Language</span>
    <select aria-label="语言 / Language" value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
      <option value="en" lang="en">English</option>
      <option value="zh-CN" lang="zh-CN">简体中文</option>
    </select>
  </label>;
}
