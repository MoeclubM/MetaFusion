"use client";

import React, { useState } from "react";
import Link from "next/link";
import { User, Users, ChevronDown, ChevronUp, Mic, Sparkles } from "lucide-react";
import { WorkArtistRelation } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

interface StaffCharacterSectionProps {
  relations: WorkArtistRelation[];
  roleLabel: (role: string) => string;
}

export function StaffCharacterSection({ relations, roleLabel }: StaffCharacterSectionProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"key" | "characters" | "staff">("key");

  if (!relations || relations.length === 0) return null;

  // 区分核心主创 (Key Staff)、角色与声优 (Characters / Cast)、全部制作团队 (All Staff)
  const isKeyRole = (role: string) => {
    const r = role.toLowerCase();
    return (
      r.includes("author") ||
      r.includes("director") ||
      r.includes("composer") ||
      r.includes("illustrator") ||
      r.includes("studio") ||
      r.includes("writer") ||
      r.includes("screenplay") ||
      r.includes("publisher") ||
      r.includes("原作") ||
      r.includes("监督") ||
      r.includes("导演") ||
      r.includes("音乐") ||
      r.includes("系列构成") ||
      r.includes("动画制作")
    );
  };

  const isCastRole = (role: string) => {
    const r = role.toLowerCase();
    return r.includes("voice actor") || r.includes("character") || r.includes("声优") || r.includes("配音") || r.includes("角色");
  };

  const keyStaff = relations.filter((r) => isKeyRole(r.role) && !isCastRole(r.role));
  const castList = relations.filter((r) => isCastRole(r.role));
  const otherStaff = relations.filter((r) => !isKeyRole(r.role) && !isCastRole(r.role));

  // 紧凑核心创作者徽章（未展开时展示在详情页头部）
  const displayedKey = keyStaff.length > 0 ? keyStaff.slice(0, 8) : relations.slice(0, 8);

  return (
    <div className="space-y-3 pt-1">
      {/* 紧凑关键演职员徽章流 */}
      <div className="flex flex-wrap gap-2 items-center">
        {displayedKey.map((rel) => (
          <Link
            key={rel.id}
            href={`/artists/${rel.artist_id}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 hover:border-primary/40 text-xs text-gray-700 dark:text-gray-200 transition-colors"
          >
            {isCastRole(rel.role) ? (
              <Mic className="w-3.5 h-3.5 text-sky-500 shrink-0" strokeWidth={1.5} />
            ) : (
              <User className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={1.5} />
            )}
            <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{roleLabel(rel.role)}:</span>
            <span className="font-medium underline decoration-dotted underline-offset-2">{rel.artist?.name}</span>
          </Link>
        ))}

        {relations.length > 8 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 text-xs font-mono transition-all cursor-pointer"
          >
            <Users className="w-3.5 h-3.5" />
            <span>{isExpanded ? t("work.detail.collapseStaff") : t("work.detail.viewAllStaff", { count: relations.length })}</span>
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* 展开后的结构化演职团队与角色看板 (Bangumi / LRM 风格) */}
      {isExpanded && (
        <div className="p-3.5 sm:p-4 rounded-md border border-black/10 dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] space-y-3 mt-2 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-2">
            <div className="flex items-center gap-1 text-xs font-mono">
              <button
                type="button"
                onClick={() => setActiveTab("key")}
                className={`px-2.5 py-1 rounded-sm transition-colors ${
                  activeTab === "key"
                    ? "bg-primary text-white font-medium"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {t("work.detail.tabKeyStaff")} ({keyStaff.length})
              </button>
              {castList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab("characters")}
                  className={`px-2.5 py-1 rounded-sm transition-colors ${
                    activeTab === "characters"
                      ? "bg-primary text-white font-medium"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {t("work.detail.tabCharacters")} ({castList.length})
                </button>
              )}
              {otherStaff.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab("staff")}
                  className={`px-2.5 py-1 rounded-sm transition-colors ${
                    activeTab === "staff"
                      ? "bg-primary text-white font-medium"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {t("work.detail.tabAllStaff")} ({otherStaff.length})
                </button>
              )}
            </div>
            <span className="font-mono text-[11px] text-gray-400">TOTAL {relations.length} PERSONS</span>
          </div>

          {/* 渲染当前 Tab 的网格卡片 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
            {(activeTab === "key" ? keyStaff : activeTab === "characters" ? castList : otherStaff).map((rel) => (
              <Link
                key={rel.id}
                href={`/artists/${rel.artist_id}`}
                className="flex items-center gap-2 p-2 rounded border border-black/5 dark:border-white/[0.06] bg-background/60 hover:border-primary/40 hover:bg-background transition-all group"
              >
                {rel.artist?.avatar_url ? (
                  <img
                    src={rel.artist.avatar_url}
                    alt={rel.artist.name}
                    className="w-8 h-8 rounded-full object-cover shrink-0 border border-black/10 dark:border-white/10"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-mono text-xs font-semibold shrink-0">
                    {rel.artist?.name ? rel.artist.name.charAt(0).toUpperCase() : "A"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-900 dark:text-white truncate group-hover:text-primary transition-colors">
                    {rel.artist?.name}
                  </div>
                  <div className="font-mono text-[10px] text-gray-500 dark:text-gray-400 truncate">
                    {roleLabel(rel.role)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
