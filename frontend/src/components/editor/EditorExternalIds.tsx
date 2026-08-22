"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  externalIds: Record<string, any>;
  updateExternalId: (key: string, val: string) => void;
}

export function EditorExternalIds({ externalIds = {}, updateExternalId }: Props) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        {t("editor.external.tip")}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-mono text-gray-600 dark:text-gray-300">{t("editor.external.mbidLabel")}</label>
          <input
            type="text"
            value={externalIds.musicbrainz || ""}
            onChange={(e) => updateExternalId("musicbrainz", e.target.value)}
            placeholder={t("editor.external.mbidPlaceholder")}
            className="w-full px-3.5 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-mono text-gray-600 dark:text-gray-300">{t("editor.external.bangumiLabel")}</label>
          <input
            type="text"
            value={externalIds.bangumi || ""}
            onChange={(e) => updateExternalId("bangumi", e.target.value)}
            placeholder={t("editor.external.bangumiPlaceholder")}
            className="w-full px-3.5 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-mono text-gray-600 dark:text-gray-300">{t("editor.external.imdbLabel")}</label>
          <input
            type="text"
            value={externalIds.imdb || ""}
            onChange={(e) => updateExternalId("imdb", e.target.value)}
            placeholder={t("editor.external.imdbPlaceholder")}
            className="w-full px-3.5 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-mono text-gray-600 dark:text-gray-300">{t("editor.external.vndbLabel")}</label>
          <input
            type="text"
            value={externalIds.vndb || ""}
            onChange={(e) => updateExternalId("vndb", e.target.value)}
            placeholder={t("editor.external.vndbPlaceholder")}
            className="w-full px-3.5 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:border-primary"
          />
        </div>
      </div>
    </div>
  );
}
