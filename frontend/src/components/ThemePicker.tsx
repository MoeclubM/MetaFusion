"use client";

// 顶栏的主题按钮：点击展开配色面板（模式 / 配色方案 / 表面色调）。
// 控件本体在 ThemeControls，设置页复用同一份，新增配色只改一处。

import React, { useState, useRef, useEffect } from "react";
import { useTheme } from "@/lib/themeContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Sun, Moon, Palette } from "lucide-react";
import { ThemeControls } from "@/components/ThemeControls";

export const ThemePicker: React.FC = () => {
  const { resolvedMode } = useTheme();
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={t("settings.appearanceTitle")}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="mf-focus w-9 h-9 max-sm:min-h-[44px] grid place-items-center rounded-full bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body transition-colors duration-fast ease-soft cursor-pointer"
      >
        {resolvedMode === "dark" ? (
          <Moon className="w-4 h-4 text-primary" strokeWidth={1.7} />
        ) : (
          <Sun className="w-4 h-4 text-primary" strokeWidth={1.7} />
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label={t("settings.appearanceTitle")}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 mt-1.5 w-[19rem] rounded-panel border border-line bg-surface shadow-elevated p-4 z-50 animate-scale-in space-y-3"
        >
          <div className="flex items-center justify-between border-b border-line-subtle pb-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-text-strong">
              <Palette className="w-4 h-4 text-primary" />
              <span>{t("settings.appearanceTitle")}</span>
            </span>
            <span className="font-mono text-[10px] text-text-faint">{t("theme.themeLabel")}</span>
          </div>
          <ThemeControls layout="compact" />
        </div>
      )}
    </div>
  );
};
