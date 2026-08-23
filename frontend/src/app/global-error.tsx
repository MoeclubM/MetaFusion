"use client";

import React, { useMemo } from "react";
import { defaultLocale, localeCookieName, normalizeLocale } from "@/i18n/routing";
import { getMessages, translate } from "@/i18n/getMessages";

function readCookieLocale(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${localeCookieName}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useMemo(() => normalizeLocale(readCookieLocale()), []);
  const messages = useMemo(() => getMessages(locale), [locale]);
  const t = (key: string, vars?: Record<string, string | number>) => translate(messages, key, vars);

  return (
    <html lang={locale} className="dark">
      <body className="font-sans min-h-screen bg-[#0a0c10] text-gray-100 flex flex-col items-center justify-center p-6 antialiased">
        <div className="max-w-md w-full text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center text-2xl font-bold mb-6">
            !
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {t("globalError.title")}
          </h1>
          <p className="text-sm text-gray-400 mb-6">
            {t("globalError.desc")}
          </p>
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            {t("globalError.reload")}
          </button>
        </div>
      </body>
    </html>
  );
}
