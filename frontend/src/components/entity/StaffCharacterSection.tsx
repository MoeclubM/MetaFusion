"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { User, Users, ChevronDown, ChevronUp, Mic, Building2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions } from "@/lib/definitions";

// 署名区块的数据契约：页面从 /catalog/entities/:id/relations 解析出结构化条目，
// 不再做角色/声优字符串配对。哪些关系算"署名"、哪些算"角色"由关系定义自己声明
// （ParticipantSlot），代码不写死关系码、不写死职位文本、也不拿分组码当语义用。
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
  character?: { id?: string; name: string; avatarUrl?: string; rankLabel?: string; rankCode?: string };
  /** 配音语言（关系属性），同一角色的多版配音据此区分。 */
  language?: string;
  /** 适用篇目/版本（关系属性 context 的展示名），多版配音据此区分。 */
  contextLabel?: string;
}

/** 主角番位码：character_rank 词表用 main；早期字典键 era 用过 primary（同一含义）。 */
const MAIN_CHARACTER_RANKS = new Set(["main", "primary"]);

interface StaffCharacterSectionProps {
  credits: StaffCredit[];
}

/** 同一角色可有多条配音：不同演员、语言、适用篇目各自保留，不互相覆盖。 */
interface CharacterVoice {
  id: string;
  name: string;
  avatar_url?: string;
  /** 语言 / 适用篇目等上下文，仅在存在时展示，用于区分多版配音。 */
  context?: string;
}

interface CharacterCardItem {
  id: string;
  character: {
    id?: string;
    name: string;
    avatar_url?: string;
    roleBadge: string;
    /** 番位数据码（主角 = main）：高亮判定按码，不看本地化文案。 */
    rankCode?: string;
  };
  voices: CharacterVoice[];
}

