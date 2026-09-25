// 通用署名条目构造：任一实体详情页把 /catalog/entities/:id/relations 的
// {items, entities} 喂进来，得到 StaffCharacterSection 消费的结构化条目。
//
// 方向约定（与原来作品页内联版一致）：
// - 实体 → agent（人/机构）：署名关系（配音、制作…），角色挂在 attributes.character；
// - agent(角色) → 实体：登场关系，agent 自身即角色，番位读 attributes.character_rank。
// 番位名以服务端 character_rank 词表为准，字典键只作兜底。

import { getRelationName, getTermName, type DynamicDefinitions } from "@/lib/definitions";
import { coverUrl } from "@/lib/cover";
import type { Entity } from "@/components/catalog/api";

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

export interface RelationLike {
  id: string;
  type: string;
  source_id: string;
  target_id: string;
  attributes?: Record<string, any>;
}

export function attrText(v: any): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  return "";
}

export function buildStaffCredits(args: {
  entityId: string;
  relations: RelationLike[];
  relEntities: Record<string, Entity>;
  defs: DynamicDefinitions | null | undefined;
  locale: string;
  tr: (key: string, fallback: string) => string;
}): StaffCredit[] {
  const { entityId, relations, relEntities, defs, locale, tr } = args;
  const out: StaffCredit[] = [];
  for (const r of relations) {
    if (r.source_id === entityId) {
      const target = relEntities[r.target_id];
      if (!target || target.kind !== "agent") continue;
      const credit: StaffCredit = {
        id: r.id,
        relationType: r.type,
        relationLabel: getRelationName(defs, r.type, true, locale),
        creditRole: attrText(r.attributes?.credit_role) || undefined,
        // 头像即对端的封面（首张图）：取值一律走 lib/cover，不在这里重新索引 pictures[0]。
        agent: { id: target.id!, name: target.title || "", avatarUrl: coverUrl(target) || undefined, types: target.types || [] },
      };
      if (attrText(r.attributes?.character)) {
        const chId = attrText(r.attributes?.character);
        const ch = chId ? relEntities[chId] : undefined;
        if (ch) {
          credit.character = { id: ch.id, name: ch.title, avatarUrl: coverUrl(ch) || undefined };
        }
        // 配音上下文：language 是自由文本字段（非受控词表），context 是实体引用，
        // 两者共同区分同一角色在不同语言/篇目下的多版配音。
        credit.language = attrText(r.attributes?.language) || undefined;
        const ctxId = attrText(r.attributes?.context);
        credit.contextLabel = (ctxId ? relEntities[ctxId]?.title : "") || undefined;
      }
      out.push(credit);
    } else if (r.target_id === entityId) {
      // 登场角色：agent(角色) → 实体，方向与署名关系相反。
      // 显式要求对端是本实体：游离关系（两端都不是本实体）不得虚构成登场。
      //（关系端点口径与原来作品页内联版一致，API 只回本实体的边。）
      // 番位码读 attributes.character_rank：番位词表是 character_rank（main/supporting/guest/
      // ensemble/narrator/cameo），attributes.role 属"内容用途"词表（primary/supplement/extra），
      // 只在兼容早期数据时读，不当作番位语义。
      const src = relEntities[r.source_id];
      if (!src || src.kind !== "agent") continue;
      const rankFromVocab = attrText(r.attributes?.character_rank);
      const rankCode = rankFromVocab || attrText(r.attributes?.role);
      const rankTerm = rankFromVocab ? getTermName(defs, "character_rank", rankCode, locale) : "";
      const rankLabel = !rankCode
        ? ""
        : rankTerm && rankTerm !== rankCode
          ? rankTerm
          : tr(`entity.characterRank.${rankCode}`, rankCode);
      out.push({
        id: r.id,
        relationType: r.type,
        relationLabel: getRelationName(defs, r.type, true, locale),
        creditRole: attrText(r.attributes?.credit_role) || undefined,
        agent: { id: src.id!, name: src.title || "", avatarUrl: coverUrl(src) || undefined, types: src.types || [] },
        character: {
          id: src.id!,
          name: src.title || "",
          avatarUrl: coverUrl(src) || undefined,
          rankLabel: rankLabel && rankLabel !== rankCode ? rankLabel : undefined,
          rankCode: rankCode || undefined,
        },
      });
    }
  }
  return out;
}
