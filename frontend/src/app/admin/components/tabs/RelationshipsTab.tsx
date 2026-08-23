"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { Waypoints, Sparkles } from "lucide-react";

export function RelationshipsTab() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2">
        <Waypoints className="w-4 h-4 text-primary" />
        {t("admin.relationships.title")}
      </h2>
      <p className="text-xs text-gray-400">{t("admin.relationships.subtitle")}</p>
      <div className="p-8 rounded-xl border border-surfaceBorder bg-surface text-center space-y-2">
        <div className="flex items-center justify-center gap-2 text-xs text-gray-300 font-medium">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>{t("admin.relationships.title")}</span>
        </div>
        <p className="text-xs text-gray-400 font-mono max-w-xl mx-auto">
          {t("admin.relationships.desc")}
        </p>
      </div>
    </div>
  );
}