export function StaffCharacterSection({ credits }: StaffCharacterSectionProps) {
  const { t } = useI18n();
  const { definitions: defs } = useDefinitions();
  const defaultRole = t("work.detail.staffDefaultRole");
  const characterFallback = t("work.detail.relGroupCharacters");
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "characters">("all");

  if (!credits || credits.length === 0) return null;

  // 参与者槽位由关系定义声明（person/character/peer）。为什么不用"fields 里有没有 character"：
  // 29 个关系码共用同一份 fields（含 character），那个判定对每条关系都成立，
  // 于是 isCast 恒真、人员网格永不渲染、图标恒为麦克风。槽位是逐条关系声明的语义。
  const participantSlot = (code: string) => (defs?.relations?.[code] as any)?.participant_slot || "";
  // 定义缺失（老实例的定义文档还没有槽位声明）时退回旧的字段判定，避免把关系判成"非署名"而丢展示。
  const relationDeclaresCharacter = (code: string) => (defs?.relations?.[code]?.fields || []).includes("character");
  // 角色类关系：对端是虚构角色，或数据里这条边已经带上了角色。
  const isCharacterRelation = (code: string) =>
    participantSlot(code) === "character" || (!participantSlot(code) && relationDeclaresCharacter(code));
  // 署名类关系：对端是署名主体（人/机构）。槽位未声明时才退回"只要不是角色类"的宽松口径。
  const isCreditRelation = (code: string) =>
    !!participantSlot(code) && participantSlot(code) !== "character";
  const isCast = (c: StaffCredit) => !!c.character || isCharacterRelation(c.relationType);
  // 人物网格收录全部署名主体（人/机构）：不再按分组码切出"核心主创"——creative 组装的是
  // 作品派生关系，拿它当"主创"永远命不中，那条页签恒空。
  const humanCredits = useMemo(
    () => credits.filter((c) => isCreditRelation(c.relationType) || (!participantSlot(c.relationType) && !isCast(c))),
    [credits, defs],
  );
  const otherStaff = humanCredits;

  // 角色与声优双轨卡片：登场角色直接成卡，配音挂到其角色卡上。
  // 卡片按**角色 ID**归并（角色名会因语种/重名而误并），且配音保留为列表——
  // 同一角色在不同语言/篇目下由不同演员配音是常态，只留第一位会丢数据。
  const characterCards = useMemo(() => {
    const cardMap = new Map<string, CharacterCardItem>();
    const badgeOf = (c: StaffCredit) =>
      c.character?.rankLabel || c.creditRole || c.relationLabel || characterFallback;
    for (const c of credits) {
      if (!c.character) continue;
      // 有角色实体 ID 用 ID 成卡；导入/手工数据缺 ID 时退回名称，避免全部并进一张空卡。
      const key = c.character.id || `name:${c.character.name}`;
      if (!key) continue;
      let card = cardMap.get(key);
      if (!card) {
        card = {
          id: c.id,
          character: {
            id: c.character.id,
            name: c.character.name,
            avatar_url: c.character.avatarUrl,
            roleBadge: badgeOf(c),
            rankCode: c.character.rankCode,
          },
          voices: [],
        };
        cardMap.set(key, card);
      }
      const selfIsCharacter = !!c.character && !!c.agent.id && c.agent.id === c.character.id;
      if (!selfIsCharacter) {
        const context = [c.language, c.contextLabel].filter(Boolean).join(" · ");
        // 同一演员在同一上下文的重复关系只留一条；不同语言/篇目各自保留。
        const dup = card.voices.some(
          (v) => v.id === c.agent.id && (v.context || "") === context,
        );
        if (!dup) {
          card.voices.push({
            id: c.agent.id,
            name: c.agent.name,
            avatar_url: c.agent.avatarUrl,
            context: context || undefined,
          });
        }
      } else {
        if (!card.character.id && c.character.id) card.character.id = c.character.id;
        if (!card.character.avatar_url && c.character.avatarUrl) card.character.avatar_url = c.character.avatarUrl;
        // 登场关系带番位（主角/配角），比配音关系声明的职位更能代表角色定位。
        if (c.character.rankLabel) card.character.roleBadge = c.character.rankLabel;
        if (c.character.rankCode) card.character.rankCode = c.character.rankCode;
      }
    }
    return Array.from(cardMap.values());
  }, [credits, characterFallback]);

  // 紧凑核心创作者徽章（未展开时展示在详情页头部）
  const displayedKey = credits.slice(0, 8);

  // 页签：固定「全部」置顶，其余按实际存在的关系组自动生成（无数据的分组不出现）
  const staffTabs = useMemo(() => {
    const list: { key: "all" | "characters"; label: string; count: number }[] = [
      { key: "all", label: t("work.detail.tabAll"), count: credits.length },
    ];
    if (characterCards.length > 0) {
      list.push({ key: "characters", label: t("work.detail.tabCharacters"), count: characterCards.length });
    }
    return list;
  }, [credits, characterCards, t]);

  const effectiveTab = staffTabs.some((tab) => tab.key === activeTab) ? activeTab : "all";

  // 格式化具体职务标签：来源职位文本优先，缺失回退关系本地化名。
  const formatRole = (c: StaffCredit) => c.creditRole || c.relationLabel || defaultRole;

  // 图标按关系语义取：只有"某个主体为角色配音/演出"才是麦克风——判断依据是
  // 关系声明了 person 槽位且带 character 属性（voiced_by 这类）；
  // 角色实体自身（character_in 的源端）与机构署名各有自己的图标。
  // 旧实现把 isCast 当麦克风条件，而 isCast 恒真，于是出版社也显示麦克风。
  const isVoiceCredit = (c: StaffCredit) =>
    participantSlot(c.relationType) === "person" && relationDeclaresCharacter(c.relationType);
  const agentIcon = (c: StaffCredit) => {
    if (c.agent.types.includes("organization") || c.agent.types.includes("publisher")) {
      return <Building2 className="w-3.5 h-3.5 text-amber-500 shrink-0" strokeWidth={1.5} />;
    }
    if (isVoiceCredit(c)) return <Mic className="w-3.5 h-3.5 text-sky-500 shrink-0" strokeWidth={1.5} />;
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
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-line hover:border-primary/40 text-xs text-gray-700 dark:text-gray-200 transition-colors duration-fast ease-soft"
          >
            {agentIcon(rel)}
            <span className="font-mono text-[11px] text-text-muted">{formatRole(rel)}:</span>
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
        <div className="p-3.5 sm:p-4 rounded-md border border-line bg-surfaceSubtle space-y-3 mt-2 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-line-subtle pb-2">
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
            <span className="font-mono text-[11px] text-text-muted">TOTAL {credits.length} CREDITS</span>
          </div>

          {/* 渲染当前 Tab: 角色与声优专用双轨卡片 (Characters & Cast) */}
          {(effectiveTab === "characters" || effectiveTab === "all") && characterCards.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
              {characterCards.map((item) => (
                <div
                  key={item.character.id || item.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-md border border-line bg-background/80 hover:border-primary/40 transition-all shadow-xs"
                >
                  {/* 角色端 */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {item.character.id ? (
                      <Link href={`/catalog/${item.character.id}`} className="flex items-center gap-2.5 min-w-0 group">
                        {item.character.avatar_url ? (
                          <img
                            src={item.character.avatar_url}
                            alt={item.character.name}
                            className="w-10 h-10 rounded-md object-cover shrink-0 border border-line group-hover:scale-105 transition-transform duration-base ease-soft"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-amber-500/10 text-amber-600 dark:text-warn flex items-center justify-center font-bold text-xs shrink-0">
                            {item.character.name.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-text-strong truncate group-hover:text-primary transition-colors duration-fast ease-soft">
                            {item.character.name}
                          </div>
                          <span
                            className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wide ${
                              MAIN_CHARACTER_RANKS.has(item.character.rankCode || "")
                                ? "bg-amber-500/15 text-amber-700 dark:text-warn-soft font-medium"
                                : "bg-black/[0.04] dark:bg-white/[0.06] text-text-faint"
                            }`}
                          >
                            {item.character.roleBadge}
                          </span>
                        </div>
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-10 rounded-md bg-amber-500/10 text-amber-600 dark:text-warn flex items-center justify-center font-bold text-xs shrink-0">
                          {item.character.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-text-strong truncate">{item.character.name}</div>
                          {item.character.roleBadge && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wide bg-amber-500/15 text-amber-700 dark:text-warn-soft font-medium">
                              {item.character.roleBadge}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 声优端：同一角色可有多个演员（不同语言/篇目），逐条列出 */}
                  {item.voices.length > 0 && (
                    <div className="flex flex-col gap-1.5 shrink-0 items-end">
                      {item.voices.map((voice) => (
                        <Link
                          key={`${voice.id}-${voice.context || ""}`}
                          href={`/catalog/${voice.id}`}
                          className="flex items-center gap-2 p-1.5 rounded bg-surfaceSubtle hover:bg-primary/5 border border-line-subtle hover:border-primary/30 transition-all text-right group"
                          title={voice.context ? `CV: ${voice.name} (${voice.context})` : `CV: ${voice.name}`}
                        >
                          <div className="min-w-0 text-right">
                            <div className="text-[10px] font-mono text-text-muted">CV</div>
                            <div className="text-xs font-medium text-gray-700 dark:text-gray-200 group-hover:text-primary transition-colors duration-fast ease-soft truncate max-w-[90px]">
                              {voice.name}
                            </div>
                            {voice.context && (
                              <div className="font-mono text-[10px] text-text-muted truncate max-w-[110px]">
                                {voice.context}
                              </div>
                            )}
                          </div>
                          {voice.avatar_url ? (
                            <img
                              src={voice.avatar_url}
                              alt={voice.name}
                              className="w-8 h-8 rounded-full object-cover shrink-0 border border-line"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-sky-500/10 text-sky-600 dark:text-info flex items-center justify-center font-mono text-[10px] shrink-0">
                              <Mic className="w-3.5 h-3.5" />
                            </div>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 全部页签：署名主体人员网格（角色卡片与人员网格可以同屏） */}
          {effectiveTab === "all" && otherStaff.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                {otherStaff.map((rel) => (
                <Link
                  key={rel.id}
                  href={`/catalog/${rel.agent.id}`}
                  className="flex items-center gap-2 p-2 rounded border border-line-subtle bg-background/60 hover:border-primary/40 hover:bg-background transition-all group shadow-xs"
                >
                  {rel.agent.avatarUrl ? (
                    <img
                      src={rel.agent.avatarUrl}
                      alt={rel.agent.name}
                      className="w-8 h-8 rounded-full object-cover shrink-0 border border-line"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-mono text-xs font-semibold shrink-0">
                      {rel.agent.name ? rel.agent.name.charAt(0).toUpperCase() : "A"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-text-strong truncate group-hover:text-primary transition-colors duration-fast ease-soft">
                      {rel.agent.name}
                    </div>
                    <div className="font-mono text-[10px] text-text-muted truncate">
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
