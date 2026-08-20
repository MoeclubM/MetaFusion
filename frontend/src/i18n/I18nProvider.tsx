"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { defaultLocale, localeCookieName, normalizeLocale, type Locale } from "./routing";
import { getMessages, translate } from "./getMessages";

type Ctx = {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (next: Locale) => void;
};

const I18nContext = createContext<Ctx>({
  locale: defaultLocale,
  t: (k) => k,
  setLocale: () => {},
});

function readCookieLocale(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${localeCookieName}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

function writeCookieLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.cookie = `${localeCookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: string | null;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => normalizeLocale(initialLocale || readCookieLocale()));

  useEffect(() => {
    const c = readCookieLocale();
    if (c) {
      const n = normalizeLocale(c);
      if (n !== locale) setLocaleState(n);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const messages = useMemo(() => getMessages(locale), [locale]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(messages, key, vars),
    [messages]
  );

  const setLocale = useCallback((next: Locale) => {
    const n = normalizeLocale(next);
    setLocaleState(n);
    writeCookieLocale(n);
  }, []);

  const value = useMemo<Ctx>(() => ({ locale, t, setLocale }), [locale, t, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useLocale() {
  return useContext(I18nContext).locale;
}

export function useTranslations() {
  return useContext(I18nContext).t;
}
