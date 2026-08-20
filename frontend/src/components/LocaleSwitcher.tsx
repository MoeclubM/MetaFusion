"use client";

import React, { useState, useRef, useEffect } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Languages, Check } from "lucide-react";
import type { Locale } from "@/i18n/routing";

export const LOCALES: { id: Locale; name: string; nativeName: string }[] = [
  { id: "zh-CN", name: "简体中文", nativeName: "简体中文" },
  { id: "en-US", name: "English", nativeName: "English (US)" },
];

export function LocaleSwitcher({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={t("locale.switchTitle")}
        className={
          compact
            ? "w-8 h-8 grid place-items-center rounded-full bg-black/5 dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/[0.08] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 transition-colors"
            : "inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-black/5 dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/[0.08] border border-black/10 dark:border-white/10 text-xs font-mono text-gray-700 dark:text-gray-300 transition-colors"
        }
      >
        <Languages className="w-3.5 h-3.5" strokeWidth={1.6} />
        {!compact && <span>{locale === "zh-CN" ? t("locale.chinese") : t("locale.englishLabel")}</span>}
      </button>

      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 mt-2 w-48 rounded-card border border-black/10 dark:border-white/10 bg-surface shadow-elevated p-1.5 z-50 animate-slide-up text-xs"
        >
          <div className="px-2.5 py-2 font-mono text-[10px] tracking-[0.14em] text-gray-500 dark:text-gray-400 border-b border-black/[0.06] dark:border-white/[0.06] mb-1">
            {t("locale.languageChoice")}
          </div>
          <div className="space-y-0.5">
            {LOCALES.map((l) => {
              const active = locale === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocale(l.id);
                    setIsOpen(false);
                  }}
                  className={`w-full px-2.5 py-2.5 rounded-lg flex items-center justify-between transition-colors cursor-pointer ${
                    active
                      ? "bg-primary text-white keep-white font-semibold shadow-soft"
                      : "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="text-[13px]">{l.nativeName}</span>
                  {active && <Check className="w-3.5 h-3.5 text-white keep-white stroke-[2.2]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
