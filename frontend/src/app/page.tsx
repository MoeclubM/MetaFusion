"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import { BrandMark } from "@/components/Logo";
import {
  Search,
  Disc,
  Layers,
  BookOpen,
  Film,
  Tv,
  Gamepad2,
  Camera,
  GitCompare,
  ArrowRight,
  Shield,
  Plus,
  Sparkles,
  CheckCircle2,
  FileCode,
  ChevronRight,
} from "lucide-react";

interface EntityItem {
  id: string;
  kind: string;
  title: string;
  original_language?: string;
  types?: string[];
  pictures?: { url: string }[];
  version?: number;
}

interface ShelfItem {
  slug: string;
  name_zh: string;
  name_en: string;
  icon: React.ElementType;
  color: string;
  border: string;
  query_tags: string[];
  types: string[];
  exploreParam: string;
}

const DEFAULT_SHELVES: ShelfItem[] = [
  {
    slug: "music",
    name_zh: "音乐与唱片",
    name_en: "Music & Records",
    icon: Disc,
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    border: "hover:border-amber-500/40",
    query_tags: ["音乐", "专辑", "单曲", "原声"],
    types: ["album", "single", "music", "song"],
    exploreParam: "type=album",
  },
  {
    slug: "anime",
    name_zh: "动画与番剧",
    name_en: "Anime & Shows",
    icon: Tv,
    color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    border: "hover:border-sky-500/40",
    query_tags: ["动画", "番剧", "剧集"],
    types: ["animation", "series"],
    exploreParam: "type=animation",
  },
  {
    slug: "films",
    name_zh: "电影与长片",
    name_en: "Movies & Films",
    icon: Film,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    border: "hover:border-purple-500/40",
    query_tags: ["电影", "长片", "剧场版"],
    types: ["film", "movie"],
    exploreParam: "type=film",
  },
  {
    slug: "novels",
    name_zh: "文学与轻小说",
    name_en: "Books & Literature",
    icon: BookOpen,
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    border: "hover:border-emerald-500/40",
    query_tags: ["小说", "轻小说", "图书"],
    types: ["novel", "book"],
    exploreParam: "type=novel",
  },
  {
    slug: "games",
    name_zh: "独立游戏与视觉小说",
    name_en: "Indie Games",
    icon: Gamepad2,
    color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    border: "hover:border-indigo-500/40",
    query_tags: ["游戏", "独立游戏", "视觉小说"],
    types: ["game", "visual_novel", "indie_game"],
    exploreParam: "type=game",
  },
  {
    slug: "creations",
    name_zh: "摄影写真与个人创作",
    name_en: "Photobooks & Doujin",
    icon: Camera,
    color: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    border: "hover:border-rose-500/40",
    query_tags: ["写真", "摄影", "同人", "翻唱"],
    types: ["photobook", "doujin", "artbook", "personal"],
    exploreParam: "type=photobook",
  },
];

