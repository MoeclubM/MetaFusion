"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { User, Users, ChevronDown, ChevronUp, Mic, Building2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions } from "@/lib/definitions";

// 演职员区块的数据契约：页面从 /catalog/entities/:id/relations 解析出结构化条目，
// 不再做角色/声优字符串配对。cast（配音/登场角色）与主创（definitions 关系分组
// group=creative）按关系类型与词表分组判定，代码不写死职位文本。
export interface StaffCreditAgent {
  id: string;
  name: string;
  avatarUrl?: string;
  types: string[];
}

export interface StaffCredit {
  id: string;
  relationType: string;
  relationLabel: string;
  /** 来源声明的自由文本职位（如"摄影监督"），优先于关系名展示。 */
  creditRole?: string;
  agent: StaffCreditAgent;
  /** 配音关系指向的角色，或登场角色（character_in）自身。 */
  character?: { id?: string; name: string; avatarUrl?: string; rankLabel?: string };
}

interface StaffCharacterSectionProps {
  credits: StaffCredit[];
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

export function StaffCharacterSection({ credits }: StaffCharacterSectionProps) {
  const { t } = useI18n();
  const { definitions: defs } = useDefinitions();
  const defaultRole = t("work.detail.staffDefaultRole");
  const characterFallback = t("work.detail.relGroupCharacters");
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "key" | "characters">("all");

  if (!credits || credits.length === 0) return null;

  const relationGroup = (code: string) => defs?.relations?.[code]?.group || "";
  // cast：配音与登场角色关系；登场的角色实体类型兜底判定。
  const isCast = (c: StaffCredit) =>
    c.relationType === "voiced_by" ||
    c.relationType === "character_in" ||
    !!c.character ||
    c.agent.types.includes("character");
  // 核心主创：definitions 把创作类关系（编剧/导演/作曲…）归入 creative 组，分组可配。
  const isKeyStaff = (c: StaffCredit) => !isCast(c) && relationGroup(c.relationType) === "creative";

  const keyStaff = useMemo(() => credits.filter((c) => isKeyStaff(c)), [credits, defs]);
  const otherStaff = useMemo(() => credits.filter((c) => !isCast(c)), [credits, defs]);

  // 角色与声优双轨卡片：登场角色直接成卡，配音按其角色成卡并与声优配对。
  const characterCards = useMemo(() => {
    const cardMap = new Map<string, CharacterCardItem>();
    const badgeOf = (c: StaffCredit) =>
      c.character?.rankLabel || c.creditRole || c.relationLabel || characterFallback;
    for (const c of credits) {
      if (!c.character) continue;
      const badge = badgeOf(c);
      const key = c.character.name;
      const existing = cardMap.get(key);
      if (existing) {
        // 同名角色已有卡片：配音补声优端，登场补角色实体信息。
        if (c.relationType === "voiced_by") {
          if (!existing.voiceActor) {
            existing.voiceActor = { id: c.agent.id, name: c.agent.name, avatar_url: c.agent.avatarUrl };
          }
        } else if (c.relationType === "character_in") {
          if (!existing.character.id && c.character.id) existing.character.id = c.character.id;
          if (!existing.character.avatar_url && c.character.avatarUrl) existing.character.avatar_url = c.character.avatarUrl;
        }
        continue;
      }
      cardMap.set(key, {
        id: c.id,
        character: {
          id: c.character.id,
          name: c.character.name,
          avatar_url: c.character.avatarUrl,
          roleBadge: badge,
        },
      });
      if (c.relationType === "voiced_by") {
        cardMap.get(key)!.voiceActor = { id: c.agent.id, name: c.agent.name, avatar_url: c.agent.avatarUrl };
      }
    }
    return Array.from(cardMap.values());
  }, [credits, characterFallback]);

  // 紧凑核心创作者徽章（未展开时展示在详情页头部）
  const displayedKey = keyStaff.length > 0 ? keyStaff.slice(0, 8) : credits.slice(0, 8);

  // 页签：固定「全部」置顶，其余按实际存在的关系组自动生成（无数据的分组不出现）
  const staffTabs = useMemo(() => {
    const list: { key: "all" | "key" | "characters"; label: string; count: number }[] = [
      { key: "all", label: t("work.detail.tabAll"), count: credits.length },
    ];
    if (keyStaff.length > 0) {
      list.push({ key: "key", label: t("work.detail.tabKeyStaff"), count: keyStaff.length });
    }
    if (characterCards.length > 0) {
      list.push({ key: "characters", label: t("work.detail.tabCharacters"), count: characterCards.length });
    }
    return list;
  }, [credits, keyStaff, characterCards, t]);

  const effectiveTab = staffTabs.some((tab) => tab.key === activeTab) ? activeTab : "all";

  // 格式化具体职务标签：来源职位文本优先，缺失回退关系本地化名。
  const formatRole = (c: StaffCredit) => c.creditRole || c.relationLabel || defaultRole;

  const agentIcon = (c: StaffCredit) => {
    if (isCast(c)) return <Mic className="w-3.5 h-3.5 text-sky-500 shrink-0" strokeWidth={1.5} />;
    if (c.agent.types.includes("organization") || c.agent.types.includes("publisher")) {
      return <Building2 className="w-3.5 h-3.5 text-amber-500 shrink-0" strokeWidth={1.5} />;
    }
    return <User className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={1.5} />;
  };

  return (
    <div className="space-y-3 pt-1">
      {/* 紧凑关键演职员徽章流 */}
      <div className="flex flex-wrap gap-2 items-center">
        {displayedKey.map((rel) => (
          <Link
            key={rel.id}
            href={`/catalog/${rel.agent.id}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 hover:border-primary/40 text-xs text-gray-700 dark:text-gray-200 transition-colors"
          >
            {agentIcon(rel)}
            <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{formatRole(rel)}:</span>
            <span className="font-medium underline decoration-dotted underline-offset-2">{rel.agent.name}</span>
          </Link>
        ))}

        {credits.length > 8 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 text-xs font-mono transition-all cursor-pointer shadow-xs"
          >
            <Users className="w-3.5 h-3.5" />
            <span>{isExpanded ? t("work.detail.collapseStaff") : t("work.detail.viewAllStaff", { count: credits.length })}</span>
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* 展开后的结构化演职团队与角色看板 (Bangumi / LRM 风格) */}
      {isExpanded && (
        <div className="p-3.5 sm:p-4 rounded-md border border-black/10 dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] space-y-3 mt-2 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-2">
            <div className="flex items-center gap-1.5 text-xs font-mono flex-wrap">
              {staffTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1 rounded-sm transition-all ${
                    effectiveTab === tab.key
                      ? "bg-primary text-white font-medium shadow-xs"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>
            <span className="font-mono text-[11px] text-gray-400">TOTAL {credits.length} CREDITS</span>
          </div>

          {/* 渲染当前 Tab: 角色与声优专用双轨卡片 (Characters & Cast) */}
          {(effectiveTab === "characters" || effectiveTab === "all") && characterCards.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
              {characterCards.map((item) => (
                <div
                  key={item.id + item.character.name}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-md border border-black/10 dark:border-white/[0.08] bg-background/80 hover:border-primary/40 transition-all shadow-xs"
                >
                  {/* 角色端 */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {item.character.id ? (
                      <Link href={`/catalog/${item.character.id}`} className="flex items-center gap-2.5 min-w-0 group">
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
                              item.character.roleBadge.includes("主角") || item.character.roleBadge.includes("Lead")
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium"
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
                      href={`/catalog/${item.voiceActor.id}`}
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
          {(effectiveTab === "key" || effectiveTab === "all") && otherStaff.length > 0 && (
            <>
              {effectiveTab === "all" && characterCards.length > 0 && (
                <div className="font-mono text-[10px] uppercase tracking-wider text-gray-400 pt-1">{t("work.detail.tabAllStaff")}</div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                {(effectiveTab === "key" ? keyStaff : otherStaff).map((rel) => (
                <Link
                  key={rel.id}
                  href={`/catalog/${rel.agent.id}`}
                  className="flex items-center gap-2 p-2 rounded border border-black/5 dark:border-white/[0.06] bg-background/60 hover:border-primary/40 hover:bg-background transition-all group shadow-xs"
                >
                  {rel.agent.avatarUrl ? (
                    <img
                      src={rel.agent.avatarUrl}
                      alt={rel.agent.name}
                      className="w-8 h-8 rounded-full object-cover shrink-0 border border-black/10 dark:border-white/10"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-mono text-xs font-semibold shrink-0">
                      {rel.agent.name ? rel.agent.name.charAt(0).toUpperCase() : "A"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-900 dark:text-white truncate group-hover:text-primary transition-colors">
                      {rel.agent.name}
                    </div>
                    <div className="font-mono text-[10px] text-gray-500 dark:text-gray-400 truncate">
                      {formatRole(rel)}
                    </div>
                  </div>
                </Link>
              ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
