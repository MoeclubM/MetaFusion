"use client";

import { useState, useEffect, useMemo } from "react";
import { resolveLocalizedName } from "./localizedNames";
export { resolveLocalizedName } from "./localizedNames";

export interface TypeDef {
  names: Record<string, string>;
  kinds: string[];
  fields: string[];
  template: string;
  enabled: boolean;
}

export interface FieldDef {
  names: Record<string, string>;
  type: string;
  unit?: Record<string, string>;
  vocabulary?: string;
  enabled: boolean;
  required?: boolean;
  kinds?: string[];
  fields?: Record<string, FieldDef>;
  items?: FieldDef;
  min?: number;
  max?: number;
  anchor_key?: string;
  /** 仅 group 内的 number 子字段：声明本字段是同组该子字段的区间终点。 */
  range_start?: string;
  /** 可写、可检索，但不进详情信息面板（存档/机器用途，如资料表原始条目）。 */
  hidden?: boolean;
  /** 对比语义（闭集）："content" 为内容选择范围，"locating" 为本版定位。 */
  semantics?: string;
}

export interface SectionDef {
  names: Record<string, string>;
  fields: string[];
}

export interface TemplateDef {
  names: Record<string, string>;
  sections: SectionDef[];
  columns?: string[];
  relation_groups?: string[];
  directory?: string;
  modules?: string[];
  /** 该模板下代表"作品首发/发行日期"的字段码；为空则不展示日期。 */
  primary_date_field?: string;
  /** 详情页标题旁以徽章突出的字段码（如载体格式、平台）；顺序即展示顺序。 */
  badge_fields?: string[];
  /** 列表页可用于筛选的字段码（通常是枚举字段）；顺序即展示顺序。 */
  facet_fields?: string[];
}

export interface VocabularyDef {
  names: Record<string, string>;
  terms: Record<string, { names: Record<string, string>; enabled: boolean; is_bonus?: boolean }>;
}

/** 署名槽位闭集（与后端 types.go 的 ParticipantSlot 同口径）：person 对端是署名主体
 *  （人/机构）、character 对端是虚构角色、peer 是同层级对象不产生署名主体、空=未声明
 *  （老文档）。展示端按它判定署名/角色，不写死关系码、不拿分组码当语义用。 */
export type ParticipantSlot = "" | "person" | "character" | "peer";

export const PARTICIPANT_SLOTS: ParticipantSlot[] = ["", "person", "character", "peer"];

export interface RelationDef {
  names: Record<string, string>;
  reverse_names: Record<string, string>;
  source_kinds: string[];
  target_kinds: string[];
  /** 端点动态类型约束（type code）：为空表示不限。 */
  source_types?: string[];
  target_types?: string[];
  /** 关系可携带的属性字段码（definitions.fields 引用）：后台声明后编辑表单即可填写。 */
  fields?: string[];
  symmetric?: boolean;
  acyclic?: boolean;
  max_outgoing?: number;
  max_incoming?: number;
  /** 声明这条关系表达"组成/聚合"（集合→作品、专辑→曲目等）：页面据此算组成列表，不写死关系码。 */
  aggregate?: boolean;
  /** 这条关系的对端在署名里扮演什么（见 ParticipantSlot）：署名区块与人物网格按它收录。 */
  participant_slot?: ParticipantSlot | string;
  /** 参与批量署名聚合（Release/Expression 详情的署名列表）：口径只看本声明，
   *  不看分组码——后台挪分组只改展示归类，不改变哪些关系算署名。 */
  counts_as_credit?: boolean;
  group: string;
  group_names?: Record<string, string>;
  enabled: boolean;
}

/** 类型化读取关系署名声明（替代 `(relations[code] as any)?.participant_slot`）：
 *  未声明（老文档）时返回空串，调用方按各自兼容口径回退，不得把空串当成某种槽位。 */
export function relationParticipantSlot(
  defs: DynamicDefinitions | null | undefined,
  code: string
): ParticipantSlot {
  const v = defs?.relations?.[code]?.participant_slot || "";
  return (PARTICIPANT_SLOTS as string[]).includes(v) ? (v as ParticipantSlot) : "";
}