export default function HomePage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/catalog/entities?limit=100", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => {
        setEntities(data.items || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push("/explore?q=" + encodeURIComponent(searchQuery.trim()));
    } else {
      router.push("/explore");
    }
  };

  const matchShelfItems = (shelf: ShelfItem) => {
    return entities.filter((item) => {
      const types = item.types || [];
      const hasType = shelf.types.some((st) => types.includes(st));
      if (hasType) return true;
      const titleLower = (item.title || "").toLowerCase();
      return shelf.query_tags.some((tag) => titleLower.includes(tag.toLowerCase()));
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-10 pb-12 md:pt-16 md:pb-16 border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[150px] pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs font-mono text-gray-300 mb-5">
            <BrandMark size={16} withGlow={false} />
            <span>METAFUSION</span>
            <span className="text-white/20">•</span>
            <span className="text-primary font-semibold">
              {locale === "zh-CN" ? "固定骨架 · 动态标签货架" : "Fixed Core · Virtual Shelves"}
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-4 leading-[1.15]">
            {locale === "zh-CN" ? (
              <>
                跨媒介开放媒体 <span className="text-primary">元数据与分类货架</span>
              </>
            ) : (
              <>
                Open Cross-Media <span className="text-primary">Metadata & Virtual Shelves</span>
              </>
            )}
          </h1>

          <p className="text-sm sm:text-base text-gray-400 max-w-2xl mx-auto mb-6 leading-relaxed">
            {locale === "zh-CN"
              ? "无硬编码媒体树，以作品、版本与标签货架驱动组织。商业专辑、分季动画、轻小说、独立游戏与个人写真皆可在此建立完备档案。"
              : "Organized via works, releases, and tag-driven virtual shelves. Complete archives for albums, anime, novels, indie games, and personal photobooks."}
          </p>

          {/* Search Box */}
          <form onSubmit={handleSearch} className="max-w-2xl mx-auto mb-8">
            <div className="relative flex items-center">
              <Search className="absolute left-4 w-5 h-5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  locale === "zh-CN"
                    ? "搜索作品、发行版本、创作者、标签或企划..."
                    : "Search works, releases, agents, tags or collections..."
                }
                className="w-full pl-12 pr-28 py-3.5 rounded-xl bg-white/[0.06] border border-white/10 hover:border-white/20 focus:border-primary focus:ring-1 focus:ring-primary text-white text-base placeholder:text-gray-500 outline-none transition-all shadow-lg shadow-black/20"
              />
              <button
                type="submit"
                className="absolute right-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white font-medium text-sm transition-colors shadow-sm"
              >
                {locale === "zh-CN" ? "搜索" : "Search"}
              </button>
            </div>
          </form>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-medium transition-all"
            >
              <Layers className="w-4 h-4 text-sky-400" />
              <span>{locale === "zh-CN" ? "探索全域目录" : "Explore All"}</span>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
            </Link>

            <Link
              href="/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary hover:text-white text-xs font-medium transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>{locale === "zh-CN" ? "新建实体" : "New Entity"}</span>
            </Link>

            <Link
              href="/compare"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-300 text-xs font-medium transition-all"
            >
              <GitCompare className="w-4 h-4 text-amber-400" />
              <span>{locale === "zh-CN" ? "多版本对比" : "Compare Editions"}</span>
            </Link>

            <a
              href="/docs/catalog"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-400 hover:text-gray-200 text-xs font-medium transition-all"
            >
              <FileCode className="w-4 h-4" />
              <span>{locale === "zh-CN" ? "编目指南" : "Docs"}</span>
            </a>

            {user?.role === "admin" && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-medium transition-all"
              >
                <Shield className="w-4 h-4" />
                <span>{locale === "zh-CN" ? "后台管理" : "Admin Panel"}</span>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Main Shelves Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full flex-1 space-y-10">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>{locale === "zh-CN" ? "主页主题货架" : "Home Virtual Shelves"}</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {locale === "zh-CN"
                ? "基于标签 (Tags) 与类型聚合的流式陈列通道，自由呈现各领域作品"
                : "Dynamic channel streams aggregated by tags and types"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/explore"
              className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline"
            >
              <span>{locale === "zh-CN" ? "浏览全部标签 ↗" : "Browse All Tags ↗"}</span>
            </Link>
          </div>
        </div>

        {/* Shelves Loop */}
        <div className="space-y-10">
          {DEFAULT_SHELVES.map((shelf) => {
            const items = matchShelfItems(shelf);
            const Icon = shelf.icon;

            return (
              <section key={shelf.slug} className="space-y-4">
                {/* Shelf Header */}
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
                  <div className="flex items-center gap-3">
                    <div className={"w-9 h-9 rounded-lg border flex items-center justify-center " + shelf.color}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-base">
                          {locale === "zh-CN" ? shelf.name_zh : shelf.name_en}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[11px] font-mono text-gray-400">
                          {items.length} {locale === "zh-CN" ? "部作品" : "items"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {shelf.query_tags.map((t) => (
                          <span key={t} className="text-[11px] font-mono text-gray-500">
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <Link
                    href={"/explore?" + shelf.exploreParam}
                    className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:text-primary/80 transition-colors group"
                  >
                    <span>{locale === "zh-CN" ? "查看此货架" : "View Shelf"}</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>

                {/* Shelf Items Scroll / Grid */}
                {loading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="aspect-[3/4] rounded-xl bg-white/[0.02] border border-white/[0.06] animate-pulse" />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-white/10 bg-white/[0.01] text-center space-y-2">
                    <p className="text-xs font-mono text-gray-500">
                      {locale === "zh-CN"
                        ? "当前【" + shelf.name_zh + "】货架暂无收录内容"
                        : "No items in " + shelf.name_en + " shelf yet"}
                    </p>
                    <Link
                      href="/new?kind=work"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{locale === "zh-CN" ? "为该分类创建首部作品" : "Add First Entry"}</span>
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3.5">
                    {items.slice(0, 5).map((item) => (
                      <Link
                        key={item.id}
                        href={"/catalog/" + item.id}
                        className={"group flex flex-col rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] " + shelf.border + " overflow-hidden transition-all shadow-sm"}
                      >
                        <div className="aspect-[3/4] bg-black/40 relative flex items-center justify-center overflow-hidden">
                          {item.pictures && item.pictures[0]?.url ? (
                            <img
                              src={item.pictures[0].url}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-gray-600">
                              <Icon className="w-8 h-8 opacity-40" />
                              <span className="text-[10px] font-mono uppercase tracking-wider">
                                {item.types?.[0] || item.kind}
                              </span>
                            </div>
                          )}
                          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-[9px] font-mono text-gray-300 uppercase">
                            {item.types?.[0] || item.kind}
                          </span>
                        </div>
                        <div className="p-3 flex-1 flex flex-col justify-between">
                          <div>
                            <h4 className="font-semibold text-white group-hover:text-primary transition-colors text-xs line-clamp-1 mb-1">
                              {item.title}
                            </h4>
                            {item.original_language && (
                              <p className="font-mono text-[10px] text-gray-500 uppercase">
                                [{item.original_language}]
                              </p>
                            )}
                          </div>
                          <div className="mt-2 pt-1.5 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-gray-500 font-mono">
                            <span>v{item.version || 1}</span>
                            <span className="group-hover:text-gray-300 transition-colors flex items-center gap-0.5">
                              {locale === "zh-CN" ? "详情" : "View"} <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {/* Architecture Highlights */}
      <section className="border-t border-white/[0.06] bg-white/[0.01] py-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <h2 className="text-xl font-bold text-white mb-2">
              {locale === "zh-CN" ? "面向全媒介的元数据架构" : "Engineered for All Media Types"}
            </h2>
            <p className="text-xs text-gray-400">
              {locale === "zh-CN" ? "固定实体骨架保障严谨引用，动态标签货架驱动生动展示" : "Fixed core ensuring integrity, dynamic tag shelves driving lively discovery"}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center mb-2.5">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white mb-1.5 text-sm">
                {locale === "zh-CN" ? "创作身份与物理载体分离" : "Works vs. Physical Releases"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "单曲 Work 的录音 Expression 可同时收录在普通单曲 CD、后续完整专辑和黑胶 2LP 中，绝不产生重复条目。"
                  : "A single track expression can be reused across CDs, later albums, and Vinyl LPs without duplicated entities."}
              </p>
            </div>

            <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-2.5">
                <GitCompare className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white mb-1.5 text-sm">
                {locale === "zh-CN" ? "多版本发售与独占特典" : "Editions & Disc Carrier Sets"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "严谨区分普通盘、附送 MV BD 的限定盘、豪华装盒。盘片与内附特典严格分开，支持一键多版本对比。"
                  : "Structure regular editions, BD-included limited editions, and collector boxes with distinct disc mappings and bonuses."}
              </p>
            </div>

            <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-2.5">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white mb-1.5 text-sm">
                {locale === "zh-CN" ? "外围解耦 · 纯元数据自洽" : "Decoupled Peripheral Modules"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "元数据核心只依赖 PostgreSQL，无需文件即可独立建档。文件归档、在线播放与社区论坛为可选模块，互不拖累。"
                  : "Pure metadata operates on PostgreSQL alone without files. File storage, media playback, and community are fully detached."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-6 text-center text-xs font-mono text-gray-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>© 2026 MetaFusion · Open Metadata Platform</span>
          <div className="flex items-center gap-4">
            <Link href="/explore" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "探索中心" : "Explore"}
            </Link>
            <Link href="/compare" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "版本比对" : "Compare"}
            </Link>
            <Link href="/community" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "社区论坛" : "Community"}
            </Link>
            <Link href="/downloads" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "下载管理" : "Downloads"}
            </Link>
            <a href="/docs/catalog" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "文档中心" : "Documentation"}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
