"use client";

import React from "react";
import { ExternalLink, Globe } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  externalIds?: Record<string, any>;
  className?: string;
  label?: string;
}

export function ExternalAuthorityLinks({ externalIds = {}, className = "", label }: Props) {
  const { t } = useI18n();

  if (!externalIds || Object.keys(externalIds).length === 0) {
    return null;
  }

  const displayLabel = label || t("entity.authority.label");

  const entries: Array<{ name: string; url: string; color: string }> = [];

  if (externalIds.musicbrainz) {
    entries.push({
      name: "MusicBrainz",
      url: `https://musicbrainz.org/artist/${externalIds.musicbrainz}`,
      color: "hover:border-amber-500/40 hover:bg-amber-500/10 text-amber-300",
    });
  }
  if (externalIds.bangumi) {
    entries.push({
      name: "Bangumi",
      url: `https://bgm.tv/subject/${externalIds.bangumi}`,
      color: "hover:border-rose-500/40 hover:bg-rose-500/10 text-rose-300",
    });
  }
  if (externalIds.imdb) {
    entries.push({
      name: "IMDb",
      url: `https://www.imdb.com/title/${externalIds.imdb}`,
      color: "hover:border-yellow-500/40 hover:bg-yellow-500/10 text-yellow-300",
    });
  }
  if (externalIds.tmdb) {
    entries.push({
      name: "TMDB",
      url: `https://www.themoviedb.org/movie/${externalIds.tmdb}`,
      color: "hover:border-sky-500/40 hover:bg-sky-500/10 text-sky-300",
    });
  }
  if (externalIds.vndb) {
    entries.push({
      name: "VNDB",
      url: `https://vndb.org/${externalIds.vndb}`,
      color: "hover:border-indigo-500/40 hover:bg-indigo-500/10 text-indigo-300",
    });
  }

  if (entries.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {displayLabel && <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500 mr-1">{displayLabel}:</span>}
      {entries.map((item, idx) => (
        <a
          key={idx}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-[11px] font-mono transition-all ${item.color}`}
        >
          <Globe className="w-3 h-3 opacity-60" />
          <span>{item.name}</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-40" />
        </a>
      ))}
    </div>
  );
}
