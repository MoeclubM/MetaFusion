"use client";

import React, { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { AdaptiveCardCover } from "@/components/common/AdaptiveCardCover";
import { useI18n } from "@/i18n/I18nProvider";
import {
  useDefinitions,
  getTypeName,
  resolveLocalizedName,
} from "@/lib/definitions";
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
  Tag,
  GitCompare,
} from "lucide-react";

interface EntityItem {
  id: string;
  kind: string;
  title: string;
  original_language?: string;
  types?: string[];
  status: string;
  version: number;
  pictures?: { url: string }[];
  work_id?: string;
  release_id?: string;
  translations?: Record<string, { title: string; summary?: string; aliases?: string[] }>;
}

const KINDS = [
  { id: "all", icon: Layers },
  { id: "work", icon: Layers },
  { id: "release", icon: Disc },
  { id: "agent", icon: Users },
  { id: "collection", icon: Network },
  { id: "content_unit", icon: BookOpen },
  { id: "expression", icon: Film },
  { id: "medium", icon: Disc },
  { id: "track", icon: Disc },
];

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
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();

  const { definitions } = useDefinitions();
  const titleOrder = useTitleDisplayOrder();

  const currentKind = searchParams.get("kind") || "all";
  const currentType = searchParams.get("type") || "";
  const currentStatus = searchParams.get("status") || "published";
  const currentQ = searchParams.get("q") || "";
  const currentPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = 24;
  const offset = (currentPage - 1) * limit;

  const [qInput, setQInput] = useState(currentQ);
  const [items, setItems] = useState<EntityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Dynamic types filtered strictly by currently selected entity kind
  const availableTypes = useMemo(() => {
    if (!definitions?.types) return [];
    return Object.entries(definitions.types)
      .filter(([_, def]) => {
        if (def.enabled === false) return false;
        if (currentKind === "all") return true;
        return def.kinds?.includes(currentKind);
      })
      .map(([id, def]) => ({
        id,
        name: resolveLocalizedName(def.names, locale, id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [definitions, currentKind, locale]);

  // Sync search input when URL changes
  useEffect(() => {
    setQInput(currentQ);
  }, [currentQ]);

  // Fetch entities
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (currentKind !== "all") params.set("kind", currentKind);
    if (currentType) params.set("type", currentType);
    if (currentStatus) params.set("status", currentStatus);
    if (currentQ) params.set("q", currentQ);
    params.set("limit", limit.toString());
    params.set("offset", offset.toString());

    fetch("/api/catalog/entities?" + params.toString(), { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setItems(data.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [currentKind, currentType, currentStatus, currentQ, offset]);

  const updateFilters = (updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v) next.set(k, v);
      else next.delete(k);
    });
    // Reset page on filter change
    if (!updates.page) {
      next.delete("page");
    }
    router.push("/explore?" + next.toString());
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: qInput.trim() });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-900 dark:text-gray-100">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full flex-1">
        {/* Header & Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-black/10 dark:border-white/[0.06]">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2.5 font-display">
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface hover:bg-black/[0.04] dark:hover:bg-white/[0.08] border border-black/10 dark:border-white/10 text-xs font-mono text-gray-700 dark:text-gray-300 transition-colors shadow-2xs"
            >
              <GitCompare className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <span>{t("catalog.compare")}</span>
            </Link>

            <Link
              href="/new"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-xs font-medium text-white transition-colors shadow-2xs"
            >
              <Plus className="w-4 h-4" />
              <span>{t("catalog.newEntity")}</span>
            </Link>
          </div>
        </div>

        {/* Kind Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-none">
          {KINDS.map((k) => {
            const Icon = k.icon;
            const active = currentKind === k.id;
            const label = t("catalog.kind." + k.id) || k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => {
                  updateFilters({
                    kind: k.id === "all" ? "" : k.id,
                    type: "", // Reset type when changing kind
                  });
                }}
                className={
                  "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all " +
                  (active
                    ? "bg-primary text-white border border-primary font-semibold shadow-xs"
                    : "bg-surface hover:bg-black/[0.04] dark:hover:bg-white/[0.06] border border-black/10 dark:border-white/[0.08] text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white shadow-2xs")
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Dynamic Type Quick Chips */}
        {availableTypes.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-6 scrollbar-none text-xs">
            <span className="text-gray-500 dark:text-gray-400 shrink-0 text-[11px] font-mono pr-1">
              {t("catalog.allTypes")}:
            </span>
            <button
              type="button"
              onClick={() => updateFilters({ type: "" })}
              className={
                "px-2.5 py-1 rounded-md text-[11px] transition-colors whitespace-nowrap shadow-2xs " +
                (!currentType
                  ? "bg-primary text-white font-semibold border border-primary"
                  : "bg-surface text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06] border border-black/10 dark:border-white/10")
              }
            >
              {t("catalog.kind.all")}
            </button>
            {availableTypes.map((item) => {
              const active = currentType === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updateFilters({ type: active ? "" : item.id })}
                  className={
                    "px-2.5 py-1 rounded-md text-[11px] transition-colors whitespace-nowrap shadow-2xs " +
                    (active
                      ? "bg-primary text-white font-semibold border border-primary shadow-xs"
                      : "bg-surface text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06] border border-black/10 dark:border-white/10")
                  }
                >
                  {item.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Search & Secondary Filter Bar */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-6 p-4 rounded-xl bg-surface border border-black/10 dark:border-white/[0.08] shadow-soft">
          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} className="md:col-span-5 relative flex items-center">
            <Search className="absolute left-3.5 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={t("catalog.searchPlaceholder")}
              className="w-full pl-10 pr-20 py-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-primary focus:bg-surface outline-none transition-all"
            />
            <button
              type="submit"
              className="absolute right-1.5 px-3 py-1 rounded bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold transition-colors cursor-pointer"
            >
              {t("catalog.searchAction")}
            </button>
          </form>

          {/* Dynamic Type Select Filter */}
          <div className="md:col-span-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
            <select
              value={currentType}
              onChange={(e) => updateFilters({ type: e.target.value })}
              className="w-full py-2 px-2.5 rounded-lg bg-surface dark:bg-[#18181b] border border-black/10 dark:border-white/10 text-xs text-gray-800 dark:text-gray-200 focus:border-primary outline-none cursor-pointer"
            >
              <option value="" className="bg-surface dark:bg-[#18181b] text-gray-900 dark:text-gray-100">
                {t("catalog.allTypes")}
              </option>
              {availableTypes.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  className="bg-surface dark:bg-[#18181b] text-gray-900 dark:text-gray-100"
                >
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="md:col-span-2 flex items-center gap-2">
            <select
              value={currentStatus}
              onChange={(e) => updateFilters({ status: e.target.value })}
              className="w-full py-2 px-2.5 rounded-lg bg-surface dark:bg-[#18181b] border border-black/10 dark:border-white/10 text-xs text-gray-800 dark:text-gray-200 focus:border-primary outline-none cursor-pointer"
            >
              <option value="published" className="bg-surface dark:bg-[#18181b] text-gray-900 dark:text-gray-100">
                {t("catalog.status.published")}
              </option>
              <option value="pending_review" className="bg-surface dark:bg-[#18181b] text-gray-900 dark:text-gray-100">
                {t("catalog.status.pending_review")}
              </option>
              <option value="draft" className="bg-surface dark:bg-[#18181b] text-gray-900 dark:text-gray-100">
                {t("catalog.status.draft")}
              </option>
            </select>
          </div>

          {/* View Toggle */}
          <div className="md:col-span-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={
                "p-2 rounded-lg border text-xs transition-colors shadow-2xs cursor-pointer " +
                (viewMode === "grid"
                  ? "bg-primary/15 border-primary/40 text-primary font-bold"
                  : "bg-surface border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white")
              }
              title={t("catalog.gridView")}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={
                "p-2 rounded-lg border text-xs transition-colors shadow-2xs cursor-pointer " +
                (viewMode === "list"
                  ? "bg-primary/15 border-primary/40 text-primary font-bold"
                  : "bg-surface border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white")
              }
              title={t("catalog.listView")}
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Entity List / Grid */}
        {loading ? (
          <div className="py-24 text-center text-gray-500 font-mono text-xs flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <span>{t("catalog.loading")}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 rounded-xl border border-dashed border-black/15 dark:border-white/10 text-center bg-surface/50 shadow-2xs">
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-3">
              {t("catalog.emptyTitle")}
            </p>
            <button
              type="button"
              onClick={() => updateFilters({ q: "", type: "", kind: "" })}
              className="text-xs font-mono text-primary hover:underline cursor-pointer"
            >
              {t("catalog.emptyAction")}
            </button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {items.map((item) => {
              const kindLabel = t("catalog.kind." + item.kind) || item.kind;
              const typeLabels = (item.types || []).map((tCode) => getTypeName(definitions, tCode, locale));
              const displayTitle = getLocalizedTitle(item, locale, titleOrder);
              const badgeLabel = typeLabels[0] || kindLabel;

              return (
                <Link
                  key={item.id}
                  href={"/catalog/" + item.id}
                  className="group flex flex-col rounded-xl bg-surface hover:shadow-elevated border border-black/10 dark:border-white/[0.08] hover:border-primary/50 dark:hover:border-primary/50 overflow-hidden transition-all duration-200"
                >
                  <AdaptiveCardCover
                    src={item.pictures && item.pictures[0]?.url}
                    alt={displayTitle}
                    badge={
                      <span className="px-2 py-0.5 rounded-md bg-black/65 dark:bg-black/75 text-white keep-white backdrop-blur-md border border-white/20 text-[10px] font-medium shadow-2xs flex items-center gap-1.5 leading-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        <span className="truncate max-w-[85px]">{badgeLabel}</span>
                      </span>
                    }
                    statusBadge={
                      item.status !== "published" && (
                        <span className="px-1.5 py-0.5 rounded-md bg-amber-500/90 text-black keep-white text-[9px] font-mono font-bold shadow-2xs">
                          {t("catalog.status." + item.status) || item.status}
                        </span>
                      )
                    }
                    fallbackIcon={
                      item.kind === "work" ? <Layers className="w-5 h-5" /> :
                      item.kind === "release" ? <Disc className="w-5 h-5" /> :
                      item.kind === "agent" ? <Users className="w-5 h-5" /> :
                      item.kind === "collection" ? <Network className="w-5 h-5" /> :
                      item.kind === "content_unit" ? <BookOpen className="w-5 h-5" /> :
                      item.kind === "expression" ? <Film className="w-5 h-5" /> :
                      <Disc className="w-5 h-5" />
                    }
                    fallbackTitle={displayTitle}
                    fallbackSubtitle={badgeLabel}
                    className="border-b border-black/5 dark:border-white/5"
                  />

                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white group-hover:text-primary transition-colors text-xs sm:text-sm line-clamp-1 mb-1">
                        {displayTitle}
                      </h3>
                      {item.title !== displayTitle && (
                        <p className="text-[10px] text-gray-500 font-mono line-clamp-1 mb-1">
                          {item.title}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {typeLabels.slice(0, 2).map((label, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-[10px] text-gray-600 dark:text-gray-300 font-mono border border-black/5 dark:border-white/5"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2.5 pt-1.5 border-t border-black/5 dark:border-white/[0.04] flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                      <span>v{item.version || 1}</span>
                      <span className="text-gray-500 dark:text-gray-400 group-hover:text-primary flex items-center gap-0.5">
                        {t("catalog.viewDetail")}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="rounded-xl border border-black/10 dark:border-white/[0.06] bg-surface overflow-hidden divide-y divide-black/5 dark:divide-white/[0.04] shadow-soft">
            {items.map((item) => {
              const kindLabel = t("catalog.kind." + item.kind) || item.kind;
              const typeLabels = (item.types || []).map((tCode) => getTypeName(definitions, tCode, locale));
              const displayTitle = getLocalizedTitle(item, locale, titleOrder);
              const badgeLabel = typeLabels[0] || kindLabel;

              return (
                <Link
                  key={item.id}
                  href={"/catalog/" + item.id}
                  className="p-3.5 flex items-center justify-between gap-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-lg bg-black/[0.03] dark:bg-black/40 border border-black/10 dark:border-white/10 shrink-0 overflow-hidden flex items-center justify-center">
                      {item.pictures && item.pictures[0]?.url ? (
                        <img src={item.pictures[0].url} alt={displayTitle} className="w-full h-full object-cover" />
                      ) : (
                        <Layers className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-[10px] font-mono text-gray-700 dark:text-gray-300 font-medium">
                          {badgeLabel}
                        </span>
                        <h3 className="font-semibold text-gray-900 dark:text-white group-hover:text-primary transition-colors text-sm truncate">
                          {displayTitle}
                        </h3>
                        {item.title !== displayTitle && (
                          <span className="text-[11px] text-gray-500 font-mono hidden sm:inline truncate">
                            ({item.title})
                          </span>
                        )}
                        {item.status !== "published" && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-mono font-medium">
                            {t("catalog.status." + item.status) || item.status}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-mono">
                        <span>ID: {item.id.slice(0, 8)}...</span>
                        {typeLabels.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{typeLabels.join(", ")}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-xs font-mono text-gray-500 dark:text-gray-400">
                    <span>rev {item.version || 1}</span>
                    <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-600 group-hover:text-primary transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        <div className="mt-8 flex items-center justify-between border-t border-black/10 dark:border-white/[0.06] pt-4 text-xs font-mono text-gray-600 dark:text-gray-400">
          <div>
            <span>
              {t("catalog.showingPage", {
                start: (offset + 1).toString(),
                end: (offset + items.length).toString(),
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => updateFilters({ page: (currentPage - 1).toString() })}
              className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-surface hover:bg-black/[0.04] dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none text-gray-800 dark:text-white transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{t("catalog.prevPage")}</span>
            </button>
            <span className="px-2 py-1 text-gray-900 dark:text-gray-200 font-bold">{currentPage}</span>
            <button
              type="button"
              disabled={items.length < limit}
              onClick={() => updateFilters({ page: (currentPage + 1).toString() })}
              className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-surface hover:bg-black/[0.04] dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none text-gray-800 dark:text-white transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
            >
              <span>{t("catalog.nextPage")}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background text-gray-500 font-mono text-xs grid place-items-center">Loading...</div>}>
      <ExploreInner />
    </Suspense>
  );
}
