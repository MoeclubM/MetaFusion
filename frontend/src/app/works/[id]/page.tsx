"use client";

import styles from "./page.module.css";
import { PageShell } from "@/components/ui/PageShell";
import { classifyLoadFailure, DetailNotFound, DetailUnavailable, type LoadFailureKind } from "@/components/common/DetailLoadStates";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import Link from "next/link";
import { fetchApi, fetchEntityPosts, ConnectedEntityItem, GraphNode, GraphLink } from "@/lib/api";
import { Entity, fetchAllPages, mapLimit, title as entityTitle, type CommunityPost } from "@/components/catalog/api";
import { useDefinitions, getFieldName, getRelationName, getTermName, resolveLocalizedName } from "@/lib/definitions";
import { FieldValue } from "@/components/catalog/TemplateAttributeSections";
import { useAuth } from "@/lib/authContext";
import { useKindRedirect } from "@/lib/useKindRedirect";
import { useI18n } from "@/i18n/I18nProvider";
import { Layers, MessageSquare, Search, ChevronLeft, ChevronRight, ArrowRight, ArrowUpRight, Network, List, ArrowRightLeft, X, Calendar, Tag } from "lucide-react";
import { RevisionHistoryModal } from "@/components/editor/RevisionHistoryModal";
import { EntityMergeModal } from "@/components/editor/EntityMergeModal";
import { EntityActionToolbar } from "@/components/entity/EntityActionToolbar";
import FavoriteButton from "@/components/FavoriteButton";
import { getForumEntityUrl } from "@/lib/services";
import { EntityCommentComposer } from "@/components/community/EntityCommentComposer";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import { useCompareBasket } from "@/lib/compareBasket";
import { LocalizedTitleGroups } from "@/components/entity/LocalizedTitleGroups";
import { DetailTabs, DetailTab } from "@/components/catalog/DetailTabs";
import { GroupedRelations } from "@/components/entity/RelationsList";
import { ExternalAuthorityLinks } from "@/components/entity/ExternalAuthorityLinks";
import { WorkFacts, entityBadges } from "@/components/work/WorkFacts";
import dynamic from "next/dynamic";
import { StaffCharacterSection, StaffCredit } from "@/components/entity/StaffCharacterSection";
import { WorkContentDirectory } from "@/components/work/WorkContentDirectory";
const InteractiveRelationGraph = dynamic(() => import("@/components/graph/InteractiveRelationGraph").then(m => m.InteractiveRelationGraph), { ssr: false });

// 关系条目（/catalog/entities/:id/relations 的 items）。
type RelationItem = { id: string; type: string; source_id: string; target_id: string; attributes?: Record<string, any> };

const attrText = (v: any): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  return "";
};

