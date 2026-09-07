"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light" | "system";
export type ThemeAccent = "blue" | "emerald" | "amber" | "violet" | "rose" | "monochrome";

export interface AccentOption {
  id: ThemeAccent;
  /** 主题强调色名的 i18n 键（theme.accent.<id>），展示层经 t() 解析，不再维护 name/enName 双列。 */
  labelKey: string;
  color: string;
}

export const ACCENTS: AccentOption[] = [
  { id: "blue", labelKey: "theme.accent.blue", color: "#3b82f6" },
  { id: "emerald", labelKey: "theme.accent.emerald", color: "#10b981" },
  { id: "amber", labelKey: "theme.accent.amber", color: "#f59e0b" },
  { id: "violet", labelKey: "theme.accent.violet", color: "#8b5cf6" },
  { id: "rose", labelKey: "theme.accent.rose", color: "#f43f5e" },
  { id: "monochrome", labelKey: "theme.accent.monochrome", color: "#71717a" },
];

/** 主题强调色展示名：以 i18n 键为权威来源。 */
export function accentLabel(id: ThemeAccent, t: (key: string) => string): string {
  const found = ACCENTS.find((a) => a.id === id);
  if (!found) return id;
  const v = t(found.labelKey);
  return v && v !== found.labelKey ? v : id;
}

interface ThemeContextType {
  mode: ThemeMode;
  accent: ThemeAccent;
  resolvedMode: "dark" | "light";
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  accents: AccentOption[];
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "dark",
  accent: "blue",
  resolvedMode: "dark",
  setMode: () => {},
  setAccent: () => {},
  accents: ACCENTS,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [accent, setAccentState] = useState<ThemeAccent>("blue");
  const [resolvedMode, setResolvedMode] = useState<"dark" | "light">("dark");

  const applyTheme = (currentMode: ThemeMode, currentAccent: ThemeAccent) => {
    const effectiveMode: "dark" | "light" =
      currentMode === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : currentMode;
    setResolvedMode(effectiveMode);

    const root = document.documentElement;
    root.setAttribute("data-theme-mode", effectiveMode);
    root.setAttribute("data-theme-accent", currentAccent);

    if (effectiveMode === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
  };

  useEffect(() => {
    const savedMode = (localStorage.getItem("metafusion_theme_mode") as ThemeMode) || "dark";
    const savedAccent = (localStorage.getItem("metafusion_theme_accent") as ThemeAccent) || "blue";

    setModeState(savedMode);
    setAccentState(savedAccent);
    applyTheme(savedMode, savedAccent);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const currentMode = (localStorage.getItem("metafusion_theme_mode") as ThemeMode) || "dark";
      if (currentMode === "system") {
        applyTheme("system", (localStorage.getItem("metafusion_theme_accent") as ThemeAccent) || "blue");
      }
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    localStorage.setItem("metafusion_theme_mode", nextMode);
    applyTheme(nextMode, accent);
  };

  const setAccent = (nextAccent: ThemeAccent) => {
    setAccentState(nextAccent);
    localStorage.setItem("metafusion_theme_accent", nextAccent);
    applyTheme(mode, nextAccent);
  };

  return (
    <ThemeContext.Provider
      value={{
        mode,
        accent,
        resolvedMode,
        setMode,
        setAccent,
        accents: ACCENTS,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
