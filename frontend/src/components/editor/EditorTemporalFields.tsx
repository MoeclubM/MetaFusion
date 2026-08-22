"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  formData: Record<string, any>;
  updateField: (key: string, val: any) => void;
  targetType: "work" | "artist" | "release" | "franchise";
}

export function EditorTemporalFields({ formData, updateField, targetType }: Props) {
  const { t } = useI18n();

  return (
    <div className="space-y-5">
      <div className="p-3.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs text-sky-800 dark:text-sky-200 leading-relaxed">
        {t("editor.temporal.tip")}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-mono text-gray-600 dark:text-gray-300">
            {targetType === "artist" ? t("editor.temporal.beginArtist") : t("editor.temporal.beginWork")}
          </label>
          <input
            type="text"
            value={formData.begin_date || ""}
            onChange={(e) => updateField("begin_date", e.target.value)}
            placeholder={t("editor.temporal.beginPlaceholder")}
            className="w-full px-3.5 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-mono text-gray-600 dark:text-gray-300">
            {targetType === "artist" ? t("editor.temporal.endArtist") : t("editor.temporal.endWork")}
          </label>
          <input
            type="text"
            value={formData.end_date || ""}
            onChange={(e) => updateField("end_date", e.target.value)}
            placeholder={t("editor.temporal.endPlaceholder")}
            className="w-full px-3.5 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div className="flex items-center gap-2 md:col-span-2 pt-2">
          <input
            type="checkbox"
            id="editor_entity_ended"
            checked={formData.ended || false}
            onChange={(e) => updateField("ended", e.target.checked)}
            className="w-4 h-4 rounded bg-background border-black/10 dark:border-white/10 text-primary focus:ring-0 cursor-pointer"
          />
          <label htmlFor="editor_entity_ended" className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 font-mono cursor-pointer">
            {t("editor.temporal.endedFlag")}
          </label>
        </div>
      </div>
    </div>
  );
}
