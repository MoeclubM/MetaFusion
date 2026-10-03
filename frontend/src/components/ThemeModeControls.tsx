"use client";

import React from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/lib/themeContext";
import { useI18n } from "@/i18n/I18nProvider";

const MODES = [
  { id: "system", labelKey: "theme.system", Icon: Laptop },
  { id: "light", labelKey: "theme.light", Icon: Sun },
  { id: "dark", labelKey: "theme.dark", Icon: Moon },
] satisfies { id: ThemeMode; labelKey: string; Icon: React.ElementType }[];

export function ThemeModeControls({ onChange }: { onChange?: () => void }) {
  const { mode, setMode } = useTheme();
  const { t } = useI18n();
  return <div role="group" aria-label={t("theme.displayMode")} className="grid min-w-0 grid-cols-3 gap-1 rounded-control border border-line-subtle bg-surfaceSubtle p-1">
    {MODES.map(({ id, labelKey, Icon }) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => { setMode(id); onChange?.(); }} className={`mf-focus flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-control px-1 py-2 text-[11px] transition-colors duration-fast ease-soft ${mode === id ? "bg-primary text-primary-foreground font-semibold" : "text-text-muted hover:bg-surfaceHover hover:text-text-strong"}`}>
      <Icon className="h-4 w-4" aria-hidden="true" /><span className="break-words">{t(labelKey)}</span>
    </button>)}
  </div>;
}
