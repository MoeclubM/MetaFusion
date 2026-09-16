"use client";

import React, { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { AdaptiveCardCover } from "@/components/common/AdaptiveCardCover";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions, getTypeName, getKindName } from "@/lib/definitions";
import { pickRecordTitle } from "@/lib/titles";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import {
  Search,
  LayoutGrid,
  List as ListIcon,
  Layers,
  Disc,
  Users,
  Network,
  BookOpen,
  Film,
  Plus,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  GitCompare,
  Tag,
} from "lucide-react";

interface EntityItem {
  id: string;
  kind: string;
  title: string;
  original_language?: string;
  types?: string[];
  attributes?: { tags?: string[] };
  status: string;
  version: number;
  pictures?: { url: string }[];
  work_id?: string;
  release_id?: string;
  translations?: Record<string, { title: string; summary?: string; aliases?: string[] }>;
}

// 实体骨架天然分层：创作层（作品及其可复用表达）、发行层（发行版与承载）、
// 主体与集合（创作者/角色、合集）。浏览按层组织，不再单列"类型"轴——
// 类型（album/novel/…）本质是标签式的细分，作为卡片徽标与搜索条件呈现即可。
const LAYERS: { id: string; icon: React.ElementType; kinds: { id: string; icon: React.ElementType }[] }[] = [
  {
    id: "creation",
    icon: BookOpen,
    kinds: [
      { id: "work", icon: Layers },
      { id: "content_unit", icon: BookOpen },
      { id: "expression", icon: Film },
    ],
  },
  {
    id: "publication",
    icon: Disc,
    kinds: [
      { id: "release", icon: Disc },
      { id: "medium", icon: Disc },
      { id: "track", icon: Disc },
    ],
  },
  {
    id: "agents",
    icon: Users,
    kinds: [
      { id: "agent", icon: Users },
      { id: "collection", icon: Network },
    ],
  },
];

// 各 kind 的图标，供卡片兜底与列表徽标复用。
const KIND_ICONS: Record<string, React.ElementType> = {
  work: Layers,
  release: Disc,
  agent: Users,
  collection: Network,
  content_unit: BookOpen,
  expression: Film,
  medium: Disc,
  track: Disc,
};

function getLocalizedTitle(
  item: EntityItem,
  locale: string,
  order: string[] = [],
): string {
  return pickRecordTitle(locale, item.translations, item.title, {
    order,
    originalLanguage: item.original_language,
  });
}