/** 这条关系是否参与署名展示：以声明为准（person/character 都是署名，peer 不是）；
 *  未声明时返回 null，调用方显式走兼容回退（不得把 null 当 false 藏起来）。 */
export function isCreditRelation(
  defs: DynamicDefinitions | null | undefined,
  code: string
): boolean | null {
  const slot = relationParticipantSlot(defs, code);
  if (!slot) return null;
  return slot !== "peer";
}

export interface SchemeDef {
  names: Record<string, string>;
  /** 闭集三选一：locator / inclusion_attributes / subject_attributes。 */
  slot: string;
  /** 拥有者 kind 白名单，空=不限。 */
  kinds?: string[];
  /** 拥有者动态业务类型白名单，空=不限。 */
  types?: string[];
  /** Track 所属 Medium 的格式词条；空=不限。 */
  medium_formats?: string[];
  /** 该上下文可用子字段码，顺序即展示编辑顺序。 */
  fields: string[];
  /** 必填子集（⊆fields）。 */
  required?: string[];
  /** 仅 locator 有意义：要求至少一个 semantics=content 的子字段有值。 */
  require_range?: boolean;
  enabled: boolean;
}

/** 固定八实体骨架的多语言名称（服务端 /api/catalog/definitions 的 kinds 字段）。
 *  kind 是领域模型的一部分，名称由服务端提供；前端字典只做兜底，不再自带一份名称表。 */
export interface KindDef {
  names: Record<string, string>;
  /** 服务端停用该种类时为 false：浏览入口不再列出它（缺省视为启用）。 */
  enabled?: boolean;
}

export type KindMap = Record<string, KindDef>;

export interface DynamicDefinitions {
  types: Record<string, TypeDef>;
  fields: Record<string, FieldDef>;
  vocabularies: Record<string, VocabularyDef>;
  relations: Record<string, RelationDef>;
  templates: Record<string, TemplateDef>;
  /** 按使用场景配置的结构属性方案；缺省（旧文档无该键）时回退全局组。 */
  schemes?: Record<string, SchemeDef>;
  /** 各层级的"所属与收录结构"规则；缺省（旧文档无该键）时回退服务端内建规则。 */
  structure?: Record<string, StructureRule>;
}

/**
 * effectiveOwnerTypes：与后端 effectiveOwnerTypes 同一口径——声明了就原样用
 * （恒等，不展开）；空 types 才回退到该 kind 的启用类型集合（仅兼容真实旧数据，
 * 新写必须显式声明 types，单候选 kind 由编辑器自动采用、多候选由保存入口拦截），
 * 于是"字段适用范围"与"方案匹配"看到的是同一套类型。回退固定只计启用类型：
 * 方案只管数据录入，不管历史宽容（与后端 kindTypeCodes(kind, false) 一致）。
 */
export function effectiveOwnerTypes(
  defs: DynamicDefinitions | null | undefined,
  ownerKind: string,
  ownerTypes: string[]
): string[] {
  if ((ownerTypes || []).length > 0) return ownerTypes;
  return Object.entries(defs?.types || {})
    .filter(([, t]) => t.enabled && (t.kinds || []).includes(ownerKind))
    .map(([code]) => code)
    .sort();
}

/**
 * kindApplicableFields：该 kind 当前适用字段（启用类型的字段并集，保序去重）。
 * 与后端 attributeKeys 空 types 分支同源（回退仅兼容历史），供历史无类型实体
 * 的"适用字段发现入口"使用：已存属性走兼容展示，这里只列出尚未展示的可加字段。
 * 自由标签 tags 不在此列——它有专用标签输入，不兼任业务分类。
 */
export function kindApplicableFields(
  defs: DynamicDefinitions | null | undefined,
  kind: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of effectiveOwnerTypes(defs, kind, [])) {
    for (const f of defs?.types?.[code]?.fields || []) {
      if (f !== "tags" && !seen.has(f)) {
        seen.add(f);
        out.push(f);
      }
    }
  }
  return out;
}

