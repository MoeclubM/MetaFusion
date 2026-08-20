"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light" | "system";
export type ThemeAccent = "blue" | "emerald" | "amber" | "violet" | "rose" | "monochrome";

export interface AccentOption {
  id: ThemeAccent;
  name: string;
  enName: string;
  color: string;
}

export const ACCENTS: AccentOption[] = [
  { id: "blue", name: "经典蓝", enName: "Ocean Blue", color: "#3b82f6" },
  { id: "emerald", name: "翡翠绿", enName: "Emerald", color: "#10b981" },
  { id: "amber", name: "琥珀金", enName: "Amber Gold", color: "#f59e0b" },
  { id: "violet", name: "极光紫", enName: "Aurora Violet", color: "#8b5cf6" },
  { id: "rose", name: "珊瑚红", enName: "Coral Rose", color: "#f43f5e" },
  { id: "monochrome", name: "极简黑白", enName: "Monochrome", color: "#71717a" },
];

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
    let effectiveMode: "dark" | "light" = "dark";
    if (currentMode === "system") {
      effectiveMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      effectiveMode = currentMode;
    }
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
