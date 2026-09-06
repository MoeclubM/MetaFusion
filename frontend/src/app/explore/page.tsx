"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
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
  Filter,
  Check,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Tag,
  Clock,
  Sparkles,
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
  { id: "all", labelZh: "全部实体", labelEn: "All Kinds", icon: Layers },
  { id: "work", labelZh: "作品 (Work)", labelEn: "Works", icon: Layers },
  { id: "release", labelZh: "发行版 (Release)", labelEn: "Releases", icon: Disc },
  { id: "agent", labelZh: "主体 (Agent)", labelEn: "Agents", icon: Users },
  { id: "collection", labelZh: "企划 (Collection)", labelEn: "Collections", icon: Network },
  { id: "content_unit", labelZh: "逻辑单元 (Unit)", labelEn: "Content Units", icon: BookOpen },
  { id: "expression", labelZh: "表达 (Expression)", labelEn: "Expressions", icon: Film },
  { id: "medium", labelZh: "载体 (Medium)", labelEn: "Mediums", icon: Disc },
  { id: "track", labelZh: "曲目位置 (Track)", labelEn: "Tracks", icon: Disc },
];

function ExploreInner() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();

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
  const [definitions, setDefinitions] = useState<any>(null);

  // Load dynamic definitions for type filter
  useEffect(() => {
    fetch("/api/catalog/definitions", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setDefinitions(d?.document || null))
      .catch(() => {});
  }, []);

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

    fetch(`/api/catalog/entities?${params.toString()}`, { credentials: "same-origin" })
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
    router.push(`/explore?${next.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: qInput.trim() });
  };

  const availableTypes = definitions?.types ? Object.keys(definitions.types) : [];

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full flex-1">
        {/* Header & Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-white/[0.06]">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <Layers className="w-7 h-7 text-primary" />
              <span>{locale === "zh-CN" ? "元数据探索中心" : "Metadata Explorer"}</span>
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {locale === "zh-CN"
                ? "基于固定 8 种实体骨架与动态类型定义的开放检索平台"
                : "Browse and discover works, releases, agents, and logical units"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/compare"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-mono text-gray-300 transition-colors"
            >
              <GitCompare className="w-4 h-4 text-amber-400" />
              <span>{locale === "zh-CN" ? "多版本对比" : "Compare"}</span>
            </Link>

            <Link
              href="/new"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-xs font-medium text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{locale === "zh-CN" ? "新建条目" : "New Entity"}</span>
            </Link>
          </div>
        </div>

        {/* Kind Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-6 scrollbar-none">
          {KINDS.map((k) => {
            const Icon = k.icon;
            const active = currentKind === k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => updateFilters({ kind: k.id === "all" ? "" : k.id })}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  active
                    ? "bg-primary text-white border border-primary font-semibold shadow-xs"
                    : "bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] text-gray-400 hover:text-white"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{locale === "zh-CN" ? k.labelZh : k.labelEn}</span>
              </button>
            );
          })}
        </div>

        {/* Search & Secondary Filter Bar */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} className="md:col-span-5 relative flex items-center">
            <Search className="absolute left-3.5 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={
                locale === "zh-CN" ? "按实体题名或标识检索..." : "Search by title or identifier..."
              }
              className="w-full pl-10 pr-20 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-gray-500 focus:border-primary outline-none transition-all"
            />
            <button
              type="submit"
              className="absolute right-1.5 px-3 py-1 rounded bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors"
            >
              {locale === "zh-CN" ? "搜索" : "Search"}
            </button>
          </form>

          {/* Dynamic Type Filter */}
          <div className="md:col-span-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-gray-500 shrink-0" />
            <select
              value={currentType}
              onChange={(e) => updateFilters({ type: e.target.value })}
              className="w-full py-2 px-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-gray-300 focus:border-primary outline-none"
            >
              <option value="">{locale === "zh-CN" ? "全部类型 (All Types)" : "All Types"}</option>
              {availableTypes.map((t) => {
                const label = definitions?.types[t]?.names?.[locale] || definitions?.types[t]?.names?.["zh-CN"] || t;
                return (
                  <option key={t} value={t}>
                    {label} ({t})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Status Filter */}
          <div className="md:col-span-2 flex items-center gap-2">
            <select
              value={currentStatus}
              onChange={(e) => updateFilters({ status: e.target.value })}
              className="w-full py-2 px-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-gray-300 focus:border-primary outline-none"
            >
              <option value="published">{locale === "zh-CN" ? "已发布 (Published)" : "Published"}</option>
              <option value="pending_review">{locale === "zh-CN" ? "待审核 (Pending)" : "Pending Review"}</option>
              <option value="draft">{locale === "zh-CN" ? "草稿 (Draft)" : "Draft"}</option>
            </select>
          </div>

          {/* View Toggle */}
          <div className="md:col-span-2 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded-lg border text-xs transition-colors ${
                viewMode === "grid"
                  ? "bg-primary/20 border-primary text-primary"
                  : "bg-white/[0.03] border-white/10 text-gray-400 hover:text-white"
              }`}
              title={locale === "zh-CN" ? "网格视图" : "Grid View"}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`p-2 rounded-lg border text-xs transition-colors ${
                viewMode === "list"
                  ? "bg-primary/20 border-primary text-primary"
                  : "bg-white/[0.03] border-white/10 text-gray-400 hover:text-white"
              }`}
              title={locale === "zh-CN" ? "列表视图" : "List View"}
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Entity List / Grid */}
        {loading ? (
          <div className="py-24 text-center text-gray-500 font-mono text-xs flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <span>{locale === "zh-CN" ? "正在获取元数据目录..." : "Loading catalog..."}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 rounded-xl border border-dashed border-white/10 text-center bg-white/[0.01]">
            <p className="text-gray-400 text-sm mb-3">
              {locale === "zh-CN"
                ? "未找到匹配的元数据实体。"
                : "No matching metadata entities found."}
            </p>
            <button
              type="button"
              onClick={() => updateFilters({ q: "", type: "", kind: "" })}
              className="text-xs font-mono text-primary hover:underline cursor-pointer"
            >
              {locale === "zh-CN" ? "清除筛选条件" : "Clear filters"}
            </button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/catalog/${item.id}`}
                className="group flex flex-col rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/15 overflow-hidden transition-all"
              >
                <div className="aspect-square bg-black/40 relative flex items-center justify-center overflow-hidden">
                  {item.pictures && item.pictures[0]?.url ? (
                    <img
                      src={item.pictures[0].url}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-gray-600">
                      {item.kind === "work" && <Layers className="w-8 h-8" />}
                      {item.kind === "release" && <Disc className="w-8 h-8" />}
                      {item.kind === "agent" && <Users className="w-8 h-8" />}
                      {item.kind === "collection" && <Network className="w-8 h-8" />}
                      {item.kind === "content_unit" && <BookOpen className="w-8 h-8" />}
                      <span className="text-[9px] font-mono uppercase tracking-wider">{item.kind}</span>
                    </div>
                  )}
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md text-[9px] font-mono text-gray-300 uppercase">
                    {item.kind}
                  </span>
                  {item.status !== "published" && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-amber-500/80 text-black text-[9px] font-mono font-bold">
                      {item.status}
                    </span>
                  )}
                </div>

                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-medium text-white group-hover:text-primary transition-colors text-xs sm:text-sm line-clamp-1 mb-1">
                      {item.title}
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {item.types?.slice(0, 2).map((t) => (
                        <span
                          key={t}
                          className="px-1 py-0.2 rounded bg-white/[0.05] text-[9px] text-gray-400 font-mono"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2.5 pt-1.5 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-gray-500 font-mono">
                    <span>v{item.version || 1}</span>
                    <span className="text-gray-600 group-hover:text-primary">
                      {locale === "zh-CN" ? "查看" : "View"}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden divide-y divide-white/[0.04]">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/catalog/${item.id}`}
                className="p-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-black/40 border border-white/10 shrink-0 overflow-hidden flex items-center justify-center">
                    {item.pictures && item.pictures[0]?.url ? (
                      <img src={item.pictures[0].url} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <Layers className="w-4 h-4 text-gray-500" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono text-gray-300 uppercase">
                        {item.kind}
                      </span>
                      <h3 className="font-medium text-white group-hover:text-primary transition-colors text-sm truncate">
                        {item.title}
                      </h3>
                      {item.status !== "published" && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 text-[10px] font-mono">
                          {item.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 font-mono">
                      <span>ID: {item.id.slice(0, 8)}...</span>
                      {item.types && item.types.length > 0 && (
                        <>
                          <span>•</span>
                          <span>{item.types.join(", ")}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 text-xs font-mono text-gray-500">
                  <span>rev {item.version || 1}</span>
                  <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-primary transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        <div className="mt-8 flex items-center justify-between border-t border-white/[0.06] pt-4 text-xs font-mono text-gray-400">
          <div>
            <span>
              {locale === "zh-CN"
                ? `显示第 ${offset + 1} - ${offset + items.length} 项`
                : `Showing ${offset + 1} - ${offset + items.length}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => updateFilters({ page: (currentPage - 1).toString() })}
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none text-white transition-colors flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{locale === "zh-CN" ? "上一页" : "Previous"}</span>
            </button>
            <span className="px-2 py-1 text-gray-300 font-bold">{currentPage}</span>
            <button
              type="button"
              disabled={items.length < limit}
              onClick={() => updateFilters({ page: (currentPage + 1).toString() })}
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none text-white transition-colors flex items-center gap-1"
            >
              <span>{locale === "zh-CN" ? "下一页" : "Next"}</span>
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