/**
 * matchSchemes：与后端 matchSchemes 同一口径——slot 相同、kinds 命中拥有者
 * kind（空=命中）、types 与拥有者有效类型有交集（空=命中）且 enabled。
 * 空 types 按有效类型（见 effectiveOwnerTypes）展开后匹配，兼容历史/导入载荷；
 * 带 types 限制的 scheme 启用后，前端收敛结果与后端 effectiveGroupField 一致。
 */
export function matchSchemes(
  defs: DynamicDefinitions | null | undefined,
  slot: string,
  ownerKind: string,
  ownerTypes: string[],
  mediumFormat = ""
): SchemeDef[] {
  const effective = effectiveOwnerTypes(defs, ownerKind, ownerTypes || []);
  const schemes = defs?.schemes || {};
  return Object.values(schemes).filter((s) => {
    if (!s || s.enabled === false || s.slot !== slot) return false;
    if ((s.kinds || []).length > 0 && !s.kinds!.includes(ownerKind)) return false;
    if ((s.medium_formats || []).length > 0 && (ownerKind !== "track" || !s.medium_formats!.includes(mediumFormat))) return false;
    if ((s.types || []).length > 0) {
      if (!effective.some((t) => s.types!.includes(t))) return false;
    }
    return true;
  });
}

/**
 * effectiveSchemeFields：匹配 scheme 的并集 fields（保序去重），顺序即展示
 * 编辑顺序；无匹配时返回空数组，调用方回退显示全部全局子字段。
 */
