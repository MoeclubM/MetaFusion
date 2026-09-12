"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { api, Entity, fetchAllPages, mapLimit, local, title as entityTitle } from "@/components/catalog/api";
import { useCatalog } from "@/components/catalog/CatalogProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  useDefinitions,
  getFieldName,
  getTermName,
} from "@/lib/definitions";
import { entryLabel, mediumLabel, entryRowHeader } from "@/lib/mediaLabels";
import { RecordList } from "@/components/catalog/TemplateAttributeSections";
import { AdaptiveCardCover } from "@/components/common/AdaptiveCardCover";
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  ChevronDown,
  Disc,
  ExternalLink,
  Film,
  Layers,
  Plus,
} from "lucide-react";

const COMPARE_MIN_SLOTS = 2;
const COMPARE_MAX_SLOTS = 6;
const COMPARE_BASKET_KEY = "metafusion_compare_basket";

function readBasket(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COMPARE_BASKET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string" && x.trim() !== "");
  } catch {
    return [];
  }
}

function toggleBasket(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return readBasket();
  const current = readBasket();
  const next = current.includes(trimmed)
    ? current.filter((x) => x !== trimmed)
    : [...current, trimmed].slice(0, COMPARE_MAX_SLOTS);
  try {
    window.localStorage.setItem(COMPARE_BASKET_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}

function compareHref(ids: string[]): string {
  const cleaned = ids.map((x) => x.trim()).filter(Boolean);
  if (cleaned.length === 0) return "/compare";
  return `/compare?ids=${encodeURIComponent(cleaned.join(","))}`;
}

function formatDuration(totalSeconds?: number | null): string {
  if (!totalSeconds || totalSeconds <= 0) return "—";
  const s = Math.round(totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function attrText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function attrList(v: unknown): Record<string, any>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object") as Record<string, any>[];
}

function localizedText(v: unknown, locale: string): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const rec = v as Record<string, string>;
    return rec[locale] || rec[locale.split("-")[0]] || rec["zh-CN"] || rec["en-US"] || rec["en"] || "";
  }
  return "";
}

function workMediaType(work?: Entity | null): string {
  // 载体/篇目用词走服务端 types，不再用标题正则猜测。
  // types 为 definitions type code（music/song/album/novel/animation/film/…），
  // mediaLabels 的 switch 直接消费；未知 code 回退空字符串走通用标签。
  const types = (work?.types || []).map((x) => String(x).toLowerCase());
  if (types.length > 0) return types[0];
  return "";
}

type Occurrence = {
  release: Entity;
  medium: Entity;
  track: Entity;
  expression_id: string;
  position: number;
  locator?: Record<string, any> | null;
};

type MediumRow = { medium: Entity; tracks: Entity[] };

// orderedTracksWithDepth：把曲目树（章/子轨）深度优先展开成"父轨后紧跟其子轨"的
// 展示序列，子轨带层级深度供缩进；排序只看 position，不用曲号充当身份。
function orderedTracksWithDepth(tracks: Entity[]): { track: Entity; depth: number }[] {
  const byId = new Map<string, Entity>();
  for (const tr of tracks) if (tr.id) byId.set(tr.id, tr);
  const childrenOf = new Map<string, Entity[]>();
  const roots: Entity[] = [];
  for (const tr of tracks) {
    const pid = tr.parent_id || "";
    if (pid && byId.has(pid)) {
      const list = childrenOf.get(pid) || [];
      list.push(tr);
      childrenOf.set(pid, list);
    } else {
      roots.push(tr);
    }
  }
  const byPos = (a: Entity, b: Entity) => (a.position || 0) - (b.position || 0);
  roots.sort(byPos);
  childrenOf.forEach((list) => list.sort(byPos));
  const out: { track: Entity; depth: number }[] = [];
  const walk = (list: Entity[], depth: number) => {
    for (const tr of list) {
      out.push({ track: tr, depth });
      const kids = childrenOf.get(tr.id!) || [];
      if (kids.length > 0) walk(kids, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

function Collapsible({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-3.5 sm:px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors min-h-[44px]"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-gray-900 dark:text-white">
          <span>{title}</span>
          {typeof count === "number" && (
            <span className="px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary font-mono text-[10px] font-bold">
              {count}
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          <span className="hidden sm:inline">{open ? t("common.collapse") : t("common.expand")}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.6} />
        </span>
      </button>
      {open && <div className="px-3.5 sm:px-4 py-3 border-t border-black/5 dark:border-white/[0.06]">{children}</div>}
    </section>
  );
}

export default function ReleaseDetailPage() {
  const params = useParams();
  const releaseId = params.id as string;
  const { t, locale } = useI18n();
  const { definition: catalogDef } = useCatalog();
  const { definitions: dynamicDefs } = useDefinitions();

  const [release, setRelease] = useState<Entity | null>(null);
  const [media, setMedia] = useState<{ medium: Entity; tracks: Entity[] }[]>([]);
  const [works, setWorks] = useState<Record<string, Entity>>({});
  const [expressions, setExpressions] = useState<Record<string, Entity>>({});
  const [occurrences, setOccurrences] = useState<Record<string, Occurrence[]>>({});
  const [expressionCredits, setExpressionCredits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [showBonus, setShowBonus] = useState(false);
  const [basket, setBasket] = useState<string[]>([]);
  const [basketNotice, setBasketNotice] = useState("");
  const [siblingReleases, setSiblingReleases] = useState<Entity[]>([]);

  useEffect(() => {
    setBasket(readBasket());
  }, []);

  useEffect(() => {
    if (!releaseId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const rel = await api<Entity>(`/catalog/entities/${releaseId}/resolve`);
        if (rel.kind !== "release") throw new Error("invalid_kind");
        // 载体与曲目全量翻页获取：大型盒装/合集不受固定 limit 截断。
        const mediums = await fetchAllPages<Entity>(
          `/catalog/entities?kind=medium&release_id=${encodeURIComponent(String(rel.id || ""))}`
        );
        const rows: MediumRow[] = await mapLimit(mediums, 8, async (m) => ({
          medium: m,
          tracks: await fetchAllPages<Entity>(
            `/catalog/entities?kind=track&medium_id=${encodeURIComponent(m.id!)}`
          ),
        }));
        rows.sort((a, b) => (a.medium.position || 0) - (b.medium.position || 0));
        rows.forEach((r) => r.tracks.sort((a, b) => (a.position || 0) - (b.position || 0)));
        const workIds = Array.from(new Set((rel.subjects || []).map((s) => s.work_id).filter(Boolean)));
        const workMap: Record<string, Entity> = {};
        await Promise.all(
          workIds.map(async (id) => {
            try {
              workMap[id] = await api<Entity>(`/catalog/entities/${id}`);
            } catch {
              /* ignore */
            }
          })
        );
        if (cancelled) return;
        setRelease(rel);
        setMedia(rows);
        setWorks(workMap);
        setActiveTab("all");
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "load_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [releaseId]);

  // 同 Work 其他版本：用主 subject work_id 查 release 列表，供版本横 rail 切换。
  useEffect(() => {
    const workId =
      release?.subjects?.find((s) => s.role === "primary")?.work_id || release?.subjects?.[0]?.work_id;
    if (!workId) {
      setSiblingReleases([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchAllPages<Entity>(
          `/catalog/entities?kind=release&work_id=${encodeURIComponent(workId)}`
        );
        if (!cancelled) setSiblingReleases(r);
      } catch {
        if (!cancelled) setSiblingReleases([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [release?.id]);

  const expressionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of media) {
      for (const tr of row.tracks) {
        for (const c of tr.contents || []) {
          if (c.expression_id) ids.add(c.expression_id);
        }
      }
    }
    return Array.from(ids);
  }, [media]);

  useEffect(() => {
    if (expressionIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const exprMap: Record<string, Entity> = {};
      const occMap: Record<string, Occurrence[]> = {};
      const creditMap: Record<string, string> = {};
      // 一条批量请求取回表达实体 + 收录（同 Work/篇目）+ 首个署名，
      // 替代原先逐条 entities/:id、occurrences、relations、对端实体四类 N+1 请求。
      // 超过单次上限时分片，仍显著少于逐条请求数。
      const CHUNK = 300;
      for (let i = 0; i < expressionIds.length; i += CHUNK) {
        const slice = expressionIds.slice(i, i + CHUNK);
        try {
          const r = await api<{
            items: Record<string, { entity: Entity; occurrences: Occurrence[]; credit_title?: string }>;
          }>(`/catalog/expressions/details?ids=${encodeURIComponent(slice.join(","))}`);
          for (const [id, d] of Object.entries(r.items || {})) {
            if (d?.entity) exprMap[id] = d.entity;
            occMap[id] = d?.occurrences || [];
            if (d?.credit_title) creditMap[id] = d.credit_title;
          }
        } catch {
          // 批量失败时退化为逐条取实体，保证页面仍可用（不引入新的静默空白）。
          await mapLimit(slice, 8, async (id) => {
            try {
              exprMap[id] = await api<Entity>(`/catalog/entities/${id}`);
            } catch {
              /* ignore */
            }
          });
        }
      }
      if (cancelled) return;
      setExpressions(exprMap);
      setOccurrences(occMap);
      setExpressionCredits(creditMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [expressionIds.join(","), locale]);

  const crossDurations = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of media) {
      for (const tr of row.tracks) {
        const dur = Number(tr.attributes?.duration);
        if (!dur || dur <= 0) continue;
        for (const c of tr.contents || []) {
          if (!c.expression_id) continue;
          if (!map.has(c.expression_id)) map.set(c.expression_id, new Map());
          map.get(c.expression_id)!.set(row.medium.id!, dur);
        }
      }
    }
    return map;
  }, [media]);

  // 注意：全部 use* 必须在 early return 之前，保持每次渲染 Hook 顺序一致。
  // 载体树：A/B 面等子载体挂在所属盘之下；格式分组与曲目计数都按顶层载体算，
  // 子载体（面）不单独成组，避免同一张盘被拆成"主载体+未知格式"两份。
  const mediumTree = useMemo(() => {
    const byId = new Map<string, MediumRow>();
    for (const r of media) if (r.medium.id) byId.set(r.medium.id, r);
    const childrenOf = new Map<string, MediumRow[]>();
    const roots: MediumRow[] = [];
    for (const r of media) {
      const pid = r.medium.parent_id || "";
      if (pid && byId.has(pid)) {
        const list = childrenOf.get(pid) || [];
        list.push(r);
        childrenOf.set(pid, list);
      } else {
        roots.push(r);
      }
    }
    const byPos = (a: MediumRow, b: MediumRow) => (a.medium.position || 0) - (b.medium.position || 0);
    roots.sort(byPos);
    childrenOf.forEach((list) => list.sort(byPos));
    const totalTracks = new Map<string, number>();
    const totalOf = (r: MediumRow): number => {
      const id = r.medium.id!;
      const cached = totalTracks.get(id);
      if (cached !== undefined) return cached;
      totalTracks.set(id, 0); // 防御异常环状数据，先占位再回填
      const n = r.tracks.length + (childrenOf.get(id) || []).reduce((s, c) => s + totalOf(c), 0);
      totalTracks.set(id, n);
      return n;
    };
    roots.forEach(totalOf);
    return { roots, childrenOf, totalOf };
  }, [media]);

  const formatGroups = useMemo(() => {
    const groups = new Map<string, MediumRow[]>();
    for (const row of mediumTree.roots) {
      const fmt = attrText(row.medium.attributes?.format) || "unknown";
      if (!groups.has(fmt)) groups.set(fmt, []);
      groups.get(fmt)!.push(row);
    }
    return Array.from(groups.entries());
  }, [mediumTree]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <Navbar />
        <div className="relative z-10 min-h-screen grid place-items-center font-mono text-xs text-gray-500">{t("release.detail.loading")}</div>
      </div>
    );
  }

  if (!release) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <Navbar />
        <div className="relative z-10 max-w-7xl mx-auto px-4 py-20 text-center font-mono text-xs text-gray-500">
          {error || t("common.notFoundRelease")}
        </div>
      </div>
    );
  }

  const attrs = release.attributes || {};
  const editionType = attrText(attrs.edition_type);
  const country = attrText(attrs.country);
  const language = attrText(attrs.language);
  const channel = attrText((attrs as Record<string, any>).distribution_channel);
  const packaging = attrText(attrs.packaging);
  const catalogNo = attrText(attrs.catalog_number);
  const barcode = attrText(attrs.barcode);
  const editionDate = attrText(attrs.edition_date);
  const publisher = attrs.publisher;
  const publisherName =
    typeof publisher === "string" ? publisher : localizedText((publisher as any)?.name, locale) || attrText((publisher as any)?.id);
  const attachments = attrList(attrs.attachments);
  const storeBonuses = attrList(attrs.store_bonuses);
  const events = attrList(attrs.events);

  const primaryWorkId = release.subjects?.find((s) => s.role === "primary")?.work_id || release.subjects?.[0]?.work_id;
  const primaryWork = (primaryWorkId && works[primaryWorkId]) || null;
  const mediaType = workMediaType(primaryWork);
  const eLabel = entryLabel(mediaType, t);
  const mLabel = mediumLabel(mediaType, t);

  const editionLabel = editionType
    ? getTermName(dynamicDefs, "edition_type", editionType, locale) !== editionType
      ? getTermName(dynamicDefs, "edition_type", editionType, locale)
      : t(`release.editionType.${editionType}`) !== `release.editionType.${editionType}`
        ? t(`release.editionType.${editionType}`)
        : editionType
    : "";
  const packagingLabel =
    packaging && dynamicDefs
      ? getTermName(dynamicDefs, "packaging", packaging, locale) !== packaging
        ? getTermName(dynamicDefs, "packaging", packaging, locale)
        : packaging
      : packaging;
  const channelLabel =
    channel && dynamicDefs
      ? getTermName(dynamicDefs, "distribution_channel", channel, locale) !== channel
        ? getTermName(dynamicDefs, "distribution_channel", channel, locale)
        : channel
      : channel;

  const visibleGroups = activeTab === "all" ? formatGroups : formatGroups.filter(([fmt]) => fmt === activeTab);
  const bonusGroups = showBonus ? visibleGroups : visibleGroups.map(([fmt, rows]) => [fmt, rows.filter((r) => attrText(r.medium.attributes?.role) !== "supplement")] as [string, typeof media]);
  const supplementGroups = visibleGroups.map(([fmt, rows]) => [fmt, rows.filter((r) => attrText(r.medium.attributes?.role) === "supplement")] as [string, typeof media]);

  const inBasket = basket.includes(release.id!);
  const basketFull = !inBasket && basket.length >= COMPARE_MAX_SLOTS;

  const onToggleBasket = () => {
    if (basketFull) {
      setBasketNotice(t("release.detail.compareBasketFull"));
      return;
    }
    setBasketNotice("");
    setBasket(toggleBasket(release.id!));
  };

  const releaseTitle = entityTitle(release, locale);

  // 单个载体（盘或面）的展示块：depth=0 为顶层盘，depth≥1 为嵌套的子载体（A/B 面）。
  // 子载体在其父块的轨道表之后递归渲染；特典过滤同样作用于子载体。
  const mediumBlock = (row: MediumRow, depth: number): React.ReactNode => {
    const medium = row.medium;
    const tracks = row.tracks;
    const ownFmt = attrText(medium.attributes?.format) || "unknown";
    const fmtLabel =
      dynamicDefs && ownFmt !== "unknown" ? getTermName(dynamicDefs, "format", ownFmt, locale) : "";
    const role = attrText(medium.attributes?.role);
    const mediumTitle = entityTitle(medium, locale);
    const kids = (mediumTree.childrenOf.get(medium.id!) || []).filter(
      (r) => showBonus || attrText(r.medium.attributes?.role) !== "supplement"
    );
    const ordered = orderedTracksWithDepth(tracks);
    return (
      <section
        key={medium.id}
        id={`medium-${medium.id}`}
        className={
          depth === 0
            ? "rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft"
            : "bg-transparent"
        }
      >
        <div
          className={`px-3.5 sm:px-4 py-2.5 border-b border-black/5 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
            depth === 0 ? "bg-black/[0.02] dark:bg-white/[0.02]" : ""
          } ${depth > 0 ? "sm:pl-8" : ""}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-6.5 h-6.5 grid place-items-center rounded-md bg-sky-500/10 border border-sky-500/20 shrink-0">
              <Disc className="w-3.5 h-3.5 text-sky-500" strokeWidth={1.5} />
            </span>
            <span className="font-display text-sm font-bold tracking-tight text-gray-900 dark:text-white truncate">
              {depth === 0 && `${mLabel}${medium.position || ""} · `}
              {mediumTitle}
            </span>
            {fmtLabel && ownFmt !== "unknown" && (
              <span className="hidden sm:inline font-mono text-[11px] text-gray-500 shrink-0">{fmtLabel}</span>
            )}
            {role === "supplement" && (
              <span className="px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-mono text-[10px] shrink-0">
                {t("release.detail.bonusDisc")}
              </span>
            )}
          </div>
          <span className="font-mono text-[10px] text-gray-400">
            #{String(medium.id).slice(0, 8)} · {t("release.detail.trackCount", { count: mediumTree.totalOf(row) })}
          </span>
        </div>
        {ordered.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="px-3.5 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-gray-500">{entryRowHeader(mediaType, t)}</div>
            <table className="w-full text-left text-xs min-w-[640px]">
              <thead className="bg-black/[0.02] dark:bg-white/[0.02] border-y border-black/5 dark:border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="py-2 px-3.5 w-12 font-medium">{t("release.detail.tablePosition")}</th>
                  <th className="py-2 px-3.5 font-medium">{t("release.detail.tableEntryTitle", { label: eLabel })}</th>
                  <th className="py-2 px-3.5 font-medium">{t("release.detail.tableMasterEntry")}</th>
                  <th className="py-2 px-3.5 font-medium">{t("release.detail.tableCredit")}</th>
                  <th className="py-2 px-3.5 text-right font-medium">{t("release.detail.tableDuration")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                {ordered.map(({ track: tr, depth: trDepth }) => {
                  const contents = tr.contents || [];
                  const firstExpr = contents[0]?.expression_id;
                  const expr = firstExpr ? expressions[firstExpr] : undefined;
                  const displayTitle =
                    entityTitle(tr, locale) !== tr.title && entityTitle(tr, locale)
                      ? entityTitle(tr, locale)
                      : tr.title || (expr ? entityTitle(expr, locale) : "");
                  const overridden =
                    !!expr && !!displayTitle && displayTitle !== entityTitle(expr, locale);
                  const cross = firstExpr ? crossDurations.get(firstExpr) : undefined;
                  const trWorkId = (tr as Entity).work_id || expr?.work_id;
                  const trWork = (trWorkId && works[trWorkId]) || null;
                  const showWorkBadge = trWork && primaryWorkId && trWork.id !== primaryWorkId;
                  const dur = Number(tr.attributes?.duration);
                  return (
                    <tr key={tr.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="py-2 px-3.5 font-mono text-gray-500 tabular-nums whitespace-nowrap">{tr.number || tr.position}</td>
                      <td className="py-2 px-3.5 font-medium text-gray-900 dark:text-white">
                        <div
                          className="flex flex-wrap items-center gap-1.5"
                          style={trDepth > 0 ? { paddingLeft: `${trDepth * 14}px` } : undefined}
                        >
                          {trDepth > 0 && <span className="text-gray-400 font-mono text-[10px]">└</span>}
                          <span>{displayTitle || t("release.detail.untitledTrack")}</span>
                          {overridden && (
                            <span className="text-amber-500 text-[10px]">[{t("release.detail.overridden")}]</span>
                          )}
                          {showWorkBadge && trWork && (
                            <Link
                              href={`/works/${trWork.id}`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20 text-[10px] hover:bg-sky-500/20 transition-colors font-mono"
                            >
                              <Film className="w-2.5 h-2.5" />
                              <span className="truncate max-w-[22ch]">{entityTitle(trWork, locale)}</span>
                            </Link>
                          )}
                        </div>
                        {cross && cross.size > 1 && (
                          <div className="mt-0.5 font-mono text-[10px] font-normal text-gray-500">
                            {t("release.detail.crossMediumDuration")}:{" "}
                            {Array.from(cross.values()).map((s) => formatDuration(s)).join(" / ")}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3.5 text-gray-500 text-xs">
                        {contents.length > 0 ? (
                          <span className="inline-flex flex-wrap gap-1">
                            {contents.map((c, i) => {
                              const e = expressions[c.expression_id];
                              return (
                                <Link
                                  key={`${tr.id}-${c.expression_id}-${i}`}
                                  href={`/catalog/${c.expression_id}`}
                                  className="text-gray-700 dark:text-gray-300 hover:text-primary hover:underline transition-colors"
                                >
                                  {e ? entityTitle(e, locale) : c.expression_id.slice(0, 8)}
                                </Link>
                              );
                            })}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3.5 text-gray-500">
                        {firstExpr && expressionCredits[firstExpr] ? (
                          <span className="text-xs text-gray-700 dark:text-gray-300">
                            {expressionCredits[firstExpr]}
                            {attrText(tr.attributes?.isrc) && (
                              <span className="ml-1.5 font-mono text-[10px] text-gray-400">
                                {attrText(tr.attributes?.isrc)}
                              </span>
                            )}
                          </span>
                        ) : attrText(tr.attributes?.isrc) ? (
                          <span className="font-mono text-[11px]">{attrText(tr.attributes?.isrc)}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3.5 text-right font-mono text-gray-500 tabular-nums whitespace-nowrap">
                        {formatDuration(dur > 0 ? dur : Number(expr?.attributes?.duration) || 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-3.5 py-4 font-mono text-[11px] text-gray-500">{t("release.detail.noTracks")}</div>
        )}
        {kids.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/[0.06]">
            {kids.map((k) => mediumBlock(k, depth + 1))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <Navbar />
      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full space-y-5 flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          {primaryWork && (
            <>
              <Link href={`/works/${primaryWork.id}`} className="hover:text-primary transition-colors inline-flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" strokeWidth={1.6} />
                {entityTitle(primaryWork, locale)}
              </Link>
              <span className="text-gray-400 dark:text-white/20">/</span>
            </>
          )}
          <span className="text-gray-900 dark:text-white truncate">{releaseTitle}</span>
        </div>

        <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-wide">
                <span className="px-2 py-0.5 rounded-sm bg-primary text-white font-semibold">{t("release.detail.badge")}</span>
                {editionLabel && (
                  <span className="px-2 py-0.5 rounded-sm bg-violet-500/10 text-violet-600 dark:text-violet-300 border border-violet-500/25 font-semibold">
                    {editionLabel}
                  </span>
                )}
                {country && (
                  <span className="px-2 py-0.5 rounded-sm bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20">{country}</span>
                )}
                {packagingLabel && (
                  <span className="text-gray-500">{t("release.detail.packagingLabel")}{packagingLabel}</span>
                )}
                {catalogNo && <span className="text-gray-500 font-mono">{catalogNo}</span>}
                {barcode && <span className="text-gray-500">{t("release.detail.barcode", { code: barcode })}</span>}
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">{releaseTitle}</h1>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-gray-500">
                {country && <div className="flex gap-1"><dt>{t("release.detail.countryLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{country}</dd></div>}
                {language && <div className="flex gap-1"><dt>{t("release.detail.languageLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{language}</dd></div>}
                {channelLabel && <div className="flex gap-1"><dt>{t("release.detail.channelLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{channelLabel}</dd></div>}
                {editionDate && <div className="flex gap-1"><dt>{t("release.detail.dateLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{editionDate}</dd></div>}
                {publisherName && <div className="flex gap-1"><dt>{t("release.detail.publisherLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{publisherName}</dd></div>}
              </dl>
              {(release.subjects || []).length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Layers className="w-3 h-3 text-primary" strokeWidth={1.5} />
                  {(release.subjects || []).map((s) => {
                    const w = works[s.work_id];
                    if (!w) return null;
                    return (
                      <Link
                        key={`${s.work_id}-${s.role}`}
                        href={`/works/${s.work_id}`}
                        className="px-1.5 py-0.5 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-[11px] text-gray-700 dark:text-gray-300 hover:text-primary"
                      >
                        {entityTitle(w, locale)}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
              {release.pictures?.[0]?.url && (
                <div className="w-24 aspect-square rounded-md overflow-hidden border border-black/10 dark:border-white/10">
                  <AdaptiveCardCover src={release.pictures[0].url} alt={releaseTitle} fallbackIcon={<Disc className="w-6 h-6 text-gray-400" />} aspectClassName="w-full h-full" />
                </div>
              )}
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleBasket}
                  disabled={basketFull}
                  aria-pressed={inBasket}
                  className={`inline-flex items-center gap-1.5 h-8 max-sm:min-h-[44px] px-3 rounded-md border text-xs font-mono transition-colors ${
                    inBasket
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300"
                      : "bg-black/[0.03] dark:bg-white/[0.06] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:text-primary hover:border-primary/40 disabled:opacity-40"
                  }`}
                >
                  {inBasket ? <Check className="w-3.5 h-3.5" strokeWidth={1.6} /> : <ArrowRightLeft className="w-3.5 h-3.5" strokeWidth={1.6} />}
                  <span>{inBasket ? t("release.detail.compareAdded") : t("release.detail.compareAdd")}</span>
                </button>
                {basket.length > 0 && (
                  <Link
                    href={compareHref(basket)}
                    className="inline-flex items-center h-8 max-sm:min-h-[44px] px-3 rounded-md bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-white transition-all text-xs font-mono"
                  >
                    {t("release.detail.compareOpen", { count: basket.length })}
                  </Link>
                )}
              </span>
              {basketNotice && <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400">{basketNotice}</span>}
            </div>
          </div>
        </section>

        {siblingReleases.length > 1 && (
          <nav aria-label={t("release.detail.siblingVersions")} className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface px-3.5 sm:px-4 py-3 space-y-2">
            <p className="font-mono text-[11px] text-gray-500">
              {t("release.detail.siblingVersions")} · {siblingReleases.length}
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {siblingReleases.map((sib) => {
                const sibEdition = attrText(sib.attributes?.edition_type);
                const sibEditionLabel = sibEdition
                  ? dynamicDefs && getTermName(dynamicDefs, "edition_type", sibEdition, locale) !== sibEdition
                    ? getTermName(dynamicDefs, "edition_type", sibEdition, locale)
                    : t(`release.editionType.${sibEdition}`) !== `release.editionType.${sibEdition}`
                      ? t(`release.editionType.${sibEdition}`)
                      : sibEdition
                  : "";
                const sibCatalogNo = attrText(sib.attributes?.catalog_number);
                const active = sib.id === release.id;
                return (
                  <Link
                    key={sib.id}
                    href={`/releases/${sib.id}`}
                    aria-current={active ? "page" : undefined}
                    className={`shrink-0 max-w-[220px] rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? "bg-primary text-white border-primary"
                        : "bg-black/[0.02] dark:bg-white/[0.03] border-black/10 dark:border-white/10 hover:border-primary/40"
                    }`}
                  >
                    <span className={`block text-xs font-semibold truncate ${active ? "" : "text-gray-900 dark:text-white"}`}>
                      {entityTitle(sib, locale)}
                    </span>
                    <span className={`mt-0.5 block font-mono text-[10px] truncate ${active ? "text-white/80" : "text-gray-500"}`}>
                      {[sibEditionLabel, sibCatalogNo].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>
        )}

        {formatGroups.length > 1 && (
          <nav aria-label={t("release.detail.formatTabs")} className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              aria-pressed={activeTab === "all"}
              className={`shrink-0 h-9 max-sm:min-h-[44px] px-3 rounded-md border font-mono text-xs transition-colors ${
                activeTab === "all"
                  ? "bg-primary text-white border-primary"
                  : "bg-surface border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-primary/40 hover:text-primary"
              }`}
            >
              {t("release.detail.tabAllFormats")}
            </button>
            {formatGroups.map(([fmt, rows]) => {
              const label = dynamicDefs ? getTermName(dynamicDefs, "format", fmt, locale) : fmt;
              const trackCount = rows.reduce((n, r) => n + mediumTree.totalOf(r), 0);
              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setActiveTab(fmt)}
                  aria-pressed={activeTab === fmt}
                  className={`shrink-0 h-9 max-sm:min-h-[44px] px-3 rounded-md border font-mono text-xs transition-colors ${
                    activeTab === fmt
                      ? "bg-primary text-white border-primary"
                      : "bg-surface border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-primary/40 hover:text-primary"
                  }`}
                >
                  {label} · {trackCount}
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[11px] text-gray-500">{t("release.detail.mediumCount", { count: mediumTree.roots.length })}</p>
          <label className="inline-flex items-center gap-2 font-mono text-[11px] text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBonus}
              onChange={(e) => setShowBonus(e.target.checked)}
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <span>{t("release.detail.showBonusDiscs")}</span>
          </label>
        </div>

        {media.length === 0 ? (
          <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-8 text-center font-mono text-xs text-gray-500">{t("release.detail.noMedium")}</div>
        ) : (
          <div className="space-y-4 sm:space-y-5">
            {(showBonus ? visibleGroups : bonusGroups).map(([fmt, rows]) => (
              <div key={fmt} className="space-y-4">
                {rows.map((row) => mediumBlock(row, 0))}
              </div>
            ))}
            {!showBonus && supplementGroups.some(([, rows]) => rows.length > 0) && (
              <Collapsible title={t("release.detail.bonusDiscs")} count={supplementGroups.reduce((n, [, rows]) => n + rows.length, 0)}>
                <div className="space-y-3">
                  {supplementGroups.map(([fmt, rows]) =>
                    rows.map(({ medium, tracks }) => {
                      const fmtLabel = dynamicDefs ? getTermName(dynamicDefs, "format", fmt, locale) : fmt;
                      return (
                        <div key={medium.id} className="rounded-md border border-black/10 dark:border-white/10 p-3">
                          <div className="flex items-center gap-2 text-xs font-semibold text-gray-900 dark:text-white">
                            <Disc className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
                            <span className="truncate">{entityTitle(medium, locale)}</span>
                            {fmtLabel && fmt !== "unknown" && <span className="font-mono text-[10px] font-normal text-gray-500">{fmtLabel}</span>}
                            <span className="font-mono text-[10px] font-normal text-gray-500">{t("release.detail.trackCount", { count: tracks.length })}</span>
                          </div>
                          <div className="mt-2 space-y-1">
                            {tracks.slice().sort((a, b) => (a.position || 0) - (b.position || 0)).map((tr) => (
                              <div key={tr.id} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-gray-500 w-8 shrink-0">{tr.number || tr.position}</span>
                                <span className="text-gray-800 dark:text-gray-200 truncate">{entityTitle(tr, locale) || tr.title}</span>
                                <span className="ml-auto font-mono text-[11px] text-gray-500 shrink-0">{formatDuration(Number(tr.attributes?.duration) || 0)}</span>
                              </div>
                            ))}
                          </div>
                          <Link href={`#medium-${medium.id}`} className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                            {t("release.detail.viewBonusDisc")} <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                          </Link>
                        </div>
                      );
                    })
                  )}
                </div>
              </Collapsible>
            )}
          </div>
        )}

        {expressionIds.length > 0 && (
          <Collapsible title={t("release.detail.sameRecordingTitle")} count={expressionIds.length}>
            <div className="overflow-x-auto -mx-3.5 sm:-mx-4 px-3.5 sm:px-4">
              <table className="w-full text-left text-xs min-w-[720px]">
                <thead className="font-mono text-[10px] uppercase tracking-wider text-gray-500 border-b border-black/5 dark:border-white/[0.06]">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t("release.detail.sameRecordingExpr")}</th>
                    <th className="py-2 pr-3 font-medium">{t("release.detail.sameRecordingRelease")}</th>
                    <th className="py-2 pr-3 font-medium">{t("release.detail.sameRecordingMedium")}</th>
                    <th className="py-2 pr-3 font-medium">{t("release.detail.sameRecordingTrack")}</th>
                    <th className="py-2 text-right font-medium">{t("release.detail.tableDuration")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                  {expressionIds.slice(0, 60).map((exprId) => {
                    const occ = occurrences[exprId] || [];
                    const expr = expressions[exprId];
                    if (occ.length === 0) {
                      return (
                        <tr key={exprId}>
                          <td className="py-2 pr-3 text-gray-900 dark:text-white">{expr ? entityTitle(expr, locale) : exprId.slice(0, 8)}</td>
                          <td colSpan={4} className="py-2 font-mono text-[11px] text-gray-400">{t("release.detail.sameRecordingEmpty")}</td>
                        </tr>
                      );
                    }
                    return occ.slice(0, 8).map((o, i) => (
                      <tr key={`${exprId}-${i}`}>
                        {i === 0 ? (
                          <td rowSpan={Math.min(occ.length, 8)} className="py-2 pr-3 text-gray-900 dark:text-white align-top">
                            {expr ? entityTitle(expr, locale) : exprId.slice(0, 8)}
                          </td>
                        ) : null}
                        <td className="py-2 pr-3">
                          <Link href={`/releases/${o.release.id}`} className="text-primary hover:underline">
                            {entityTitle(o.release, locale)}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-gray-500">{entityTitle(o.medium, locale)}</td>
                        <td className="py-2 pr-3 font-mono text-gray-500">
                          #{o.track.number || o.track.position} {entityTitle(o.track, locale)}
                        </td>
                        <td className="py-2 text-right font-mono text-gray-500 tabular-nums">
                          {formatDuration(Number(o.track.attributes?.duration) || 0)}
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </Collapsible>
        )}

        <div className="space-y-3">
          {attachments.length > 0 && (
            <Collapsible title={t("release.detail.attachments")} count={attachments.length}>
              <RecordList
                items={attachments}
                field={dynamicDefs?.fields?.attachments}
                defs={dynamicDefs}
                locale={locale}
                fallbackLabel={(i) => t("release.detail.attachmentItem", { index: i + 1 })}
              />
            </Collapsible>
          )}
          {storeBonuses.length > 0 && (
            <Collapsible title={t("release.detail.storeBonuses")} count={storeBonuses.length}>
              <RecordList
                items={storeBonuses}
                field={dynamicDefs?.fields?.store_bonuses}
                defs={dynamicDefs}
                locale={locale}
                fallbackLabel={(i) => t("release.detail.attachmentItem", { index: i + 1 })}
              />
            </Collapsible>
          )}
          {events.length > 0 && (
            <Collapsible title={t("release.detail.releaseEvents")} count={events.length}>
              <RecordList
                items={events}
                field={dynamicDefs?.fields?.events}
                defs={dynamicDefs}
                locale={locale}
                fallbackLabel={(i) => t("release.detail.attachmentItem", { index: i + 1 })}
              />
            </Collapsible>
          )}
        </div>

        {(catalogDef || dynamicDefs) && (
          <details className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface px-3.5 sm:px-4 py-2.5">
            <summary className="cursor-pointer font-mono text-[11px] text-gray-500 hover:text-primary min-h-[32px] flex items-center">
              {t("release.detail.comparableFields")}
            </summary>
            <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {Object.keys(attrs).map((k) => {
                const defs = dynamicDefs || catalogDef?.document;
                const field = (defs as any)?.fields?.[k];
                if (field && "comparable" in field && field.comparable === false) return null;
                const name =
                  getFieldName(dynamicDefs, k, locale) !== k
                    ? getFieldName(dynamicDefs, k, locale)
                    : local((catalogDef?.document.fields as any)?.[k]?.names, locale, "", k as string);
                const v = attrs[k];
                const text = typeof v === "string" || typeof v === "number" ? String(v) : Array.isArray(v) ? t("release.detail.listCount", { count: v.length }) : "—";
                if (["attachments", "store_bonuses", "events"].includes(k)) return null;
                return (
                  <div key={k} className="flex gap-2 min-w-0">
                    <dt className="font-mono text-gray-500 shrink-0">{name}</dt>
                    <dd className="text-gray-800 dark:text-gray-200 truncate">{text}</dd>
                  </div>
                );
              })}
            </dl>
          </details>
        )}

        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          <Plus className="w-3 h-3" strokeWidth={1.6} />
          <Link href={`/catalog/${release.id}`} className="hover:text-primary transition-colors inline-flex items-center gap-1">
            {t("release.detail.openInCatalog")} <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
          </Link>
        </div>
      </main>
    </div>
  );
}
