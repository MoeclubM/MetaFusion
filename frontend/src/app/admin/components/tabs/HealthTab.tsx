"use client";

import { useI18n } from "@/i18n/I18nProvider";

import { Activity, Database, HardDrive, Sparkles } from "lucide-react";

export function HealthTab() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          {t("admin.health.title")}
        </h2>
        <p className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.health.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-surface border border-surfaceBorder space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{t("admin.health.db")}</span>
            <Database className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-emerald-400 font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            HEALTHY
          </div>
          <div className="text-[11px] text-gray-400 font-mono">{t("admin.health.dbDesc")}</div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-surfaceBorder space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{t("admin.health.s3")}</span>
            <HardDrive className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-lg font-bold text-sky-400 font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            CONNECTED
          </div>
          <div className="text-[11px] text-gray-400 font-mono">{t("admin.health.s3Desc")}</div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-surfaceBorder space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{t("admin.health.pipeline")}</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-lg font-bold text-purple-400 font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            READY
          </div>
          <div className="text-[11px] text-gray-400 font-mono">{t("admin.health.pipelineDesc")}</div>
        </div>
      </div>
    </div>
  );
}
