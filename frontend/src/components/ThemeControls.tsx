"use client";

// 主题选择控件：模式（深/浅/跟随系统）× 配色方案（16 套）× 表面色调（4 种）。
// 弹出选择器与设置页共用这一份，避免两处实现逐渐漂移。

import React from "react";
import { Moon, Sun, Laptop, Check } from "lucide-react";
import { useTheme, accentLabel, toneLabel } from "@/lib/themeContext";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  /** compact：弹出层里用（窄、两行配色）；full：设置页里用（铺开、带名称）。 */
  layout?: "compact" | "full";
}

export const ThemeControls: React.FC<Props> = ({ layout = "full" }) => {
  const { mode, accent, tone, setMode, setAccent, setTone, accents, tones } = useTheme();
  const { t } = useI18n();

  const modeButton = (id: "dark" | "light" | "system", Icon: React.ElementType, labelKey: string) => {
    const active = mode === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setMode(id)}
        aria-pressed={active}
        className={`mf-focus py-1.5 rounded-control flex flex-col items-center gap-0.5 transition-colors duration-fast ease-soft cursor-pointer ${
          active
            ? "bg-primary text-[color:var(--primary-contrast-color)] font-semibold shadow-xs"
            : "text-text-muted hover:text-text-strong hover:bg-surfaceSubtle"
        }`}
      >
        <Icon className="w-4 h-4" />
        <span className="text-[11px]">{t(labelKey)}</span>
      </button>
    );
  };

  return (
    <div className={layout === "compact" ? "space-y-3" : "space-y-4"}>
      {/* 显示模式 */}
      <div className="space-y-1.5">
        <div className="font-mono text-[11px] text-text-muted">{t("theme.displayMode")}</div>
        <div className="grid grid-cols-3 gap-1 bg-surfaceSubtle p-1 rounded-control border border-line-subtle">
          {modeButton("dark", Moon, "theme.dark")}
          {modeButton("light", Sun, "theme.light")}
          {modeButton("system", Laptop, "theme.system")}
        </div>
      </div>

      {/* 配色方案 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between font-mono text-[11px] text-text-muted">
          <span>{t("theme.accentLabel")}</span>
          <span className="font-semibold text-text-strong">{accentLabel(accent, t)}</span>
        </div>
        <div className={`grid gap-1 ${layout === "compact" ? "grid-cols-8" : "grid-cols-8 sm:grid-cols-16"}`}>
          {accents.map((item) => {
            const active = accent === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAccent(item.id)}
                title={t(item.labelKey)}
                aria-label={t(item.labelKey)}
                aria-pressed={active}
                className={`mf-focus group relative aspect-square rounded-chip grid place-items-center border transition-colors duration-fast ease-soft cursor-pointer ${
                  active ? "border-primary/60 ring-1 ring-primary/40" : "border-line-subtle hover:border-line"
                }`}
              >
                <span className="w-4 h-4 rounded-full shadow-2xs" style={{ backgroundColor: item.swatch }} />
                {active && <Check className="absolute -bottom-0.5 -right-0.5 w-3 h-3 p-[1px] rounded-full bg-primary text-[color:var(--primary-contrast-color)] stroke-[3]" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 表面色调 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between font-mono text-[11px] text-text-muted">
          <span>{t("theme.toneLabel")}</span>
          <span className="font-semibold text-text-strong">{toneLabel(tone, t)}</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {tones.map((item) => {
            const active = tone === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTone(item.id)}
                aria-pressed={active}
                className={`mf-focus py-1.5 rounded-control text-[11px] border transition-colors duration-fast ease-soft cursor-pointer ${
                  active
                    ? "bg-primary/10 border-primary/50 text-text-strong font-semibold"
                    : "bg-surfaceSubtle border-line-subtle text-text-muted hover:text-text-strong"
                }`}
              >
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
