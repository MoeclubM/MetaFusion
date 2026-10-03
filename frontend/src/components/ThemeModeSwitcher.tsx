"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/themeContext";
import { useI18n } from "@/i18n/I18nProvider";
import { ThemeModeControls } from "./ThemeModeControls";
import { ThemePopover } from "./ThemePopover";

export function ThemeModeSwitcher({ withinDialog = false }: { withinDialog?: boolean }) {
  const { mode } = useTheme();
  const { t } = useI18n();
  const Icon = mode === "system" ? Laptop : mode === "light" ? Sun : Moon;
  return <ThemePopover label={t("theme.displayMode")} title={t("theme.modeControl", { mode: t(`theme.${mode}`) })} icon={<Icon className="h-4 w-4 text-primary" aria-hidden="true" />} withinDialog={withinDialog}>
    {(close) => <ThemeModeControls onChange={close} />}
  </ThemePopover>;
}
