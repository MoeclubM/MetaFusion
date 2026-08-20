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
          <label className="block text-xs font-mono text-gray-300">MusicBrainz ID (MBID)</label>
          <input
            type="text"
            value={externalIds.musicbrainz || ""}
            onChange={(e) => updateExternalId("musicbrainz", e.target.value)}
            placeholder="如: a74627f5-99fb-4d52-a54d-a0e85e4b433e"
            className="w-full px-3.5 py-2 rounded-card bg-background border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-mono text-gray-300">Bangumi (番组计划) ID</label>
          <input
            type="text"
            value={externalIds.bangumi || ""}
            onChange={(e) => updateExternalId("bangumi", e.target.value)}
            placeholder="如: 1024"
            className="w-full px-3.5 py-2 rounded-card bg-background border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-mono text-gray-300">TMDB / IMDb ID</label>
          <input
            type="text"
            value={externalIds.imdb || ""}
            onChange={(e) => updateExternalId("imdb", e.target.value)}
            placeholder="如: tt0112159"
            className="w-full px-3.5 py-2 rounded-card bg-background border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-mono text-gray-300">VNDB (视觉小说) ID</label>
          <input
            type="text"
            value={externalIds.vndb || ""}
            onChange={(e) => updateExternalId("vndb", e.target.value)}
            placeholder="如: v17"
            className="w-full px-3.5 py-2 rounded-card bg-background border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>
    </div>
  );
}