export function effectiveSchemeFields(matched: SchemeDef[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of matched) {
    for (const k of s.fields || []) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

let cachedDefinitions: DynamicDefinitions | null = null;
// 骨架名称与定义文档同批缓存：两者一起随版本刷新，避免出现"文档换了名字没换"。
let cachedKinds: KindMap = {};
// 已发布定义的版本行 id：后台发布新版本后 id 变化，据此失效缓存。
let cachedVersion = "";
// 版本行 id 的数字形态：编辑器的"基线版本"就是它，必须与文档同源同一份响应，
// 不能让调用方再自己打一次 /catalog/definitions 去取（那就是第二条取数路径）。
let cachedVersionId: number | null = null;
let definitionsPromise: Promise<DynamicDefinitions | null> | null = null;
let revalidating = false;
// 请求序号：只接受不早于已应用序号的响应，防止较早的请求晚到覆盖较新版本。
let requestSeq = 0;
let appliedSeq = 0;
// 订阅者：缓存按版本刷新后逐个通知，已挂载的组件立即拿到新定义，无需整页刷新。
const listeners = new Set<(defs: DynamicDefinitions | null) => void>();

async function loadDefinitions(): Promise<DynamicDefinitions | null> {
  const seq = ++requestSeq;
  const data = await fetch("/api/catalog/definitions", { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (!data?.document) return null;
  if (data.kinds && typeof data.kinds === "object") cachedKinds = data.kinds as KindMap;
  // 乱序响应防护：更早发出的请求（seq 更小）晚到且已被更新响应应用时丢弃。
  if (seq < appliedSeq) return cachedDefinitions;
  appliedSeq = seq;
  const version = String(data.id ?? "");
  const versionId = Number(data.id);
  cachedVersionId = Number.isFinite(versionId) ? versionId : null;
  if (!cachedDefinitions || version !== cachedVersion) {
    cachedVersion = version;
    cachedDefinitions = data.document;
    listeners.forEach((notify) => notify(cachedDefinitions));
  }
  return cachedDefinitions;
}

export async function fetchDefinitions(): Promise<DynamicDefinitions | null> {
  if (cachedDefinitions) {
    // stale-while-revalidate：先返回缓存，后台按版本校验；发布新版本后
    // 下一次进入页面即刷新并通知订阅组件，不阻塞渲染。
    if (!revalidating) {
      revalidating = true;
      loadDefinitions().finally(() => {
        revalidating = false;
      });
    }
    return cachedDefinitions;
  }
  if (!definitionsPromise) {
    definitionsPromise = loadDefinitions().finally(() => {
      definitionsPromise = null;
    });
  }
  return definitionsPromise;
}

// 重新获得焦点时的节流校验：避免短暂切走再切回就连发请求。
let lastFocusCheck = 0;
function revalidateOnFocus() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastFocusCheck < 30_000) return;
  lastFocusCheck = now;
  void fetchDefinitions();
}

// refreshDefinitions 强制按版本重新拉取并等待结果（不走 stale-while-revalidate）。
// 供后台发布成功后调用：必须立刻拿到新版本并通知，不能停在旧缓存上。
export async function refreshDefinitions(): Promise<DynamicDefinitions | null> {
  return loadDefinitions();
}

/**
 * 已发布定义的版本行 id（数字）。刚 await 过 refreshDefinitions() 的调用方可直接读它拿
 * 新基线版本；响应里没有可解析的 id 时为 null（调用方自行决定是否继续）。
 */
export function getPublishedDefinitionId(): number | null {
  return cachedVersionId;
}

export function useDefinitions() {
  const [defs, setDefs] = useState<DynamicDefinitions | null>(cachedDefinitions);
  const [kinds, setKinds] = useState<KindMap>(cachedKinds);
  const [versionId, setVersionId] = useState<number | null>(cachedVersionId);
  const [loading, setLoading] = useState<boolean>(!cachedDefinitions);

  useEffect(() => {
    let mounted = true;
    const listener = (d: DynamicDefinitions | null) => {
      if (mounted) {
        setDefs(d);
        setKinds(cachedKinds);
        setVersionId(cachedVersionId);
        setLoading(false);
      }
    };
    listeners.add(listener);
    // 挂载即校验：无论是否已有缓存都调用 fetchDefinitions()。已有缓存时它走
    // stale-while-revalidate（后台按版本校验并通知），从而"重新进入页面即更新"；
    // 旧实现只在无缓存时请求，发布新定义后已挂载页面永远看不到新版本。
    fetchDefinitions().then((d) => {
      if (mounted) {
        setDefs(d);
        setKinds(cachedKinds);
        setVersionId(cachedVersionId);
        setLoading(false);
      }
    });
    window.addEventListener("focus", revalidateOnFocus);
    document.addEventListener("visibilitychange", revalidateOnFocus);
    return () => {
      mounted = false;
      listeners.delete(listener);
      window.removeEventListener("focus", revalidateOnFocus);
      document.removeEventListener("visibilitychange", revalidateOnFocus);
    };
  }, []);

  // versionId 与 definitions 同批更新（同一次响应解析出来的），供编辑器的基线版本使用。
  return { definitions: defs, kinds, versionId, loading };
}

/**
 * getKindName：实体类型（八骨架 kind）的显示名。
 *
 * 取服务端 kinds 的多语言名，缺失时回退调用方给的兜底文案（通常是前端字典的同名键）。
 * 卡片角标、筛选器、详情页类型徽标都应走这里——不允许各处自己维护一份 kind 名称表，
 * 更不允许把"业务分类"当成类型展示（分类由货架/类型承担，不是 kind）。
 */
export function getKindName(
  kinds: KindMap | null | undefined,
  kind: string,
  locale: string,
  fallback = ""
): string {
  const names = kinds?.[kind]?.names;
  const resolved = resolveLocalizedName(names, locale, "");
  return resolved || fallback || kind;
}

// 结构归属规则：由服务端 definitions.structure 下发，前端据此渲染结构字段与资源区块，
// 不再自己维护"哪个层级挂哪个上级"的清单。
export interface StructureField {
  code: string;
  target_kinds?: string[];
  scoped_by?: string;
  required?: boolean;
}
export interface StructureRule {
  fields?: StructureField[];
  resources?: boolean;
  /** 该层级有"发行对象"（收录主体）列表。 */
  subjects?: boolean;
  /** 该层级有"收录内容"列表。 */
  contents?: boolean;
}

/**
 * resolveKindOptions：骨架层级的可选项——服务端 definitions.kinds 里未停用的种类。
 * 服务端没给出 kinds（旧缓存或接口异常）时退回调用方提供的兜底清单，
 * 这样后台改骨架名/停用种类时前端跟随，同时保留无 definitions 时的可用性。
 */
export function resolveKindOptions(
  kinds: KindMap | null | undefined,
  fallback: string[],
): string[] {
  const codes = Object.keys(kinds || {}).filter(
    (code) => kinds![code]?.enabled !== false,
  );
  return codes.length > 0 ? codes : fallback;
}

export function getTypeName(
  defs: DynamicDefinitions | null | undefined,
  typeCode: string,
  locale: string
): string {
  if (!defs?.types?.[typeCode]) return typeCode;
  return resolveLocalizedName(defs.types[typeCode].names, locale, typeCode);
}

export function getRelationName(
  defs: DynamicDefinitions | null | undefined,
  relType: string,
  isForward: boolean,
  locale: string
): string {
  const rel = defs?.relations?.[relType];
  if (!rel) return relType.replace(/_/g, " ");
  const names = isForward ? rel.names : rel.reverse_names;
  return resolveLocalizedName(names, locale, relType.replace(/_/g, " "));
}

export function getFieldName(
  defs: DynamicDefinitions | null | undefined,
  fieldCode: string,
  locale: string
): string {
  if (!defs?.fields?.[fieldCode]) return fieldCode;
  return resolveLocalizedName(defs.fields[fieldCode].names, locale, fieldCode);
}

export function getTermName(
  defs: DynamicDefinitions | null | undefined,
  vocabCode: string,
  termCode: string,
  locale: string
): string {
  const term = defs?.vocabularies?.[vocabCode]?.terms?.[termCode];
  if (!term) return termCode;
  return resolveLocalizedName(term.names, locale, termCode);
}

/** 自由标签所在词表码：词表由服务端 definitions 下发，前端不自带任何标签翻译表。 */
const TAGS_VOCABULARY = "tags";

/**
 * tagCode：标签的原始值（写库/进 URL 的那个）归一化。
 *
 * attributes.tags 的官方形状是字符串数组；历史与导入数据里出现过 `{name}` 对象，
 * 读取端统一在此兼容。展示端只依赖它做"查词表 + 拼链接"，不改写实体数据。
 */
export function tagCode(tag: unknown): string {
  if (typeof tag === "string") return tag;
  if (tag && typeof tag === "object" && typeof (tag as { name?: unknown }).name === "string") {
    return (tag as { name: string }).name;
  }
  return tag == null ? "" : String(tag);
}

/** 反查键归一化：去空白 + 小写（CJK 无大小写，等于原样比较）。 */
function tagKey(value: string): string {
  return value.trim().toLowerCase();
}

/** 反查索引：精确键（仅去空白）与折叠键（去空白 + 小写）两张表。
 *  分两张表是因为词表里存在只差大小写的同名（live id=29：`film_score` 的 en-US `film score`
 *  与 `film_soundtrack` 的 `Film score`，`symphonic_poem` 与 `symphonic_poem_english` 同理），
 *  只按小写比较会让这类原始值落到大小写不匹配的那个词条上。 */
interface TagIndex {
  exact: Map<string, string>;
  folded: Map<string, string>;
}

/** 反查索引缓存：词表对象 → 索引。
 *  词表随 definitions 版本刷新会换新对象，缓存随之自然失效（无需手动清理）。 */
const tagIndexCache = new WeakMap<object, TagIndex>();

/**
 * tagTermCodes：词表的 term code，按**字典序**排序。
 *
 * 反查遍历一律走它，于是"同名被多个词条声明时命中哪个 term"只由 code 字典序决定，
 * 与 definitions JSON 的键序（`Object.entries` 的插入顺序）无关：把等价词表的键反序写入，
 * 解析结果完全一致（回归测试 `frontend/scripts/tag-i18n-order.test.mjs`）。
 */
function tagTermCodes(terms: VocabularyDef["terms"] | undefined): string[] {
  return Object.keys(terms || {}).sort();
}

/**
 * tagIndex：原始 tag 值 → 词条 code 的反查表，按词表对象只建一次（单次枚举建两张表）。
 *
 * 为什么需要反查：词表两侧可能对不上——term code 是词表自己的 slug，而实体里存的
 * attributes.tags 是历史/导入留下的字面量（`輕小說`、`ライトノベル`、`DIR EN GREY`、`2022年`、`4K`），
 * 两者不必相等，因此除了按 code 精确查，还要能按"某个语种的名字等于原始值"找到词条。
 * 同名被多个词条声明时取**字典序最小**的 term code：遍历顺序来自 tagTermCodes 的排序，
 * 首命中即最小，规则显式、不随定义的键序漂移。
 */
function tagIndex(vocab: VocabularyDef): TagIndex {
  const cached = tagIndexCache.get(vocab);
  if (cached) return cached;
  const exact = new Map<string, string>();
  const folded = new Map<string, string>();
  for (const code of tagTermCodes(vocab.terms)) {
    for (const name of Object.values(vocab.terms?.[code]?.names || {})) {
      if (typeof name !== "string") continue;
      const raw = name.trim();
      const key = tagKey(raw);
      if (!key) continue;
      if (!exact.has(raw)) exact.set(raw, code);
      if (!folded.has(key)) folded.set(key, code);
    }
  }
  const index: TagIndex = { exact, folded };
  tagIndexCache.set(vocab, index);
  return index;
}

/**
 * resolveTagTermCode：原始 tag 命中的 term code（未命中返回空串）。逐级解析：
 *  1. term code 精确命中（`defs.vocabularies.tags.terms[tag]`）；
 *  2. 任一语种的名字**精确大小写**等于原始值；
 *  3. 任一语种的名字**忽略大小写**等于原始值；
 *  同一级内多个词条同名时取字典序最小的 code（见 tagIndex）。
 *
 * 展示请用 getTagName；本函数给回归测试与排障读取"命中了哪个 term"，不返回展示名。
 */
export function resolveTagTermCode(
  defs: DynamicDefinitions | null | undefined,
  tag: unknown
): string {
  const key = tagCode(tag).trim();
  if (!key) return "";
  const vocab = defs?.vocabularies?.[TAGS_VOCABULARY];
  if (!vocab?.terms) return "";
  // 1) term code 精确
  if (vocab.terms[key]) return key;
  // 2) 名字反查：先精确大小写，再折叠大小写
  const index = tagIndex(vocab);
  return index.exact.get(key) || index.folded.get(tagKey(key)) || "";
}

/**
 * getTagName：自由标签的**显示名**——逐级解析（见 resolveTagTermCode）后回退：
 * 仍未命中（新标签、词表没覆盖）时返回原始 tag 字面量，展示端永不因缺词表而空白。
 * 命中后一律走 resolveLocalizedName(term.names, locale, 原始值)，沿用全站既有的语种回退链。
 *
 * 只用于展示：链接参数（/explore?tags=<原始 tag>）、筛选请求、编辑回写必须继续用原始 tag 值
 * （attributes.tags 不做迁移），不得把本地化名写回数据——写回等于伪造数据，且检索参数会对不上。
 */
export function getTagName(
  defs: DynamicDefinitions | null | undefined,
  tag: unknown,
  locale: string
): string {
  const raw = tagCode(tag);
  const code = resolveTagTermCode(defs, tag);
  const term = code ? defs?.vocabularies?.[TAGS_VOCABULARY]?.terms?.[code] : undefined;
  if (!term) return raw;
  return resolveLocalizedName(term.names, locale, raw);
}

/** getTagNames：批量标签展示名，保持入参顺序，空值剔除；用途与限制同 getTagName。 */
export function getTagNames(
  defs: DynamicDefinitions | null | undefined,
  tags: unknown[] | null | undefined,
  locale: string
): string[] {
  return (tags || []).map((tag) => getTagName(defs, tag, locale)).filter((name) => !!name);
}
