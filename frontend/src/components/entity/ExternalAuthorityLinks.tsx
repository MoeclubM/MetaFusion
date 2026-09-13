"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  ExternalLink,
  Globe,
  BookOpen,
  Music,
  Film,
  Tv,
  Gamepad2,
  Database,
  Disc,
  Disc3,
  Apple,
  Sparkles,
  Barcode,
  UserCheck,
  GraduationCap,
  AtSign,
  User,
  Smile,
  ArrowUpRight,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchExternalDatabases, ExternalDatabaseDefinition, ExternalLinkDisplay, pickLocalizedName } from "@/lib/api";

interface Props {
  entity?: {
    kind?: string;
    attributes?: Record<string, any>;
    external_ids?: Record<string, any>;
  };
  externalIds?: Record<string, any>;
  externalLinks?: ExternalLinkDisplay[];
  category?: string; // 实体 kind（"work" | "agent" | "release" | ...），用于按适用范围筛选预设
  className?: string;
  label?: string;
  variant?: "chips" | "list"; // chips: 小徽标水平流; list: 左侧大边栏列表
}

const ICON_MAP: Record<string, any> = {
  globe: Globe,
  book: BookOpen,
  bookopen: BookOpen,
  bookheart: BookOpen,
  music: Music,
  music2: Music,
  film: Film,
  clapperboard: Film,
  tv: Tv,
  tv2: Tv,
  gamepad: Gamepad2,
  gamepad2: Gamepad2,
  database: Database,
  disc: Disc,
  disc3: Disc3,
  apple: Apple,
  sparkles: Sparkles,
  barcode: Barcode,
  usercheck: UserCheck,
  graduationcap: GraduationCap,
  atsign: AtSign,
  user: User,
  smile: Smile,
};

export interface AuthorityLinkItem {
  code: string;
  name: string;
  url: string;
  id: string;
  icon: string;
  icon_url?: string;
  isOfficial?: boolean;
  isBangumi?: boolean;
  sortOrder: number;
}