export default function WorkDirectoryPage() {
 const params = useParams();
 const router = useRouter();
 const workId = params.id as string;
 const { user } = useAuth();
 const { t, tr, locale } = useI18n();
 const titleOrder = useTitleDisplayOrder();

 const [work, setWork] = useState<Entity | null>(null);
 const [relations, setRelations] = useState<RelationItem[]>([]);
 const [relEntities, setRelEntities] = useState<Record<string, Entity>>({});
 const [relationViewMode, setRelationViewMode] = useState<"graph" | "list">("list");
 const [releases, setReleases] = useState<Entity[]>([]);
 const [releaseEntities, setReleaseEntities] = useState<Entity[]>([]);
 // 每个发行版的介质格式计数（按实际 Medium 聚合）：CD+BD 组合不再被"首个格式"吞掉。
 const [releaseFormatCounts, setReleaseFormatCounts] = useState<Record<string, Record<string, number>>>({});
 // 筛选条件：键为字段码，值选中项。字段集合由模板 facet_fields 声明。
 const [facetValues, setFacetValues] = useState<Record<string, string>>({});
 // 篮子状态与跨标签页同步统一走 lib/compareBasket.ts：另一页加入/移除后本页不刷新即一致。
 const { basket: compareSelected, toggle: toggleCompare } = useCompareBasket();
 const [page, setPage] = useState(1);
 const pageSize = 10;
 const [q, setQ] = useState("");
 const [qInput, setQInput] = useState("");
 const [topics, setTopics] = useState<CommunityPost[]>([]);
 const [loadingWork, setLoadingWork] = useState(true);
 // 取数失败与"真的没有这个条目"是两种状态：之前 catch 只 console.error，work 保持 null，
 // 于是 429/5xx/断网都被渲染成「未找到该作品。」——用户以为库里没有，页面也没有重试出口。
 const [loadError, setLoadError] = useState<LoadFailureKind | "">("");
 const [loadingReleases, setLoadingReleases] = useState(true);
 const [releasesFailed, setReleasesFailed] = useState(false);
 // 路由隐含的种类与实际 kind 不符时的收敛（见 lib/useKindRedirect）：/works/:id 拿到
 // release/medium/track 等任何 id 都照作品模板渲染，会把同一个实体显示成矛盾的类型。
 const [kindMismatch, setKindMismatch] = useState<string | null>(null);

 // Revision History, and Merge Modals（编辑改为跳转通用编辑页 /catalog/:id?edit=1）
 const [isHistoryOpen, setIsHistoryOpen] = useState(false);
 const [isMergeOpen, setIsMergeOpen] = useState(false);

 const loadWork = async () => {
 setLoadingWork(true);
 setLoadError("");
 try {
 const data = await fetchApi<Entity>(`/catalog/entities/${workId}`);
 if (data.kind !== "work") {
 // 关系/发行版都是"按作品模板取数据"，种类不符时一条都不发，直接收敛。
 setKindMismatch(data.kind || "unknown");
 return;
 }
 setKindMismatch(null);
 setWork(data);
 // 关系与对端实体一次取回（服务端批量解析），前端不再逐条请求。
 const r = await fetchApi<{ items: RelationItem[]; entities: Record<string, Entity> }>(`/catalog/entities/${workId}/relations`);
 setRelations(r.items || []);
 setRelEntities(r.entities || {});
 } catch (e) {
 setLoadError(classifyLoadFailure(e));
 } finally {
 setLoadingWork(false);
 }
 };

 // 只负责拉全量发行与其介质格式汇总。关键词与 facet 过滤、分页都在渲染侧按完整候选集
 // 求值：否则"先分页后筛选"会漏掉其它页的命中，总数也不会随筛选变化。
 const loadReleases = async () => {
 setLoadingReleases(true);
 setReleasesFailed(false);
 try {
 const entities = await fetchAllPages<Entity>(`/catalog/entities?kind=release&work_id=${encodeURIComponent(workId)}`);
 // 载体格式从实际 Medium 全量聚合（受并发上限约束），不再截断在首屏 50 条。
 const counts = await mapLimit(entities, 8, async (e) => {
 try {
 const ms = await fetchAllPages<Entity>(`/catalog/entities?kind=medium&release_id=${encodeURIComponent(e.id!)}`);
 const c: Record<string, number> = {};
 for (const m of ms) {
 const f = String(m.attributes?.format || "").trim();
 if (f) c[f] = (c[f] || 0) + 1;
 }
 return c;
 } catch { return {}; }
 });
 const fmtMap: Record<string, Record<string, number>> = {};
 entities.forEach((e, i) => { fmtMap[e.id!] = counts[i] || {}; });
 setReleaseEntities(entities);
 setReleaseFormatCounts(fmtMap);
 } catch {
 // 列表取数失败不能落成「暂无发行版。」：那是在替服务端断言"这部作品没有发行版"。
 setReleasesFailed(true);
 } finally {
 setLoadingReleases(false);
 }
 };

 // 发行版列表的列与可筛选字段：均由发行版模板声明（columns / facet_fields），
 // 后台可改，代码不写死 edition_type/format/country 等字段码。
 // 作品自身的信息面板不在这里取字段码：WorkFacts 会按作品类型引用的模板渲染。
const { definitions: defs } = useDefinitions();
// 作品自身类型引用的模板：目录形态（tree/list）等展示声明从这里取，代码不写死。
const workTemplate = useMemo(() => {
  const codes = work?.types || [];
  for (const code of codes) {
    const tpl = defs?.templates?.[defs?.types?.[code]?.template || ""];
    if (tpl) return tpl as any;
  }
  return undefined;
}, [defs, work]);
// 发行版列表的列与筛选字段由**实际发行类型**引用的模板解析（多类型取并集），
// 后台新增或替换发行类型即刻生效；列表未加载时回退到声明 kind=release 的启用类型。
// 不再写死业务类型码 "release"：类型码可被后台改名，模板必须跟着实际类型走。
const releaseTypeCodes = useMemo(() => {
  const used = new Set<string>();
  for (const e of releaseEntities) {
    for (const c of e.types || []) if (defs?.types?.[c]) used.add(c);
  }
  if (used.size === 0) {
    for (const [code, type] of Object.entries(defs?.types || {})) {
      if (type?.enabled !== false && (type?.kinds || []).includes("release")) used.add(code);
    }
  }
  return Array.from(used);
}, [defs, releaseEntities]);
const releaseTemplates = useMemo(
  () =>
    (Array.from(
      new Set(
        releaseTypeCodes
          .map((c) => defs?.types?.[c]?.template)
          .filter(Boolean) as string[]
      )
    ).map((code) => defs?.templates?.[code]).filter(Boolean) as any[]),
  [defs, releaseTypeCodes]
);
const releaseColumns = useMemo(
  () =>
    Array.from(new Set(releaseTemplates.flatMap((tpl: any) => tpl.columns || []))).filter(
      (c) => !!defs?.fields?.[c]
    ),
  [defs, releaseTemplates]
);
const releaseFacets = useMemo(
  () =>
    Array.from(new Set(releaseTemplates.flatMap((tpl: any) => tpl.facet_fields || []))).filter(
      (c) => !!defs?.fields?.[c]
    ),
  [defs, releaseTemplates]
);

 // facet 字段的候选值：先看发行版自身属性，format 再并入实际 Medium 聚合出的格式集合。
 // 多介质发行版（CD＋BD）应能被任一组成格式筛中，因此匹配按"候选列表包含"而不是全等。
 // 必须先于 filteredReleases 声明：其回调在渲染阶段同步求值，引用后声明的 const 会命中 TDZ。
 const facetCandidatesOf = (code: string, e: Entity): string[] => {
 const own = e.attributes?.[code];
 const ownList = own !== undefined && own !== null && own !== "" ? [String(own).trim()] : [];
 if (code !== "format") return ownList;
 const derived = Object.keys(releaseFormatCounts[e.id!] || {});
 return Array.from(new Set([...ownList, ...derived]));
 };
 // 某 facet 的全部候选值（来自全量发行版集合）。
 const facetOptionsOf = (code: string) =>
 Array.from(new Set(releaseEntities.flatMap((e) => facetCandidatesOf(code, e)).filter(Boolean)));

 // 介质格式汇总展示（"CD×1＋BD×1"）：仅当有实际 Medium 聚合结果时返回；
 // 无载体数据时返回空串，由调用方回退发行版自身 format 属性的正常渲染。
 const formatSummaryOf = (e: Entity): string => {
 const counts = releaseFormatCounts[e.id!] || {};
 const entries = Object.entries(counts);
 if (entries.length === 0) return "";
 const joiner = locale.startsWith("zh") ? "＋" : " + ";
 return entries
 .map(([code, n]) => {
 const label = getTermName(defs, "format", code, locale);
 return `${label !== code ? label : code}×${n}`;
 })
 .join(joiner);
 };

 // 关系类型本地化名：统一走 getRelationName（服务端 definitions 优先，回退链含
 // zh-TW / ja-JP，最后退关系码），不再自造只认 locale/zh-CN/en-US 的三档回退。
 // reverse=true 取 reverse_names：当前实体是关系终点时必须用反向名，否则
 // "改编自/被改编为""翻唱自/被翻唱为"这类成对关系会显示反。
 const relationName = (code: string, reverse = false): string =>
 getRelationName(defs, code, !reverse, locale);

 // 关联条目列表（GroupedRelations 消费）。
 const connected = useMemo<ConnectedEntityItem[]>(() => {
 if (!work?.id) return [];
 const out: ConnectedEntityItem[] = [];
 for (const r of relations) {
 const forward = r.source_id === work.id;
 const otherId = forward ? r.target_id : r.source_id;
 const other = relEntities[otherId];
 if (!other) continue;
 // 正向名标识关系类型本身；label 按方向取正向/反向名——反向关系沿用正向文案
 // 会把"改编自/被改编为""翻唱自/被翻唱为"显示反。relation_id 保留边身份，
 // 同一对端多条署名边（适用章节/语言/职务不同）才区分得开。
 const name = relationName(r.type);
 out.push({
 entity_id: otherId,
 entity_name: other.title,
 entity_type: other.kind,
 cover_url: other.pictures?.[0]?.url,
 relationship_type: r.type,
 relationship_name: name,
 direction: forward ? "forward" : "reverse",
 label: forward ? name : relationName(r.type, true),
 relation_id: r.id,
 attributes: r.attributes || {},
 });
 }
 return out;
 }, [work, relations, relEntities, defs, locale]);

 // 演职员与角色（StaffCharacterSection 消费结构化条目，不再做字符串配对）。
 const staffCredits = useMemo<StaffCredit[]>(() => {
 if (!work?.id) return [];
 const out: StaffCredit[] = [];
 for (const r of relations) {
 if (r.source_id === work.id) {
 const target = relEntities[r.target_id];
 if (!target || target.kind !== "agent") continue;
 const credit: StaffCredit = {
 id: r.id,
 relationType: r.type,
 relationLabel: relationName(r.type),
 creditRole: attrText(r.attributes?.credit_role) || undefined,
 agent: { id: target.id!, name: target.title || "", avatarUrl: target.pictures?.[0]?.url, types: target.types || [] },
 };
 if (attrText(r.attributes?.character)) {
 const chId = attrText(r.attributes?.character);
 const ch = chId ? relEntities[chId] : undefined;
 if (ch) {
 credit.character = { id: ch.id, name: ch.title, avatarUrl: ch.pictures?.[0]?.url };
 }
 // 配音上下文：language 是自由文本字段（非受控词表），context 是实体引用，
 // 两者共同区分同一角色在不同语言/篇目下的多版配音。
 credit.language = attrText(r.attributes?.language) || undefined;
 const ctxId = attrText(r.attributes?.context);
 credit.contextLabel = (ctxId ? relEntities[ctxId]?.title : "") || undefined;
 }
 out.push(credit);
 } else if (r.source_id !== work.id) {
 // 登场角色：agent(角色) → work，方向与署名关系相反。
 // 番位码读 attributes.character_rank：番位词表是 character_rank（main/supporting/guest/
 // ensemble/narrator/cameo），attributes.role 属"内容用途"词表（primary/supplement/extra），
 // 只在兼容早期数据时读，不当作番位语义。
 const src = relEntities[r.source_id];
 if (!src || src.kind !== "agent") continue;
 const rankFromVocab = attrText(r.attributes?.character_rank);
 const rankCode = rankFromVocab || attrText(r.attributes?.role);
 // 番位名以服务端 character_rank 词表为准（四语、后台改词即刻生效），字典键只作兜底，
 // 历史 role 码不进 role 词表（语义不同），最后退原始码。
 const rankTerm = rankFromVocab ? getTermName(defs, "character_rank", rankCode, locale) : "";
 const rankLabel = !rankCode
 ? ""
 : rankTerm && rankTerm !== rankCode
 ? rankTerm
 : tr(`entity.characterRank.${rankCode}`, rankCode);
 out.push({
 id: r.id,
 relationType: r.type,
 relationLabel: relationName(r.type),
 creditRole: attrText(r.attributes?.credit_role) || undefined,
 agent: { id: src.id!, name: src.title || "", avatarUrl: src.pictures?.[0]?.url, types: src.types || [] },
 // rankCode 供展示层按数据码判定（主角 = main），不去嗅探本地化文案。
 character: {
 id: src.id!,
 name: src.title || "",
 avatarUrl: src.pictures?.[0]?.url,
 rankLabel: rankLabel && rankLabel !== rankCode ? rankLabel : undefined,
 rankCode: rankCode || undefined,
 },
 });
 }
 }
 return out;
 }, [work, relations, relEntities, defs, locale]);

 // 关系图谱拓扑：中心作品 + 关系对端，本地构建（无需独立 graph 端点）。
 const graphData = useMemo<{ nodes: GraphNode[]; links: GraphLink[] } | null>(() => {
 if (!work) return null;
 const nodes: GraphNode[] = [{ id: work.id!, name: work.title || "", type: "work", category: "work", level: 0, cover_image_url: work.pictures?.[0]?.url, status: work.status }];
 const inGraph = new Set([work.id]);
 const links: GraphLink[] = [];
 for (const r of relations) {
 const otherId = r.source_id === work.id ? r.target_id : r.source_id;
 const other = relEntities[otherId];
 if (!other) continue;
 if (!inGraph.has(otherId)) {
 inGraph.add(otherId);
 nodes.push({ id: otherId, name: other.title, type: other.kind, category: other.kind, level: 1, cover_image_url: other.pictures?.[0]?.url, status: other.status });
 }
 links.push({
 source: r.source_id,
 target: r.target_id,
 type: r.type,
 label: relationName(r.type),
 source_type: relEntities[r.source_id]?.kind,
 target_type: relEntities[r.target_id]?.kind,
 });
 }
 return { nodes, links };
 }, [work, relations, relEntities, defs, locale]);

 // 关键词与 facet 都作用在完整候选集上，再对结果分页；关键词走本地过滤，不必每次输入都重拉全量。
 const filteredReleases = useMemo(() => {
 const kw = q.trim().toLowerCase();
 return releaseEntities.filter((e) => {
 if (kw && !((e.title || "").toLowerCase().includes(kw) || JSON.stringify(e.attributes || {}).toLowerCase().includes(kw))) return false;
 return releaseFacets.every((code) => {
 const want = facetValues[code];
 if (!want) return true;
 return facetCandidatesOf(code, e).includes(want);
 });
 });
 }, [releaseEntities, q, facetValues, releaseFacets, releaseFormatCounts]);
 const total = filteredReleases.length;
 const totalPages = Math.max(1, Math.ceil(total / pageSize));
 const pagedReleases = useMemo(
 () => filteredReleases.slice((page - 1) * pageSize, page * pageSize),
 [filteredReleases, page],
 );


 // 关联评论：展示该作品下的评论（与论坛主题区分——评论锚定条目，主题独立成文）。
 // 短评端点与响应形状由 lib/api/community.ts 的包装负责，本页不再自己拼 URL。
 // 抽成函数是为了让发布器发表成功后回读：id/时间只用服务端返回值，不在前端自造。
 const loadTopics = async () => {
 if (!workId) return;
 try {
 const items = await fetchEntityPosts(workId);
 setTopics(items.slice(0, 5));
 } catch {
 // 评论取不到不影响条目本身：保持列表状态、不弹错、不阻断页面。
 }
 };

 useEffect(() => {
 if (!workId) return;
 loadWork();
 loadTopics();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [workId]);

 useEffect(() => {
 // 种类不符时这一页马上要被规范路由替换，别再按作品拉一遍发行版列表。
 if (!workId || kindMismatch) return;
 loadReleases();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [workId, kindMismatch]);

 // 讨论分节已不在标签栏（id="discussion" 现在是普通锚点）。客户端渲染下浏览器
 // 处理 hash 时元素还不存在，旧链接 #discussion 会停在页首；内容就绪后补一次滚动。
 useEffect(() => {
 if (loadingWork || typeof window === "undefined") return;
 const h = decodeURIComponent(window.location.hash.replace(/^#/, ""));
 if (!h) return;
 const el = document.getElementById(h);
 if (el) el.scrollIntoView({ block: "start" });
 }, [loadingWork, topics.length]);

 const onSearch = (e: React.FormEvent) => {
 e.preventDefault();
 setPage(1);
 setQ(qInput);
 };

 // 筛选/搜索后总数变小可能让当前页越界，回退到最后一页，避免停在空白页。
 useEffect(() => {
 if (page > totalPages) setPage(totalPages);
 }, [page, totalPages]);

 // 正在收敛到规范路由：停在加载态，绝不按作品模板渲染别的种类。
 const redirecting = useKindRedirect("work", kindMismatch, workId);

 if (loadingWork || redirecting) {
 return <div className="min-h-screen bg-background relative flex flex-col overflow-clip"><div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden /><div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden /><div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden /><div className="relative z-10 min-h-screen grid place-items-center text-sm text-text-faint">{t("work.detail.loading")}</div></div>;
 }

 if (!work) {
 return (
 <div className="min-h-screen bg-background relative flex flex-col overflow-clip">
 <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
 <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />
 <Navbar />
 {loadError === "not_found" || loadError === "invalid" ? (
 <DetailNotFound title={t("common.notFoundWork")} />
 ) : (
 // 429 / 5xx / 断网：说"暂时取不到"并给重试，不替服务端断言条目不存在。
 <DetailUnavailable kind={loadError === "rate_limited" ? "rate_limited" : "unavailable"} onRetry={() => void loadWork()} />
 )}
 </div>
 );
 }

 const title = entityTitle(work, locale);
 // 简介取原语言行，缺失回退任一非空简介（统一 DTO 无顶层 summary）。
 const summary = (() => {
 const trs = work.translations || {};
 if (work.original_language && attrText(trs[work.original_language]?.summary)) return attrText(trs[work.original_language].summary);
 for (const tr of Object.values(trs)) {
 if (attrText(tr?.summary)) return attrText(tr.summary);
 }
 return "";
 })();
 const tags = Array.isArray(work.attributes?.tags) ? (work.attributes?.tags as any[]).map((v) => String(v)).filter(Boolean) : [];
 const coverUrl = work.pictures?.[0]?.url;
 // 标题旁的事实徽章（发行日期、平台、话数、放送电视台…）全部由模板声明决定。
 const badges = entityBadges(work, defs, locale);

 return (
 <div className="min-h-screen bg-background text-foreground">
 <Navbar />
 <PageShell
   width="page"
   contentClassName={styles.page}
   header={
   <div className={styles.page}>
   <div className={styles.breadcrumb}>
     <Link href="/explore">{t("work.detail.explore")}</Link><span>/</span><span>{title}</span>
   </div>
   <header className={styles.header}>
     <div className={styles.eyebrow}>
       <span>{t("work.detail.workBadge")}</span>
     </div>
     <h1>{title}</h1>
     {badges.length > 0 && (
       <div className={styles.badges}>
         {badges.map((b, i) => (
           <span key={i}>
             {b.kind === "date" ? <Calendar size={12} /> : <Tag size={12} />}
             {b.text}
           </span>
         ))}
       </div>
     )}
     <LocalizedTitleGroups
       translations={work.translations}
       originalLanguage={work.original_language}
       displayTitle={title}
       extraKnown={[work.title]}
       className="mt-1.5 space-y-0.5"
       itemClassName="font-mono text-sm text-text-muted"
     />
     <div className={styles.headerBottom}>
       <EntityActionToolbar onEdit={() => router.push(`/catalog/${work.id}?edit=1`)} onHistory={() => setIsHistoryOpen(true)}
         onMerge={() => setIsMergeOpen(true)} entityTypeLabel={t("entity.toolbar.work")}>
         <FavoriteButton targetType="work" targetId={work.id!} />
       </EntityActionToolbar>
     </div>
   </header>
   </div>
   }
 >
   <div className={styles.layout}>
     <aside className={styles.sidebar}>
       <div className={styles.cover}>
         <AdaptiveCover src={coverUrl} alt={title} title={title}
           id={work.id} tags={tags} className="rounded-md overflow-hidden border border-line" />
       </div>
       <section className={styles.facts}>
         <h2>{t("work.detail.information")}</h2>
         {/* 作品信息按作品自身类型引用的模板渲染；过去这里传的是发行版 definitions，
             字段集合与次序都不匹配，导致作品字段显示错配或缺失。 */}
         <WorkFacts entity={work} defs={defs} locale={locale} />
       </section>
       {tags.length > 0 && <section>
         <h2>{t("work.detail.tagsHeading")}</h2>
         <div className={styles.tags}>{tags.map(tag => <Link key={tag} href={`/explore?tags=${encodeURIComponent(tag)}`}>{tag}</Link>)}</div>
       </section>}
       {work.external_ids && Object.keys(work.external_ids).length > 0 && <section>
         <h2>{t("work.detail.externalHeading")}</h2>
         <ExternalAuthorityLinks externalIds={work.external_ids} category="work" />
       </section>}
     </aside>
     <div className={styles.content}>
       <DetailTabs
         ariaLabel={t("work.detail.pageNavigation")}
         tabs={[
           {
             id: "overview",
             label: t("work.detail.overview"),
             content: (
               <section className={styles.section}>
       <h2 className={styles.sectionTitle}>{t("work.detail.overview")}</h2>
       <p className={styles.summary}>{summary || t("work.detail.noSummary")}</p>
               </section>
             ),
           },
           {
             id: "staff",
             label: t("work.detail.staffAndCharacters"),
             visible: staffCredits.length > 0,
             content: (
               <section className={styles.section}>
       <h2 className={styles.sectionTitle}>{t("work.detail.staffAndCharacters")}</h2>
       <StaffCharacterSection credits={staffCredits} />
               </section>
             ),
           },
           {
             id: "contents",
             label: t("work.contents.title"),
             content: (
               <section className={styles.section}>
                 <WorkContentDirectory workId={work.id!} directory={workTemplate?.directory} />
               </section>
             ),
           },
           {
             id: "relations",
             label: t("work.detail.relations"),
             visible: connected.length > 0 || !!(graphData && graphData.nodes.length > 1),
             content: (
             <section className={styles.section}>
            {(relationViewMode === "graph" || connected.length === 0) && graphData && graphData.nodes.length > 0 ? (
              <InteractiveRelationGraph
                centerEntityId={work.id!}
                centerEntityType="work"
                orientation="work"
                nodes={graphData.nodes}
                links={graphData.links}
                height={400}
                title={t("graph.titleWork")}
                headerRightExtra={
                  connected.length > 0 ? (
                    <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 border border-border/50 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setRelationViewMode("graph")}
                        className="px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all bg-background text-foreground shadow-xs"
                      >
                        <Network className="w-3 h-3" />
                        <span>{t("graph.viewGraph")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelationViewMode("list")}
                        className="px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all text-muted-foreground hover:text-foreground"
                      >
                        <List className="w-3 h-3" />
                        <span>{t("graph.viewList")}</span>
                      </button>
                    </div>
                  ) : null
                }
              />
            ) : (
              <Card padding="section" className={`${styles.flatBlock} space-y-3`}>
                <SectionTitle
                  icon={<Network className="w-4 h-4 text-primary" strokeWidth={1.5} />}
                  actions={
                    graphData && graphData.nodes.length > 0 ? (
                    <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 border border-border/50 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setRelationViewMode("graph")}
                        className="px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all text-muted-foreground hover:text-foreground"
                      >
                        <Network className="w-3 h-3" />
                        <span>{t("graph.viewGraph")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelationViewMode("list")}
                        className="px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all bg-background text-foreground shadow-xs"
                      >
                        <List className="w-3 h-3" />
                        <span>{t("graph.viewList")}</span>
                      </button>
                    </div>
                    ) : null
                  }
                >
                  {t("work.detail.relations")}
                </SectionTitle>
                <GroupedRelations
                  items={connected}
                  groupOrder={(workTemplate as any)?.relation_groups}
                />
              </Card>
            )}
             </section>
             ),
           },
           {
             id: "releases",
             label: t("work.detail.releaseCatalog"),
             badge: total > 0 ? String(total) : undefined,
             content: (
 <section id="releases" className={styles.section}>
 <div className="px-3.5 sm:px-4 py-3 border-b border-line-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
 <div className="flex items-center gap-2">
 <span className="w-9 h-9 max-sm:min-h-[44px] grid place-items-center rounded-md bg-sky-500/10 border border-sky-500/20">
 <Layers className="w-4 h-4 text-sky-500" strokeWidth={1.5} />
 </span>
 <h2 className="font-display text-base font-bold tracking-tight text-text-strong">{t("work.detail.releaseCatalog")}</h2>
 <span className="text-sm text-text-faint">{t("work.detail.totalReleases", { count: total })}</span>
 </div>
 <form onSubmit={onSearch} className="relative w-full sm:w-auto">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" strokeWidth={1.5} />
 <input
 value={qInput}
 onChange={(e) => setQInput(e.target.value)}
 aria-label={t("work.detail.searchPlaceholder")}
 placeholder={t("work.detail.searchPlaceholder")}
 className="pl-11 pr-3.5 h-9 max-sm:min-h-[44px] w-full sm:w-48 bg-black/[0.03] dark:bg-white/[0.04] border border-line rounded-md text-sm text-text-strong placeholder:text-text-muted focus:outline-none focus:border-primary/50 font-mono"
 />
 </form>
 </div>

 {loadingReleases ? (
 <div className="p-8 text-center text-sm text-text-faint">{t("work.detail.loadingReleases")}</div>
 ) : releasesFailed ? (
 <div role="alert" className="p-8 text-center text-sm space-y-2">
 <p className="text-amber-700 dark:text-warn-soft">{t("catalog.listFailed")}</p>
 <button type="button" onClick={() => void loadReleases()} className="text-xs font-mono text-primary hover:underline cursor-pointer">
 {t("catalog.retry")}
 </button>
 </div>
 ) : releaseEntities.length === 0 ? (
 <Card padding="none" className="border-dashed">
   <div className="p-8 text-center text-sm text-text-faint">{t("work.detail.noReleases")}{q ? t("work.detail.noReleasesHint") : ""}</div>
 </Card>
 ) : (
 <>
 <div className="px-3.5 sm:px-4 py-2.5 border-b border-line-subtle flex flex-col lg:flex-row lg:items-center gap-2.5 bg-black/[0.01] dark:bg-white/[0.01]">
 <div className="flex flex-wrap items-center gap-2">
 {releaseFacets.map((code) => (
 <label key={code} className="inline-flex items-center gap-1.5 text-xs text-text-faint">
 <span className="font-mono">{getFieldName(defs, code, locale)}</span>
 <select value={facetValues[code] || ""} onChange={(e) => { setFacetValues((prev) => ({ ...prev, [code]: e.target.value })); setPage(1); }} className="h-9 max-sm:min-h-[44px] px-2 rounded-md bg-black/[0.03] dark:bg-white/[0.06] border border-line text-xs text-text-strong">
 <option value="">{t("common.all")}</option>
 {facetOptionsOf(code).map((o) => {
 const def: any = defs?.fields?.[code];
 const label = def?.type === "enum" && def?.vocabulary ? getTermName(defs, def.vocabulary, o, locale) : o;
 return <option key={o} value={o}>{label}</option>;
 })}
 </select>
 </label>
 ))}
 {Object.values(facetValues).some(Boolean) && (
 <button onClick={() => setFacetValues({})} className="inline-flex items-center gap-1 h-9 px-2.5 rounded-md text-xs text-text-faint hover:text-primary">
 <X className="w-3.5 h-3.5" strokeWidth={1.6} /><span>{t("work.detail.clearFilters")}</span>
 </button>
 )}
 </div>
 {compareSelected.length > 0 && (
 <Link href={`/compare?ids=${encodeURIComponent(compareSelected.join(","))}`} className="lg:ml-auto inline-flex items-center gap-1.5 h-9 max-sm:min-h-[44px] px-3 rounded-md bg-primary text-white text-xs font-semibold hover:opacity-90 w-fit">
 <ArrowRightLeft className="w-3.5 h-3.5" strokeWidth={1.6} /><span>{t("work.detail.compareOpenCount", { count: compareSelected.length })}</span>
 </Link>
 )}
 </div>
 {filteredReleases.length === 0 ? (
 <div className="p-8 text-center text-sm text-text-faint">{t("work.detail.noFilterResult")}</div>
 ) : (
 <>
 {/* 发行版列表的列由模板 columns 声明（后台可改），不再写死字段码 */}
 {releaseColumns.length > 0 && (
 <div className="hidden sm:block overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead className="bg-surfaceSubtle border-b border-line-subtle text-xs uppercase tracking-wider text-text-faint">
 <tr>
 <th className="py-2.5 px-2 font-medium w-10" aria-label={t("work.detail.compareSelect")} />
 <th className="py-2.5 px-3.5 font-medium">{t("work.detail.tableRelease")}</th>
 {releaseColumns.map((code) => (
 <th key={code} className="py-2.5 px-3.5 font-medium">
 {getFieldName(defs, code, locale)}
 </th>
 ))}
 </tr>
 </thead>
 <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
 {pagedReleases.map((rel) => (
 <tr key={rel.id} className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft">
 <td className="py-2.5 px-2">
 <input type="checkbox" aria-label={t("work.detail.compareSelectName", { name: entityTitle(rel, locale) })} checked={compareSelected.includes(rel.id!)} onChange={() => toggleCompare(rel.id!)} className="w-4 h-4 rounded accent-primary cursor-pointer" />
 </td>
 <td className="py-2.5 px-3.5">
 <Link href={`/releases/${rel.id}`} className="font-semibold text-text-strong hover:text-primary inline-flex items-center gap-1.5">
 {entityTitle(rel, locale)} <ArrowUpRight className="w-3.5 h-3.5 text-text-muted" strokeWidth={1.6} />
 </Link>
 </td>
 {releaseColumns.map((code) => (
 <td key={code} className="py-2.5 px-3.5 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
 {code === "format" && formatSummaryOf(rel) ? (
 <span className="font-mono">{formatSummaryOf(rel)}</span>
 ) : rel.attributes?.[code] ? (
 <FieldValue defs={defs} code={code} value={rel.attributes[code]} locale={locale} />
 ) : ("—")}
 </td>
 ))}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 <div className="sm:hidden divide-y divide-black/5 dark:divide-white/[0.06]">
 {pagedReleases.map((rel) => (
 <div key={rel.id} className="px-3.5 py-3 flex items-start gap-2.5">
 <input type="checkbox" aria-label={t("work.detail.compareSelectName", { name: entityTitle(rel, locale) })} checked={compareSelected.includes(rel.id!)} onChange={() => toggleCompare(rel.id!)} className="mt-1 w-5 h-5 rounded accent-primary cursor-pointer shrink-0" />
 <Link href={`/releases/${rel.id}`} className="min-w-0 flex-1 space-y-1">
 <div className="font-semibold text-text-strong text-sm leading-tight line-clamp-2">{entityTitle(rel, locale)}</div>
                      <div className="text-xs text-text-faint truncate">
 {releaseColumns.map((code) => (code === "format" && formatSummaryOf(rel)) || attributeText(defs, code, rel.attributes?.[code], locale)).filter(Boolean).join(" · ") || t("work.detail.noEditionMeta")}
 </div>
 </Link>
 </div>
 ))}
 </div>
 {totalPages > 1 && (
 <div className="px-3.5 sm:px-4 py-3 border-t border-line-subtle flex items-center justify-end gap-2">
 <span className="font-mono text-[11px] text-text-faint">{t("common.pagination", { page, total: totalPages })}</span>
 <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t("pagination.prev")} className="w-8 h-8 grid place-items-center rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-line disabled:opacity-40 hover:bg-black/[0.08] dark:hover:bg-white/[0.10]">
 <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.6} />
 </button>
 <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label={t("pagination.next")} className="w-8 h-8 grid place-items-center rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-line disabled:opacity-40 hover:bg-black/[0.08] dark:hover:bg-white/[0.10]">
 <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.6} />
 </button>
 </div>
 )}
 </>
 )}
 </>
 )}
 </section>
             ),
           },
         ] as DetailTab[]}
       />
     </div>

 <section id="discussion" className={`${styles.section} mt-8`}>
 <div className="flex items-center justify-between border-b border-line-subtle pb-2">
 <h3 className="font-display text-sm font-bold text-text-strong flex items-center gap-2">
 <MessageSquare className="w-4 h-4 text-emerald-500" strokeWidth={1.5} />
 <span>{t("work.detail.relatedTopics")}</span>
 <span className="text-sm font-normal text-text-faint">({topics.length})</span>
 </h3>
 <Link href={getForumEntityUrl(workId, "comment")} className="text-sm text-primary hover:underline inline-flex items-center gap-0.5">
 <span>{t("work.detail.enterForum")}</span>
 <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
 </Link>
 </div>
 {/* 发布器与列表同一分节：文案承诺"在下方发表"，入口就必须真的在下方。 */}
 <div className="mt-3">
 <EntityCommentComposer entityId={workId} onPosted={loadTopics} />
 </div>
 {topics.length === 0 ? (
 <p className="text-sm text-text-faint mt-3">{t("work.detail.noRelatedTopics")}</p>
 ) : (
 <div className="divide-y divide-black/5 dark:divide-white/[0.06] mt-3">
 {/* 评论就地展示，不跳"文章页"——评论与论坛主题是两类东西。 */}
 {topics.slice(0, 3).map((c) => (
 <div key={c.id} className="py-2.5 flex items-start justify-between gap-3 px-2.5">
 <span className="text-sm text-text-strong line-clamp-2 min-w-0">{c.body}</span>
 <span className="text-xs text-text-faint shrink-0">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ""}</span>
 </div>
 ))}
 </div>
 )}
 </section>
   </div>
 </PageShell>

 {/* Revision History & Diff Modal */}
 <RevisionHistoryModal
 isOpen={isHistoryOpen}
 onClose={() => setIsHistoryOpen(false)}
 targetType="work"
 targetId={work.id!}
 entityTitle={title}
 />

 {/* Entity Merge Modal */}
 <EntityMergeModal
 isOpen={isMergeOpen}
 onClose={() => setIsMergeOpen(false)}
 targetType="work"
 sourceEntity={{ id: work.id!, title: work.title || "" }}
 />
 </div>
 );
}

// attributeText：把某属性的值转成纯文本（枚举按词表本地化、实体取标题），供移动端摘要拼接。
// 枚举名必须按请求语言解析，不能写死 zh-CN——否则日/英界面会显示中文词条。
function attributeText(defs: any, code: string, value: any, locale: string): string {
  if (value === undefined || value === null || value === "") return "";
  const def: any = defs?.fields?.[code];
  if (def?.type === "enum" && def?.vocabulary) {
    const term = defs?.vocabularies?.[def.vocabulary]?.terms?.[String(value)];
    return resolveLocalizedName(term?.names, locale, String(value));
  }
  if (def?.type === "entity") {
    if (typeof value === "object" && value) return value.title || value.name || value.id || "";
    return String(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
