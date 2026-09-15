"use client";

// 主题系统：三组正交选择 —— 显示模式（深/浅/跟随系统）× 配色方案（16 套主色）× 表面色调（4 种中性底）。
//
// 颜色不在这里计算：配色目录由 scripts/gen-theme.mjs 从 scripts/theme-palette.mjs 生成，
// CSS 变量块是静态的，因此首帧不会闪错色，也不需要把色板塞进运行时。
// 这里只负责把三个属性写到 <html> 上并持久化。

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  ACCENTS,
  TONES,
  ACCENT_IDS,
  TONE_IDS,
  DEFAULT_ACCENT,
  DEFAULT_TONE,
  type AccentEntry,
  type ThemeAccent,
  type ThemeTone,
  type ToneEntry,
} from "@/lib/theme.generated";

export type ThemeMode = "dark" | "light" | "system";
export type { ThemeAccent, ThemeTone, AccentEntry, ToneEntry };

export const MODE_STORAGE_KEY = "metafusion_theme_mode";
export const ACCENT_STORAGE_KEY = "metafusion_theme_accent";
export const TONE_STORAGE_KEY = "metafusion_theme_tone";

/** 配色方案的展示名：以 i18n 键为权威来源，缺键时回落到 id。 */
export function accentLabel(id: ThemeAccent, t: (key: string) => string): string {
  const found = ACCENTS.find((a) => a.id === id);
  if (!found) return id;
  const v = t(found.labelKey);
  return v && v !== found.labelKey ? v : id;
}

/** 表面色调的展示名，同上。 */
export function toneLabel(id: ThemeTone, t: (key: string) => string): string {
  const found = TONES.find((x) => x.id === id);
  if (!found) return id;
  const v = t(found.labelKey);
  return v && v !== found.labelKey ? v : id;
}

interface ThemeContextType {
  mode: ThemeMode;
  accent: ThemeAccent;
  tone: ThemeTone;
  resolvedMode: "dark" | "light";
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  setTone: (tone: ThemeTone) => void;
  accents: AccentEntry[];
  tones: ToneEntry[];
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "dark",
  accent: DEFAULT_ACCENT,
  tone: DEFAULT_TONE,
  resolvedMode: "dark",
  setMode: () => {},
  setAccent: () => {},
  setTone: () => {},
  accents: ACCENTS,
  tones: TONES,
});

const isAccent = (v: string | null): v is ThemeAccent => !!v && (ACCENT_IDS as string[]).includes(v);
const isTone = (v: string | null): v is ThemeTone => !!v && (TONE_IDS as string[]).includes(v);

/** 把三组选择写到 <html> 上；同时同步浏览器地址栏/移动端状态栏配色。 */
function applyTheme(mode: ThemeMode, accent: ThemeAccent, tone: ThemeTone): "dark" | "light" {
  const effectiveMode: "dark" | "light" =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;

  const root = document.documentElement;
  root.setAttribute("data-theme-mode", effectiveMode);
  root.setAttribute("data-theme-accent", accent);
  root.setAttribute("data-theme-tone", tone);
  root.classList.toggle("dark", effectiveMode === "dark");
  root.classList.toggle("light", effectiveMode === "light");
  root.style.colorScheme = effectiveMode;

  // 移动端地址栏/状态栏跟随底色，避免深色站点配白色状态栏。
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(root).getPropertyValue("--bg-color").trim();
  if (meta && bg) meta.setAttribute("content", bg);

  return effectiveMode;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [accent, setAccentState] = useState<ThemeAccent>(DEFAULT_ACCENT);
  const [tone, setToneState] = useState<ThemeTone>(DEFAULT_TONE);
  const [resolvedMode, setResolvedMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const savedMode = (localStorage.getItem(MODE_STORAGE_KEY) as ThemeMode) || "dark";
    const savedAccentRaw = localStorage.getItem(ACCENT_STORAGE_KEY);
    const savedToneRaw = localStorage.getItem(TONE_STORAGE_KEY);
    const savedAccent = isAccent(savedAccentRaw) ? savedAccentRaw : DEFAULT_ACCENT;
    const savedTone = isTone(savedToneRaw) ? savedToneRaw : DEFAULT_TONE;

    setModeState(savedMode);
    setAccentState(savedAccent);
    setToneState(savedTone);
    setResolvedMode(applyTheme(savedMode, savedAccent, savedTone));

    // 跟随系统时，系统主题变化要即时生效；换配色/色调不需要重挂监听。
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const currentMode = (localStorage.getItem(MODE_STORAGE_KEY) as ThemeMode) || "dark";
      if (currentMode !== "system") return;
      const a = localStorage.getItem(ACCENT_STORAGE_KEY);
      const tn = localStorage.getItem(TONE_STORAGE_KEY);
      setResolvedMode(applyTheme("system", isAccent(a) ? a : DEFAULT_ACCENT, isTone(tn) ? tn : DEFAULT_TONE));
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  const setMode = useCallback(
    (nextMode: ThemeMode) => {
      setModeState(nextMode);
      localStorage.setItem(MODE_STORAGE_KEY, nextMode);
      const a = localStorage.getItem(ACCENT_STORAGE_KEY);
      const tn = localStorage.getItem(TONE_STORAGE_KEY);
      setResolvedMode(applyTheme(nextMode, isAccent(a) ? a : DEFAULT_ACCENT, isTone(tn) ? tn : DEFAULT_TONE));
    },
    [],
  );

  const setAccent = useCallback((nextAccent: ThemeAccent) => {
    setAccentState(nextAccent);
    localStorage.setItem(ACCENT_STORAGE_KEY, nextAccent);
    const m = (localStorage.getItem(MODE_STORAGE_KEY) as ThemeMode) || "dark";
    const tn = localStorage.getItem(TONE_STORAGE_KEY);
    setResolvedMode(applyTheme(m, nextAccent, isTone(tn) ? tn : DEFAULT_TONE));
  }, []);

  const setTone = useCallback((nextTone: ThemeTone) => {
    setToneState(nextTone);
    localStorage.setItem(TONE_STORAGE_KEY, nextTone);
    const m = (localStorage.getItem(MODE_STORAGE_KEY) as ThemeMode) || "dark";
    const a = localStorage.getItem(ACCENT_STORAGE_KEY);
    setResolvedMode(applyTheme(m, isAccent(a) ? a : DEFAULT_ACCENT, nextTone));
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, accent, tone, resolvedMode, setMode, setAccent, setTone, accents: ACCENTS, tones: TONES }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
