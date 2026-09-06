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
  Users,
  Network,
  BookOpen,
  Film,
  Gamepad2,
  Camera,
  GitCompare,
  ArrowRight,
  Shield,
  Plus,
  Sparkles,
  CheckCircle2,
  FileCode,
  DownloadCloud,
} from "lucide-react";

interface RecentItem {
  id: string;
  kind: string;
  title: string;
  original_language?: string;
  types?: string[];
  pictures?: { url: string }[];
  version?: number;
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    works: 0,
    releases: 0,
    agents: 0,
    collections: 0,
  });

  useEffect(() => {
    fetch("/api/catalog/entities?limit=8", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => {
        const items: RecentItem[] = data.items || [];
        setRecentItems(items);
        setStats({
          works: items.filter((i) => i.kind === "work").length,
          releases: items.filter((i) => i.kind === "release").length,
          agents: items.filter((i) => i.kind === "agent").length,
          collections: items.filter((i) => i.kind === "collection").length,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/explore?q=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      router.push("/explore");
    }
  };

  const categories = [
    {
      id: "music",
      name: locale === "zh-CN" ? "音乐与唱片" : "Music & Records",
      desc: locale === "zh-CN" ? "专辑、单曲、CD、黑胶 2LP 与曲目收录" : "Albums, Singles, CDs, Vinyl LPs & Tracks",
      icon: Disc,
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      query: "type=album",
    },
    {
      id: "anime",
      name: locale === "zh-CN" ? "动画与影视" : "Anime & Films",
      desc: locale === "zh-CN" ? "分集、篇章、TV 放送版与 BD 修正剪辑版" : "Episodes, Arcs, Broadcast & BD Cuts",
      icon: Film,
      color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
      query: "type=animation",
    },
    {
      id: "novel",
      name: locale === "zh-CN" ? "文学与出版" : "Literature & Books",
      desc: locale === "zh-CN" ? "小说章节、日文原文、多语言授权译本" : "Chapters, Original texts & Translations",
      icon: BookOpen,
      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      query: "type=novel",
    },
    {
      id: "game",
      name: locale === "zh-CN" ? "独立游戏" : "Indie Games",
      desc: locale === "zh-CN" ? "独立游戏、视觉小说分支路线与跨平台发行" : "Visual novels, Routes & Multiplatform releases",
      icon: Gamepad2,
      color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
      query: "type=game",
    },
    {
      id: "personal",
      name: locale === "zh-CN" ? "个人创作与写真" : "Personal Creations",
      desc: locale === "zh-CN" ? "摄影写真集、翻唱录音母版、同人作品" : "Photobooks, Vocal covers & Doujin works",
      icon: Camera,
      color: "text-rose-400 bg-rose-500/10 border-rose-500/20",
      query: "type=photobook",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-16 md:pt-20 md:pb-24 border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[150px] pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs font-mono text-gray-300 mb-6">
            <BrandMark size={16} withGlow={false} />
            <span>METAFUSION CATALOG V2</span>
            <span className="text-white/20">•</span>
            <span className="text-primary font-semibold">
              {locale === "zh-CN" ? "固定骨架 · 动态定义" : "Fixed Core · Dynamic Definitions"}
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white mb-6 leading-[1.15]">
            {locale === "zh-CN" ? (
              <>
                跨媒介开放媒体<span className="text-primary">元数据知识库</span>
              </>
            ) : (
              <>
                Open Cross-Media <span className="text-primary">Metadata Knowledge Base</span>
              </>
            )}
          </h1>

          <p className="text-base sm:text-lg text-gray-400 max-w-2xl mx-auto mb-8 leading-relaxed">
            {locale === "zh-CN"
              ? "分离创作身份与物理发行，支持多版本载体收录、章节译本树与带上下文关系。无论商业专辑、分季动画还是个人写真与翻唱，皆可严谨建档。"
              : "Separates creative work from release media, supporting multi-edition carriers, logical chapter trees, and contextual relations. Ideal for albums, anime, novels, indie games, and personal creations."}
          </p>

          {/* Search Box */}
          <form onSubmit={handleSearch} className="max-w-2xl mx-auto mb-10">
            <div className="relative flex items-center">
              <Search className="absolute left-4 w-5 h-5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  locale === "zh-CN"
                    ? "搜索作品、发行版本、创作者或企划..."
                    : "Search works, releases, agents or collections..."
                }
                className="w-full pl-12 pr-28 py-3.5 rounded-xl bg-white/[0.06] border border-white/10 hover:border-white/20 focus:border-primary focus:ring-1 focus:ring-primary text-white text-base placeholder:text-gray-500 outline-none transition-all shadow-lg shadow-black/20"
              />
              <button
                type="submit"
                className="absolute right-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                {locale === "zh-CN" ? "检索" : "Search"}
              </button>
            </div>
          </form>

          {/* Action Shortcuts */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm font-medium transition-all"
            >
              <Layers className="w-4 h-4 text-sky-400" />
              <span>{locale === "zh-CN" ? "探索全站元数据" : "Explore Catalog"}</span>
              <ArrowRight className="w-4 h-4 text-gray-400" />
            </Link>

            <Link
              href="/catalog/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary hover:text-white text-sm font-medium transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>{locale === "zh-CN" ? "创建新实体" : "Create New Entity"}</span>
            </Link>

            <Link
              href="/catalog/compare"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-300 text-sm font-medium transition-all"
            >
              <GitCompare className="w-4 h-4 text-amber-400" />
              <span>{locale === "zh-CN" ? "多版本比较" : "Compare Editions"}</span>
            </Link>

            <a
              href="/docs/catalog"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-400 hover:text-gray-200 text-sm font-medium transition-all"
            >
              <FileCode className="w-4 h-4" />
              <span>{locale === "zh-CN" ? "编目指南" : "Docs"}</span>
            </a>

            {user?.role === "admin" && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-sm font-medium transition-all"
              >
                <Shield className="w-4 h-4" />
                <span>{locale === "zh-CN" ? "后台管理" : "Admin Panel"}</span>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Categories Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              {locale === "zh-CN" ? "媒介分类与领域" : "Media Domains"}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {locale === "zh-CN" ? "覆盖主流商业出版与个人独立创作领域" : "Covering commercial releases and indie creations"}
            </p>
          </div>
          <Link
            href="/explore"
            className="text-xs font-mono text-primary hover:underline flex items-center gap-1"
          >
            <span>{locale === "zh-CN" ? "查看全部分类" : "View All"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {categories.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.id}
                href={`/explore?${c.query}`}
                className="group p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/15 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className={`w-10 h-10 rounded-lg border flex items-center justify-center mb-3 ${c.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-white group-hover:text-primary transition-colors text-base mb-1">
                    {c.name}
                  </h3>
                  <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{c.desc}</p>
                </div>
                <div className="mt-4 flex items-center gap-1 text-xs font-mono text-gray-500 group-hover:text-gray-300">
                  <span>{locale === "zh-CN" ? "进入探索" : "Explore"}</span>
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Recent Entries */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">
              {locale === "zh-CN" ? "最新收录与维护" : "Recent Entities"}
            </h2>
          </div>
          <Link
            href="/explore"
            className="text-xs font-mono text-primary hover:underline flex items-center gap-1"
          >
            <span>{locale === "zh-CN" ? "更多条目" : "More"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-500 font-mono text-xs">
            {locale === "zh-CN" ? "正在加载实体数据..." : "Loading catalog entities..."}
          </div>
        ) : recentItems.length === 0 ? (
          <div className="p-8 rounded-xl border border-dashed border-white/10 text-center bg-white/[0.01]">
            <p className="text-gray-400 text-sm mb-4">
              {locale === "zh-CN"
                ? "元数据核心已就绪，当前暂无公开条目。快来创建第一条作品或发行吧！"
                : "Catalog core is ready. No published entities yet. Create the first work or release!"}
            </p>
            <Link
              href="/catalog/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{locale === "zh-CN" ? "创建首个条目" : "Create First Entity"}</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {recentItems.map((item) => (
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
                    <div className="flex flex-col items-center gap-2 text-gray-600">
                      {item.kind === "work" && <Layers className="w-8 h-8" />}
                      {item.kind === "release" && <Disc className="w-8 h-8" />}
                      {item.kind === "agent" && <Users className="w-8 h-8" />}
                      {item.kind === "collection" && <Network className="w-8 h-8" />}
                      <span className="text-[10px] font-mono uppercase tracking-wider">{item.kind}</span>
                    </div>
                  )}
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md text-[10px] font-mono text-gray-300 uppercase">
                    {item.kind}
                  </span>
                </div>
                <div className="p-3.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-medium text-white group-hover:text-primary transition-colors text-sm line-clamp-1 mb-1">
                      {item.title}
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {item.types?.map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 rounded bg-white/[0.05] text-[10px] text-gray-400 font-mono"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-white/[0.04] flex items-center justify-between text-[11px] text-gray-500 font-mono">
                    <span>v{item.version || 1}</span>
                    <span className="group-hover:text-gray-300 transition-colors">
                      {locale === "zh-CN" ? "查看详情 →" : "View →"}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Architecture Highlights */}
      <section className="border-t border-white/[0.06] bg-white/[0.01] py-14">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-white mb-2">
              {locale === "zh-CN" ? "面向全媒介的元数据架构" : "Engineered for All Media Types"}
            </h2>
            <p className="text-sm text-gray-400">
              {locale === "zh-CN" ? "八大固定实体骨架，保障核心关系严肃严谨，外围模块完全按需启用" : "Fixed 8-entity core ensuring integrity, with optional detached peripheral modules"}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 rounded-xl border border-white/[0.06] bg-black/20">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center mb-3">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white mb-2 text-base">
                {locale === "zh-CN" ? "创作身份与物理载体分离" : "Works vs. Physical Releases"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "单曲 Work 的录音 Expression 可同时收录在普通单曲 CD、后续完整专辑和黑胶 2LP 中，绝不产生重复条目。"
                  : "A single track's Expression can be reused across CDs, later albums, and Vinyl LPs without duplicated entities."}
              </p>
            </div>

            <div className="p-5 rounded-xl border border-white/[0.06] bg-black/20">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-3">
                <GitCompare className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white mb-2 text-base">
                {locale === "zh-CN" ? "多版本发售与独占特典" : "Editions & Disc Carrier Sets"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "清晰区分普通版、附带 MV BD 的限定版与特装盒。盒内载体与店铺外送特典严格分开，支持一键多版本对比。"
                  : "Structure regular editions, BD-included limited editions, and collector boxes with distinct disc mappings and bonuses."}
              </p>
            </div>

            <div className="p-5 rounded-xl border border-white/[0.06] bg-black/20">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white mb-2 text-base">
                {locale === "zh-CN" ? "外围解耦 · 纯元数据自洽" : "Decoupled Peripheral Modules"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "元数据核心只依赖 PostgreSQL，无需文件即可独立建档。文件归档、在线播放与社区论坛为可选模块，互不拖垮。"
                  : "Pure metadata operates on PostgreSQL alone without files. File storage, media playback, and community are fully detached."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-6 text-center text-xs font-mono text-gray-500">
        <p>© 2026 MetaFusion · Open Archival Metadata Engine</p>
      </footer>
    </div>
  );
}