function ExploreInner() {
  const { t, tr, locale } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();

  const { definitions, kinds } = useDefinitions();
  const titleOrder = useTitleDisplayOrder();

  const currentKind = searchParams.get("kind") || "all";
  const currentStatus = searchParams.get("status") || "published";
  const currentQ = searchParams.get("q") || "";
  // 动态业务类型（album/novel/animation…）筛选：选项来自 definitions，
  // 后台新增类型即自动出现在这里，前端不写死类型清单。
  const currentType = searchParams.get("type") || "";
  // 标签筛选：可多选，命中任一即返回（与后端 tags 参数语义一致）。
  const currentTags = useMemo(
    () => searchParams.getAll("tags").flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean),
    [searchParams],
  );
  const currentPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = 24;
  const offset = (currentPage - 1) * limit;

  const [qInput, setQInput] = useState(currentQ);
  const [items, setItems] = useState<EntityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [topTags, setTopTags] = useState<{ name: string; count: number }[]>([]);

  useEffect(() => {
    setQInput(currentQ);
  }, [currentQ]);

  // 标签云：来自真实聚合（各实体 attributes.tags 的频次），按使用量取前若干。
  useEffect(() => {
    fetch("/api/catalog/tags?limit=40", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setTopTags(data.items || []))
      .catch(() => setTopTags([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (currentKind !== "all") params.set("kind", currentKind);
    if (currentStatus) params.set("status", currentStatus);
    if (currentQ) params.set("q", currentQ);
    if (currentType) params.set("type", currentType);
    currentTags.forEach((tag) => params.append("tags", tag));
    params.set("limit", limit.toString());
    params.set("offset", offset.toString());

    fetch("/api/catalog/entities?" + params.toString(), { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setItems(data.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [currentKind, currentStatus, currentQ, currentType, currentTags, offset]);

  // 可选类型：来自 definitions 的 enabled 类型；已选具体 kind 时只保留该 kind 的类型。
  const typeOptions = useMemo(() => {
    const types = definitions?.types || {};
    return Object.keys(types)
      .filter((code) => {
        const t = types[code];
        if (!t || t.enabled === false) return false;
        if (currentKind === "all") return true;
        return (t.kinds || []).includes(currentKind);
      })
      .sort((a, b) =>
        getTypeName(definitions, a, locale).localeCompare(getTypeName(definitions, b, locale)),
      );
  }, [definitions, currentKind, locale]);

  const updateFilters = (updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v) next.set(k, v);
      else next.delete(k);
    });
    if (!updates.page) next.delete("page");
    router.push("/explore?" + next.toString());
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: qInput.trim() });
  };

  // 标签多选：写回 URL 的 tags 参数（多个值），其余筛选保持不变。
  const toggleTag = (name: string) => {
    const next = new Set(currentTags);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tags");
    next.forEach((tag) => params.append("tags", tag));
    params.delete("page");
    router.push("/explore?" + params.toString());
  };

  // 实体类型（八骨架 kind）显示名：服务端 definitions 的 kinds 优先，前端字典兜底。
  // 左栏筛选与卡片角标都用它——"分类"不在这里，分类由货架承担。
  const kindLabel = (id: string) => getKindName(kinds, id, locale, tr("catalog.kind." + id, id));

  // 当前所在层：用于左栏高亮，未选中具体 kind 时不强调任何层。
  const activeLayer = useMemo(
    () => LAYERS.find((l) => l.kinds.some((k) => k.id === currentKind))?.id || "",
    [currentKind],
  );

  // 列表容器 key：视图与筛选变化时重挂载、重放 .mf-tabpanel；
  // 搜索框的本地输入（qInput）不参与，否则打字过程会一直闪。
  const listKey = [
    viewMode,
    currentKind,
    currentStatus,
    currentType,
    currentQ,
    currentTags.join(","),
    currentPage,
  ].join("|");

  return (
    <div className="min-h-screen flex flex-col bg-background text-text-strong">
      <Navbar />

      <main className="mf-enter max-w-page mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-line">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-strong flex items-center gap-2.5 font-display">
              <Layers className="w-7 h-7 text-primary" />
              <span>{t("catalog.exploreTitle")}</span>
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t("catalog.exploreSubtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/compare"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface hover:bg-black/[0.04] dark:hover:bg-white/[0.08] border border-line text-xs font-mono text-text-body transition-colors duration-fast ease-soft shadow-2xs"
            >
              <GitCompare className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <span>{t("catalog.compare")}</span>
            </Link>

            <Link
              href="/new"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-xs font-medium text-white transition-colors duration-fast ease-soft shadow-2xs"
            >
              <Plus className="w-4 h-4" />
              <span>{t("catalog.newEntity")}</span>
            </Link>
          </div>
        </div>

        {/* 双栏：左侧按实体层级导航，右侧结果区 */}
        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-5">
          {/* 左侧：标签筛选。实体层级与类型属硬分类，不作为导航；浏览与归类一律由真实标签驱动
              （/catalog/tags 聚合自各实体的 attributes.tags）。 */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-line bg-surface shadow-soft overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-line-subtle flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500">
                  {t("catalog.tagFilter")}
                </span>
                {currentTags.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const p = new URLSearchParams(searchParams.toString());
                      p.delete("tags");
                      p.delete("page");
                      router.push("/explore?" + p.toString());
                    }}
                    className="text-[11px] text-primary hover:underline"
                  >
                    {t("catalog.clear")}
                  </button>
                )}
              </div>
              <div className="p-2.5">
                {topTags.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-gray-500">{t("catalog.noTags")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {topTags.map((tag) => {
                      const on = currentTags.includes(tag.name);
                      return (
                        <button
                          key={tag.name}
                          type="button"
                          onClick={() => toggleTag(tag.name)}
                          className={
                            "px-2 py-1 rounded-md text-[11px] font-mono border transition-colors duration-150 " +
                            (on
                              ? "bg-primary/15 text-primary border-primary/30 font-semibold"
                              : "text-text-body border-line-subtle hover:bg-black/[0.04] dark:hover:bg-surfaceHover")
                          }
                        >
                          {tag.name}
                          <span className="ml-1 opacity-60">{tag.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-5">
            {/* 检索与状态：仅保留面向用户的检索条件，类型不再单列 */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-4 rounded-xl bg-surface border border-line shadow-soft">
              <form onSubmit={handleSearchSubmit} className="sm:col-span-8 relative flex items-center">
                <Search className="absolute left-3.5 w-4 h-4 text-text-muted pointer-events-none" />
                <input
                  type="text"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  placeholder={t("catalog.searchPlaceholder")}
                  className="w-full pl-10 pr-20 py-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.04] border border-line text-xs text-text-strong placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-primary focus:bg-surface outline-none transition-all duration-base ease-soft"
                />
                <button
                  type="submit"
                  className="absolute right-1.5 px-3 py-1 rounded bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold transition-colors duration-fast ease-soft cursor-pointer"
                >
                  {t("catalog.searchAction")}
                </button>
              </form>

              {/* 类型筛选已移除：类型属硬分类，筛选一律走标签（左侧标签面板 / ?tags=）。 */}


              <div className="sm:col-span-2 flex items-center">
                <select
                  value={currentStatus}
                  aria-label={t("catalog.status")}
                  onChange={(e) => updateFilters({ status: e.target.value })}
                  className="w-full py-2 px-2.5 rounded-lg bg-surface dark:bg-[#18181b] border border-line text-xs text-text-strong focus:border-primary outline-none cursor-pointer"
                >
                  <option value="published" className="bg-surface dark:bg-[#18181b] text-text-strong">
                    {t("catalog.status.published")}
                  </option>
                  <option value="pending_review" className="bg-surface dark:bg-[#18181b] text-text-strong">
                    {t("catalog.status.pending_review")}
                  </option>
                  <option value="draft" className="bg-surface dark:bg-[#18181b] text-text-strong">
                    {t("catalog.status.draft")}
                  </option>
                </select>
              </div>

              <div className="sm:col-span-2 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={
                    "p-2 rounded-lg border text-xs transition-colors duration-fast ease-soft shadow-2xs cursor-pointer " +
                    (viewMode === "grid"
                      ? "bg-primary/15 border-primary/40 text-primary font-bold"
                      : "bg-surface border-line text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white")
                  }
                  title={t("catalog.gridView")}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={
                    "p-2 rounded-lg border text-xs transition-colors duration-fast ease-soft shadow-2xs cursor-pointer " +
                    (viewMode === "list"
                      ? "bg-primary/15 border-primary/40 text-primary font-bold"
                      : "bg-surface border-line text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white")
                  }
                  title={t("catalog.listView")}
                >
                  <ListIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 标签筛选：多选、命中任一；来源为真实标签聚合 */}
            {topTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-text-muted shrink-0" />
                {topTags.map((tag) => {
                  const active = currentTags.includes(tag.name);
                  return (
                    <button
                      key={tag.name}
                      type="button"
                      onClick={() => toggleTag(tag.name)}
                      className={
                        "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors duration-fast ease-soft cursor-pointer " +
                        (active
                          ? "bg-primary text-white font-semibold border border-primary"
                          : "bg-surface text-text-body hover:text-gray-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-surfaceHover border border-line")
                      }
                    >
                      #{tag.name}
                    </button>
                  );
                })}
                {currentTags.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updateFilters({ tags: "" })}
                    className="px-2.5 py-1 rounded-md text-[11px] font-mono text-primary hover:underline cursor-pointer"
                  >
                    {t("catalog.emptyAction")}
                  </button>
                )}
              </div>
            )}

            {loading ? (
              <div className="py-24 text-center text-gray-500 font-mono text-xs flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-6 h-6 animate-spin text-primary" />
                <span>{t("catalog.loading")}</span>
              </div>
            ) : items.length === 0 ? (
              <div className="py-20 rounded-xl border border-dashed border-line text-center bg-surface/50 shadow-2xs">
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-3">{t("catalog.emptyTitle")}</p>
                <button
                  type="button"
                  onClick={() => updateFilters({ q: "", kind: "" })}
                  className="text-xs font-mono text-primary hover:underline cursor-pointer"
                >
                  {t("catalog.emptyAction")}
                </button>
              </div>
            ) : viewMode === "grid" ? (
              <div key={listKey} className="mf-tabpanel grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                {items.map((item) => {
                  const KindIcon = KIND_ICONS[item.kind] || Layers;
                  const displayTitle = getLocalizedTitle(item, locale, titleOrder);
                  // 角标 = 实体类型（kind）；业务类型留在正文的类型标签里，不做成"分类"角标。
                  const badgeLabel = kindLabel(item.kind);

                  return (
                    <Link
                      key={item.id}
                      href={"/catalog/" + item.id}
                      className="group flex flex-col rounded-xl bg-surface hover:shadow-elevated border border-line hover:border-primary/50 dark:hover:border-primary/50 overflow-hidden transition-all duration-base ease-soft"
                    >
                      <AdaptiveCardCover
                        src={item.pictures && item.pictures[0]?.url}
                        alt={displayTitle}
                        badge={
                          <span className="px-2 py-0.5 rounded-md bg-black/65 dark:bg-black/75 text-white keep-white backdrop-blur-md border border-white/20 text-[10px] font-medium shadow-2xs flex items-center gap-1.5 leading-none">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                            <span className="truncate max-w-[85px]">{item.attributes?.tags?.[0] || ""}</span>
                          </span>
                        }
                        statusBadge={
                          item.status !== "published" && (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/90 text-black keep-white text-[9px] font-mono font-bold shadow-2xs">
                              {tr("catalog.status." + item.status, item.status)}
                            </span>
                          )
                        }
                        fallbackIcon={<KindIcon className="w-5 h-5" />}
                        fallbackTitle={displayTitle}
                        fallbackSubtitle={item.attributes?.tags?.[0] || ""}
                        className="border-b border-line-subtle"
                      />

                      <div className="p-3 flex-1 flex flex-col justify-between">
                        <div>
                          <h3 className="font-semibold text-text-strong group-hover:text-primary transition-colors duration-fast ease-soft text-xs sm:text-sm line-clamp-1 mb-1">
                            {displayTitle}
                          </h3>
                          {item.title !== displayTitle && (
                            <p className="text-[10px] text-gray-500 font-mono line-clamp-1 mb-1">{item.title}</p>
                          )}
                          {/* 业务类型不再当标签显示（types 仍决定渲染哪些动态字段，只是在界面上不铺标签） */}
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-line-subtle flex items-center justify-end text-[10px] text-text-muted font-mono">
                          <span className="group-hover:text-primary flex items-center gap-0.5">
                            {t("catalog.viewDetail")}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div key={listKey} className="mf-tabpanel rounded-xl border border-line bg-surface overflow-hidden divide-y dark:divide-white/[0.04] shadow-soft">
                {items.map((item) => {
                  const KindIcon = KIND_ICONS[item.kind] || Layers;
                  const displayTitle = getLocalizedTitle(item, locale, titleOrder);
                  // 角标 = 实体类型（kind）；业务类型留在正文的类型标签里，不做成"分类"角标。
                  const badgeLabel = kindLabel(item.kind);

                  return (
                    <Link
                      key={item.id}
                      href={"/catalog/" + item.id}
                      className="p-3.5 flex items-center justify-between gap-4 hover:bg-surfaceSubtle transition-colors duration-fast ease-soft group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-lg bg-black/[0.03] dark:bg-black/40 border border-line shrink-0 overflow-hidden flex items-center justify-center">
                          {item.pictures && item.pictures[0]?.url ? (
                            <img src={item.pictures[0].url} alt={displayTitle} className="w-full h-full object-cover" />
                          ) : (
                            <KindIcon className="w-5 h-5 text-text-muted" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-[10px] font-mono text-text-body font-medium">
                              {item.attributes?.tags?.[0] || ""}
                            </span>
                            <h3 className="font-semibold text-text-strong group-hover:text-primary transition-colors duration-fast ease-soft text-sm truncate">
                              {displayTitle}
                            </h3>
                            {item.title !== displayTitle && (
                              <span className="text-[11px] text-gray-500 font-mono hidden sm:inline truncate">
                                ({item.title})
                              </span>
                            )}
                            {item.status !== "published" && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-mono font-medium">
                                {tr("catalog.status." + item.status, item.status)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono">
                            <span>{(item.attributes?.tags || []).slice(0, 3).join(" · ")}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0 text-xs font-mono text-text-muted">
                        <span>rev {item.version || 1}</span>
                        <ArrowRight className="w-4 h-4 text-text-faint group-hover:text-primary transition-colors duration-fast ease-soft" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-line pt-4 text-xs font-mono text-gray-600 dark:text-gray-400">
              <div>
                {/* 空结果不显示"第 1 - 0 项"这类自相矛盾的区间（offset 有值而 items 为空）。 */}
                <span>
                  {items.length > 0
                    ? t("catalog.showingPage", {
                        start: (offset + 1).toString(),
                        end: (offset + items.length).toString(),
                      })
                    : t("pagination.totalItems", { total: 0 })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => updateFilters({ page: (currentPage - 1).toString() })}
                  className="px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-black/[0.04] dark:hover:bg-surfaceHover disabled:opacity-40 disabled:pointer-events-none text-gray-800 dark:text-white transition-colors duration-fast ease-soft flex items-center gap-1 cursor-pointer shadow-2xs"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>{t("catalog.prevPage")}</span>
                </button>
                <span className="px-2 py-1 text-gray-900 dark:text-gray-200 font-bold">{currentPage}</span>
                <button
                  type="button"
                  disabled={items.length < limit}
                  onClick={() => updateFilters({ page: (currentPage + 1).toString() })}
                  className="px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-black/[0.04] dark:hover:bg-surfaceHover disabled:opacity-40 disabled:pointer-events-none text-gray-800 dark:text-white transition-colors duration-fast ease-soft flex items-center gap-1 cursor-pointer shadow-2xs"
                >
                  <span>{t("catalog.nextPage")}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ExploreFallback() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background text-gray-500 font-mono text-xs grid place-items-center">{t("common.loading")}</div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<ExploreFallback />}>
      <ExploreInner />
    </Suspense>
  );
}
