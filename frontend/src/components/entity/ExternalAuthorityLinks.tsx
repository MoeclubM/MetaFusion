"use client";

import React, { useEffect, useState } from "react";
import { ExternalLink, Globe, BookOpen, Music, Film, Tv, Gamepad2, Database } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchExternalDatabases, ExternalDatabaseDefinition, ExternalLinkDisplay } from "@/lib/api";

interface Props {
  externalIds?: Record<string, any>;
  externalLinks?: ExternalLinkDisplay[];
  category?: string; // "work" | "artist" | "release" | "franchise"
  className?: string;
  label?: string;
}

const ICON_MAP: Record<string, any> = {
  globe: Globe,
  book: BookOpen,
  music: Music,
  film: Film,
  tv: Tv,
  gamepad: Gamepad2,
  database: Database,
};

export function ExternalAuthorityLinks({ externalIds = {}, externalLinks, category, className = "", label }: Props) {
  const { t, locale } = useI18n();
  const [definitions, setDefinitions] = useState<ExternalDatabaseDefinition[]>([]);

  // 如果父级直接提供了组装好的 external_links，直接使用；否则基于 definitions 动态组装
  useEffect(() => {
    if (!externalLinks && externalIds && Object.keys(externalIds).length > 0) {
      fetchExternalDatabases(category)
        .then((res) => {
          if (res?.items) {
            setDefinitions(res.items);
          }
        })
        .catch(() => {});
    }
  }, [externalLinks, externalIds, category]);

  const displayLabel = label || t("entity.authority.label");

  // 1. 如果已有 backend 传回的 externalLinks
  if (externalLinks && externalLinks.length > 0) {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {displayLabel && <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500 mr-1">{displayLabel}:</span>}
        {externalLinks.map((item, idx) => {
          const IconComp = ICON_MAP[item.icon?.toLowerCase()] || Globe;
          return (
            <a
              key={idx}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${item.name} (${item.external_id})`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/[0.04] dark:bg-white/[0.06] hover:bg-sky-500/10 border border-black/10 dark:border-white/10 hover:border-sky-500/40 text-[11px] font-medium text-gray-700 dark:text-gray-200 hover:text-sky-600 dark:hover:text-sky-300 transition-all shadow-xs"
            >
              {item.icon_url ? (
                <img src={item.icon_url} alt="" className="w-3.5 h-3.5 object-contain" />
              ) : (
                <IconComp className="w-3.5 h-3.5 opacity-70 text-sky-500" />
              )}
              <span>{item.name}</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-40 ml-0.5" />
            </a>
          );
        })}
      </div>
    );
  }

  // 2. 否则从 externalIds + definitions 动态生成
  if (!externalIds || Object.keys(externalIds).length === 0) {
    return null;
  }

  const defMap = new Map<string, ExternalDatabaseDefinition>();
  for (const def of definitions) {
    defMap.set(def.code.toLowerCase(), def);
  }

  const entries: Array<{ code: string; name: string; url: string; icon: string; icon_url: string; id: string }> = [];

  for (const [key, rawVal] of Object.entries(externalIds)) {
    if (!rawVal) continue;
    const strVal = String(rawVal).trim();
    if (!strVal) continue;

    const def = defMap.get(key.toLowerCase());
    let name = def ? (locale === "zh-CN" ? def.name_zh : def.name_en) || def.name_zh || def.code : key.toUpperCase();
    let url = "";
    let icon = def?.icon || "Globe";
    let iconUrl = def?.icon_url || "";

    if (strVal.startsWith("http://") || strVal.startsWith("https://")) {
      url = strVal;
    } else if (def && def.url_pattern) {
      url = def.url_pattern.replace(/\{id\}/g, strVal);
    }

    if (url) {
      entries.push({ code: key, name, url, icon, icon_url: iconUrl, id: strVal });
    }
  }

  if (entries.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {displayLabel && <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500 mr-1">{displayLabel}:</span>}
      {entries.map((item, idx) => {
        const IconComp = ICON_MAP[item.icon?.toLowerCase()] || Globe;
        return (
          <a
            key={idx}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${item.name} (${item.id})`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/[0.04] dark:bg-white/[0.06] hover:bg-sky-500/10 border border-black/10 dark:border-white/10 hover:border-sky-500/40 text-[11px] font-medium text-gray-700 dark:text-gray-200 hover:text-sky-600 dark:hover:text-sky-300 transition-all shadow-xs"
          >
            {item.icon_url ? (
              <img src={item.icon_url} alt="" className="w-3.5 h-3.5 object-contain" />
            ) : (
              <IconComp className="w-3.5 h-3.5 opacity-70 text-sky-500" />
            )}
            <span>{item.name}</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-40 ml-0.5" />
          </a>
        );
      })}
    </div>
  );
}