export function ExternalAuthorityLinks({
  entity,
  externalIds: directExternalIds,
  externalLinks,
  category,
  className = "",
  label,
  variant = "chips",
}: Props) {
  const { t, locale } = useI18n();
  const [definitions, setDefinitions] = useState<ExternalDatabaseDefinition[]>([]);

  // 1. 获取动态配置库
  useEffect(() => {
    fetchExternalDatabases(category)
      .then((res) => {
        if (res?.items) {
          setDefinitions(res.items);
        }
      })
      .catch(() => {});
  }, [category]);

  const displayLabel = label || t("entity.authority.label");

  // 2. 合并外部标识：优先使用实体身上的属性与 external_ids
  const resolvedIds = useMemo(() => {
    const map: Record<string, any> = { ...(directExternalIds || {}) };
    if (entity) {
      if (entity.external_ids) {
        Object.assign(map, entity.external_ids);
      }
      // 官方链接如果作为 attribute 录入，也同级挂载
      const officialAttr =
        entity.attributes?.official_website ||
        entity.attributes?.website ||
        entity.attributes?.official_url ||
        entity.attributes?.url;
      if (officialAttr && !map.official_website && !map.official) {
        map.official_website = String(officialAttr);
      }
    }
    return map;
  }, [entity, directExternalIds]);

  // 3. 组装标准互联列表
  const linkItems = useMemo<AuthorityLinkItem[]>(() => {
    if (externalLinks && externalLinks.length > 0) {
      return externalLinks.map((item, idx) => ({
        code: item.code,
        name: item.name,
        url: item.url,
        id: item.external_id,
        icon: item.icon || "Globe",
        icon_url: item.icon_url,
        isOfficial: item.code.includes("official"),
        isBangumi: item.code.startsWith("bangumi"),
        sortOrder: idx,
      }));
    }

    if (!resolvedIds || Object.keys(resolvedIds).length === 0) {
      return [];
    }

    const defMap = new Map<string, ExternalDatabaseDefinition>();
    for (const def of definitions) {
      defMap.set(def.code.toLowerCase(), def);
    }

    const items: AuthorityLinkItem[] = [];
    const isAgent = entity?.kind === "agent";

    for (const [rawKey, rawVal] of Object.entries(resolvedIds)) {
      if (!rawVal) continue;
      const strVal = String(rawVal).trim();
      if (!strVal) continue;

      const key = rawKey.toLowerCase();
      // 过滤内部辅助键
      if (key === "metafusion_import") continue;

      // 别名归一化
      let lookupKey = key;
      if (key === "official" || key === "website") lookupKey = "official_website";
      if (key === "bushiroad") lookupKey = "bushiroad_music";

      const def = defMap.get(lookupKey);

      // 名称提取与多语言解析
      let name = "";
      if (def) {
        name = pickLocalizedName(locale, def.names, def.code);
      } else {
        if (lookupKey === "official_website") name = t("authority.officialWebsite");
        else if (lookupKey === "bushiroad_music") name = t("authority.bushiroad");
        else if (lookupKey === "bangumi") name = isAgent ? t("authority.bangumiPerson") : t("authority.bangumiSubject");
        else if (lookupKey === "bangumi_person") name = t("authority.bangumiPerson");
        else if (lookupKey === "bangumi_character") name = t("authority.bangumiCharacter");
        else if (lookupKey === "bangumi_ep") name = t("authority.bangumiEpisode");
        else name = key.toUpperCase();
      }

      // URL 解析
      let url = "";
      if (strVal.startsWith("http://") || strVal.startsWith("https://")) {
        url = strVal;
      } else if (def && def.url_pattern) {
        url = def.url_pattern.replace(/\{id\}/g, strVal);
      } else {
        // 内置兜底规则，防止未拉取到预设时的断链
        if (lookupKey === "official_website") url = strVal.startsWith("http") ? strVal : `https://${strVal}`;
        else if (lookupKey === "bushiroad_music") url = `https://bushiroad-music.com/musics/${strVal.toLowerCase()}/`;
        else if (lookupKey === "bangumi") url = isAgent ? `https://bangumi.tv/person/${strVal}` : `https://bangumi.tv/subject/${strVal}`;
        else if (lookupKey === "bangumi_person") url = `https://bangumi.tv/person/${strVal}`;
        else if (lookupKey === "bangumi_character") url = `https://bangumi.tv/character/${strVal}`;
        else if (lookupKey === "bangumi_ep") url = `https://bangumi.tv/ep/${strVal}`;
        else if (lookupKey === "musicbrainz") url = `https://musicbrainz.org/release/${strVal}`;
        else if (lookupKey === "vgmdb") url = `https://vgmdb.net/album/${strVal}`;
      }

      if (url) {
        const isOfficial = lookupKey === "official_website" || lookupKey === "bushiroad_music";
        const isBangumi = lookupKey.startsWith("bangumi");
        const defaultOrder = isOfficial ? 5 : isBangumi ? 10 : def?.sort_order ?? 100;

        items.push({
          code: lookupKey,
          name,
          url,
          id: strVal,
          icon: def?.icon || (isOfficial ? "Globe" : isBangumi ? "Tv" : "Globe"),
          icon_url: def?.icon_url || "",
          isOfficial,
          isBangumi,
          sortOrder: def ? def.sort_order : defaultOrder,
        });
      }
    }

    // 按权威度排序：官网最前，其次为 Bangumi，再按预设排序
    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [externalLinks, resolvedIds, definitions, entity, locale]);

  if (linkItems.length === 0) return null;

  // 样式 A: 竖直大列表（专为详情页左侧边栏设计，与基本信息卡片完美呼应）
  if (variant === "list") {
    return (
      <div className={`p-4 sm:p-5 rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface shadow-soft space-y-3 ${className}`}>
        <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-2.5">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" strokeWidth={1.5} />
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white font-mono">
              {displayLabel}
            </h3>
          </div>
          <span className="text-[10px] font-mono text-gray-400 bg-black/[0.04] dark:bg-white/[0.06] px-1.5 py-0.5 rounded">
            {linkItems.length}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {linkItems.map((item) => {
            const IconComp = ICON_MAP[item.icon?.toLowerCase()] || Globe;
            const isOfficial = item.isOfficial;
            const isBangumi = item.isBangumi;

            // 针对官方与 Bangumi 等高频数据源优化色彩，突出同级权威感
            let badgeClass =
              "bg-black/[0.04] dark:bg-white/[0.06] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-primary/40 hover:text-primary";
            if (isOfficial) {
              badgeClass =
                "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20";
            } else if (isBangumi) {
              badgeClass =
                "bg-[#f09199]/10 text-[#f09199] border-[#f09199]/25 hover:bg-[#f09199]/20";
            }

            return (
              <a
                key={item.code}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`${item.name}: ${item.id}`}
                className={`inline-flex items-center justify-between px-3 py-2 rounded-lg border transition-all text-xs font-medium group ${badgeClass}`}
              >
                <span className="flex items-center gap-2 truncate">
                  {item.icon_url ? (
                    <img src={item.icon_url} alt="" className="w-4 h-4 object-contain shrink-0" />
                  ) : (
                    <IconComp className={`w-4 h-4 shrink-0 ${isOfficial ? "text-emerald-500" : isBangumi ? "text-[#f09199]" : "opacity-70"}`} />
                  )}
                  <span className="font-sans truncate">{item.name}</span>
                </span>
                <span className="flex items-center gap-1 shrink-0 ml-2 font-mono text-[11px] opacity-75">
                  <span className="truncate max-w-[90px]">{item.id.replace(/^https?:\/\//, "")}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </span>
              </a>
            );
          })}
        </div>
      </div>
    );
  }

  // 样式 B: 水平徽标流（通用位置展示）
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {displayLabel && <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500 mr-1">{displayLabel}:</span>}
      {linkItems.map((item) => {
        const IconComp = ICON_MAP[item.icon?.toLowerCase()] || Globe;
        const isOfficial = item.isOfficial;
        const isBangumi = item.isBangumi;

        let badgeClass =
          "bg-black/[0.04] dark:bg-white/[0.06] hover:bg-sky-500/10 border-black/10 dark:border-white/10 hover:border-sky-500/40 text-gray-700 dark:text-gray-200 hover:text-sky-600 dark:hover:text-sky-300";
        if (isOfficial) {
          badgeClass =
            "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20";
        } else if (isBangumi) {
          badgeClass =
            "bg-[#f09199]/10 text-[#f09199] border-[#f09199]/25 hover:bg-[#f09199]/20";
        }

        return (
          <a
            key={item.code}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${item.name} (${item.id})`}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all shadow-2xs ${badgeClass}`}
          >
            {item.icon_url ? (
              <img src={item.icon_url} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />
            ) : (
              <IconComp className={`w-3.5 h-3.5 shrink-0 ${isOfficial ? "text-emerald-500" : isBangumi ? "text-[#f09199]" : "opacity-70"}`} />
            )}
            <span>{item.name}</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-40 ml-0.5" />
          </a>
        );
      })}
    </div>
  );
}