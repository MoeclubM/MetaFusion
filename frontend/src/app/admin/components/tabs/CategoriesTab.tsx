"use client";

import { useI18n } from "@/i18n/I18nProvider";

import { Waypoints } from "lucide-react";

export function CategoriesTab() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2">
        <Waypoints className="w-4 h-4 text-amber-400" />
        {t("admin.categories.title")}
      </h2>
      <p className="text-xs text-gray-400">{t("admin.categories.subtitle")}</p>
      <div className="p-8 rounded-xl border border-surfaceBorder bg-surface text-center text-xs text-gray-400 font-mono">
        {t("admin.categories.desc")}
      </div>
    </div>
  );
}
