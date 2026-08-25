"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTheme } from "@/lib/themeContext";
import { useI18n } from "@/i18n/I18nProvider";
import {
 Sun,
 Moon,
 Laptop,
 Palette,
 Check,
} from "lucide-react";

export const ThemePicker: React.FC = () => {
 const { mode, accent, resolvedMode, setMode, setAccent, accents } = useTheme();
 const { t, locale } = useI18n();
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
 title={t("settings.appearanceTitle")}
 className="w-9 h-9 max-sm:min-h-[44px] grid place-items-center rounded-full bg-black/5 dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/[0.08] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 transition-colors"
 >
 {resolvedMode === "dark" ? (
 <Moon className="w-4 h-4 text-sky-400" strokeWidth={1.7} />
 ) : (
 <Sun className="w-4 h-4 text-amber-500" strokeWidth={1.7} />
 )}
 </button>

 {isOpen && (
 <div
 onClick={(e) => e.stopPropagation()}
 className="absolute right-0 mt-1.5 w-60 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface shadow-elevated p-4 z-50 animate-slide-up text-sm space-y-3"
 >
 {/* Header */}
 <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.06] pb-2 font-mono text-xs text-gray-500 dark:text-gray-400">
 <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
 <Palette className="w-4 h-4 text-primary" />
 <span>{t("settings.appearanceTitle")}</span>
 </span>
 <span>{t("theme.themeLabel")}</span>
 </div>

 {/* Mode Switch (Dark / Light / System) */}
 <div className="space-y-1">
 <div className="text-xs font-mono text-gray-500 dark:text-gray-400">{t("theme.displayMode")}</div>
 <div className="grid grid-cols-3 gap-0.5 bg-black/[0.04] dark:bg-white/[0.04] p-0.5 rounded-md border border-black/[0.06] dark:border-white/[0.06]">
 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 setMode("dark");
 }}
 className={`py-1 rounded-md flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
 mode === "dark"
 ? "bg-primary text-white keep-white shadow-xs font-semibold"
 : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
 }`}
 >
 <Moon className="w-4 h-4" />
 <span className="text-xs">{t("theme.dark")}</span>
 </button>

 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 setMode("light");
 }}
 className={`py-1 rounded-md flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
 mode === "light"
 ? "bg-primary text-white keep-white shadow-xs font-semibold"
 : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
 }`}
 >
 <Sun className="w-4 h-4" />
 <span className="text-xs">{t("theme.light")}</span>
 </button>

 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 setMode("system");
 }}
 className={`py-1 rounded-md flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
 mode === "system"
 ? "bg-primary text-white keep-white shadow-xs font-semibold"
 : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
 }`}
 >
 <Laptop className="w-4 h-4" />
 <span className="text-xs">{t("theme.system")}</span>
 </button>
 </div>
 </div>

 {/* Accent Color Selection */}
 <div className="space-y-1 border-t border-black/[0.06] dark:border-white/[0.06] pt-2">
 <div className="flex items-center justify-between text-xs font-mono text-gray-500 dark:text-gray-400">
 <span>{t("theme.accentLabel")}</span>
 <span className="font-semibold text-gray-900 dark:text-white text-xs">
 {(() => { const cur = accents.find((a) => a.id === accent); return locale === "en-US" ? (cur?.enName || cur?.name) : (cur?.name || cur?.enName); })()}
 </span>
 </div>
 <div className="flex items-center justify-between gap-2 pt-0.5">
 {accents.map((item) => {
 const isSelected = accent === item.id;
 return (
 <button
 key={item.id}
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 setAccent(item.id);
 }}
 title={locale === "en-US" ? item.enName : item.name}
 className="group relative flex flex-col items-center p-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
 >
 <div
 className={`w-5 h-5 rounded-full grid place-items-center shadow-2xs transition-transform group-hover:scale-105 ${
 isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-surface" : ""
 }`}
 style={{ backgroundColor: item.color }}
 >
 {isSelected && <Check className="w-4 h-4 text-white keep-white stroke-[2.5]" />}
 </div>
 </button>
 );
 })}
 </div>
 </div>
 </div>
 )}
 </div>
 );
};
