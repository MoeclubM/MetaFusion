"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { User, Users, ChevronDown, ChevronUp, Mic, Sparkles, Film, Building2 } from "lucide-react";
import { WorkArtistRelation } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

interface StaffCharacterSectionProps {
  relations: WorkArtistRelation[];
  roleLabel: (role: string) => string;
}

interface CharacterCardItem {
  id: string;
  character: {
    id?: string;
    name: string;
    avatar_url?: string;
    roleBadge: string;
  };
  voiceActor?: {
    id: string;
    name: string;
    avatar_url?: string;
  };
}

export function StaffCharacterSection({ relations, roleLabel }: StaffCharacterSectionProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"key" | "characters" | "staff">("key");

  if (!relations || relations.length === 0) return null;

  const isCastRole = (role: string, artistType?: string) => {
    const r = role.toLowerCase();
    return (
      artistType === "character" ||
      artistType === "virtual_character" ||
      r.includes("voice actor") ||
      r.includes("character") ||
      r.includes("声优") ||
      r.includes("配音") ||
      r.includes("角色") ||
      r.includes("主角") ||
      r.includes("配角") ||
      r.includes("客串") ||
      r.includes("配演")
    );
  };

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
      r.includes("作曲") ||
      r.includes("系列构成") ||
      r.includes("动画制作") ||
      r.includes("人物设定")
    );
  };

  // 分类组织：核心主创 (Key Staff)、角色与声优 (Characters / Cast)、全量制作团队 (All Staff)
  const keyStaff = useMemo(() => {
    return relations.filter((r) => isKeyRole(r.role) && !isCastRole(r.role, r.artist?.entity_type));
  }, [relations]);

  const otherStaff = useMemo(() => {
    return relations.filter((r) => !isKeyRole(r.role) && !isCastRole(r.role, r.artist?.entity_type));
  }, [relations]);

  // 结构化角色与声优双轨数据组装 (Bangumi Benchmark)
  const characterCards = useMemo(() => {
    const cardMap = new Map<string, CharacterCardItem>();

    // 1. 提取所有 Character 实体
    for (const rel of relations) {
      const art = rel.artist;
      const isChar = art?.entity_type === "character" || art?.entity_type === "virtual_character" ||
        rel.role === "主角" || rel.role === "配角" || rel.role === "客串" || rel.role === "Character" ||
        (rel.role.startsWith("角色") && !rel.role.includes("配演"));

      if (isChar && art) {
        let badge = rel.role;
        if (!badge || badge === "Character" || badge === "character") {
          badge = "角色";
        }
        cardMap.set(art.name, {
          id: rel.id.toString(),
          character: {
            id: art.id,
            name: art.name,
            avatar_url: art.avatar_url,
            roleBadge: badge,
          },
        });
      }
    }

    // 2. 提取声优 (Voice Actor) 并配对
    for (const rel of relations) {
      const art = rel.artist;
      const r = rel.role;
      const isVA = r.includes("声优") || r.includes("Voice Actor") || r.includes("配演") || r.includes("配音");

      if (isVA && art) {
        // 从 role 中提取角色名 (如 "声优 (配演: 逢坂大河 [主角])" 或 "Voice Actor (as Taiga Aisaka)")
        let charName = "";
        let roleBadge = "角色";

        const match = r.match(/(?:配演:\s*|as\s*)([^\]\)]+)/i);
        if (match && match[1]) {
          charName = match[1].trim();
          const bracketMatch = charName.match(/\[([^\]]+)\]/);
          if (bracketMatch) {
            roleBadge = bracketMatch[1].trim();
            charName = charName.replace(/\[[^\]]+\]/, "").trim();
          }
        }

        if (charName) {
          const existing = cardMap.get(charName);
          if (existing) {
            existing.voiceActor = {
              id: art.id,
              name: art.name,
              avatar_url: art.avatar_url,
            };
          } else {
            cardMap.set(charName, {
              id: rel.id.toString(),
              character: {
                name: charName,
                roleBadge: roleBadge,
              },
              voiceActor: {
                id: art.id,
                name: art.name,
                avatar_url: art.avatar_url,
              },
            });
          }
        } else {
          // 未标明特定角色的通用配音演员
          cardMap.set(art.name, {
            id: rel.id.toString(),
            character: {
              name: art.name,
              roleBadge: "声优 / 配音",
              avatar_url: art.avatar_url,
              id: art.id,
            },
          });
        }
      }
    }

    return Array.from(cardMap.values());
  }, [relations]);

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
            {isCastRole(rel.role, rel.artist?.entity_type) ? (
              <Mic className="w-3.5 h-3.5 text-sky-500 shrink-0" strokeWidth={1.5} />
            ) : rel.artist?.entity_type === "studio" || rel.artist?.entity_type === "publisher" ? (
              <Building2 className="w-3.5 h-3.5 text-amber-500 shrink-0" strokeWidth={1.5} />
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
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 text-xs font-mono transition-all cursor-pointer shadow-xs"
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
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => setActiveTab("key")}
                className={`px-3 py-1 rounded-sm transition-all ${
                  activeTab === "key"
                    ? "bg-primary text-white font-medium shadow-xs"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {t("work.detail.tabKeyStaff")} ({keyStaff.length})
              </button>
              {characterCards.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab("characters")}
                  className={`px-3 py-1 rounded-sm transition-all ${
                    activeTab === "characters"
                      ? "bg-primary text-white font-medium shadow-xs"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {t("work.detail.tabCharacters")} ({characterCards.length})
                </button>
              )}
              {otherStaff.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab("staff")}
                  className={`px-3 py-1 rounded-sm transition-all ${
                    activeTab === "staff"
                      ? "bg-primary text-white font-medium shadow-xs"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {t("work.detail.tabAllStaff")} ({otherStaff.length})
                </button>
              )}
            </div>
            <span className="font-mono text-[11px] text-gray-400">TOTAL {relations.length} CREDITS</span>
          </div>

          {/* 渲染当前 Tab: 角色与声优专用双轨卡片 (Characters & Cast) */}
          {activeTab === "characters" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
              {characterCards.map((item) => (
                <div
                  key={item.id + item.character.name}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-md border border-black/10 dark:border-white/[0.08] bg-background/80 hover:border-primary/40 transition-all shadow-xs"
                >
                  {/* 角色端 */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {item.character.id ? (
                      <Link href={`/artists/${item.character.id}`} className="flex items-center gap-2.5 min-w-0 group">
                        {item.character.avatar_url ? (
                          <img
                            src={item.character.avatar_url}
                            alt={item.character.name}
                            className="w-10 h-10 rounded-md object-cover shrink-0 border border-black/10 dark:border-white/10 group-hover:scale-105 transition-transform"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">
                            {item.character.name.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-900 dark:text-white truncate group-hover:text-primary transition-colors">
                            {item.character.name}
                          </div>
                          <span
                            className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wide ${
                              item.character.roleBadge.includes("主角")
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium"
                                : item.character.roleBadge.includes("配角")
                                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                                : "bg-black/[0.04] dark:bg-white/[0.06] text-gray-500"
                            }`}
                          >
                            {item.character.roleBadge}
                          </span>
                        </div>
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-10 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">
                          {item.character.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{item.character.name}</div>
                          {item.character.roleBadge && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wide bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                              {item.character.roleBadge}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 声优端 */}
                  {item.voiceActor && (
                    <Link
                      href={`/artists/${item.voiceActor.id}`}
                      className="flex items-center gap-2 shrink-0 p-1.5 rounded bg-black/[0.02] dark:bg-white/[0.03] hover:bg-primary/5 border border-black/5 dark:border-white/5 hover:border-primary/30 transition-all text-right group"
                      title={`CV: ${item.voiceActor.name}`}
                    >
                      <div className="min-w-0 text-right">
                        <div className="text-[10px] font-mono text-gray-400 dark:text-gray-500">CV</div>
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-200 group-hover:text-primary transition-colors truncate max-w-[90px]">
                          {item.voiceActor.name}
                        </div>
                      </div>
                      {item.voiceActor.avatar_url ? (
                        <img
                          src={item.voiceActor.avatar_url}
                          alt={item.voiceActor.name}
                          className="w-8 h-8 rounded-full object-cover shrink-0 border border-black/10 dark:border-white/10"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center font-mono text-[10px] shrink-0">
                          <Mic className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 渲染当前 Tab: 核心主创 (Key Staff) & 全部制作团队 (All Staff) */}
          {activeTab !== "characters" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
              {(activeTab === "key" ? keyStaff : otherStaff).map((rel) => (
                <Link
                  key={rel.id}
                  href={`/artists/${rel.artist_id}`}
                  className="flex items-center gap-2 p-2 rounded border border-black/5 dark:border-white/[0.06] bg-background/60 hover:border-primary/40 hover:bg-background transition-all group shadow-xs"
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
          )}
        </div>
      )}
    </div>
  );
}
