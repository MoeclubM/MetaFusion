"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions, getTypeName } from "@/lib/definitions";
import { AdaptiveCardCover } from "@/components/common/AdaptiveCardCover";
import {
  Search,
  Disc,
  BookOpen,
  Film,
  Tv,
  Gamepad2,
  Camera,
  ChevronRight,
  Plus,
} from "lucide-react";

interface EntityItem {
  id: string;
  kind: string;
  title: string;
  original_language?: string;
  translations?: Record<string, { title?: string; summary?: string; aliases?: string[] }>;
  types?: string[];
  pictures?: { url: string }[];
  version?: number;
}

interface ShelfItem {
  slug: string;
  icon: React.ElementType;
  color: string;
  border: string;
  query_tags: string[];
  types: string[];
  exploreParam: string;
  aspectClassName?: string;
}

const DEFAULT_SHELVES: ShelfItem[] = [
  {
    slug: "music",
    icon: Disc,
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    border: "hover:border-amber-500/40",
    query_tags: ["音乐", "专辑", "单曲", "原声"],
    types: ["album", "single", "music", "song"],
    exploreParam: "kind=work&type=album",
    aspectClassName: "aspect-square",
  },
  {
    slug: "anime",
    icon: Tv,
    color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    border: "hover:border-sky-500/40",
    query_tags: ["动画", "番剧", "剧集"],
    types: ["animation", "series", "tv"],
    exploreParam: "kind=work&type=animation",
    aspectClassName: "aspect-[3/4]",
  },
  {
    slug: "films",
    icon: Film,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    border: "hover:border-purple-500/40",
    query_tags: ["电影", "长片", "剧场版"],
    types: ["film", "movie"],
    exploreParam: "kind=work&type=film",
    aspectClassName: "aspect-[3/4]",
  },
  {
    slug: "novels",
    icon: BookOpen,
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    border: "hover:border-emerald-500/40",
    query_tags: ["小说", "轻小说", "图书"],
    types: ["novel", "book"],
    exploreParam: "kind=work&type=novel",
    aspectClassName: "aspect-[3/4]",
  },
  {
    slug: "games",
    icon: Gamepad2,
    color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    border: "hover:border-indigo-500/40",
    query_tags: ["游戏", "独立游戏", "视觉小说"],
    types: ["game", "visual_novel", "indie_game"],
    exploreParam: "kind=work&type=game",
    aspectClassName: "aspect-[4/3]",
  },
  {
    slug: "creations",
    icon: Camera,
    color: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    border: "hover:border-rose-500/40",
    query_tags: ["写真", "摄影", "同人", "翻唱"],
    types: ["photobook", "doujin", "artbook", "personal"],
    exploreParam: "kind=work&type=photobook",
    aspectClassName: "aspect-[3/4]",
  },
];

export default function HomePage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { definitions } = useDefinitions();

  const getDisplayTitle = (item: EntityItem, loc: string): string => {
    const shortLocale = loc.split("-")[0];
    const tr = item.translations || {};
    return (
      tr[loc]?.title ||
      tr[shortLocale]?.title ||
      tr["zh-CN"]?.title ||
      tr["zh"]?.title ||
      tr["ja"]?.title ||
      tr["en-US"]?.title ||
      tr["en"]?.title ||
      (item.original_language ? tr[item.original_language]?.title : "") ||
      item.title
    );
  };

  const getCardBadge = (item: EntityItem, defs: any, loc: string, translate: (k: string) => string): string => {
    if (item.types && item.types.length > 0) {
      for (const tCode of item.types) {
        const typeName = getTypeName(defs, tCode, loc);
        if (typeName && typeName !== tCode) {
          return typeName;
        }
      }
    }
    const kindKey = "catalog.kind." + item.kind;
    const translated = translate(kindKey);
    if (translated && translated !== kindKey) {
      return translated;
    }
    if (item.kind === "work") return loc === "zh-CN" ? "作品" : "Work";
    if (item.kind === "release") return loc === "zh-CN" ? "发行" : "Release";
    if (item.kind === "agent") return loc === "zh-CN" ? "主体" : "Agent";
    return item.kind;
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/catalog/entities?status=published&limit=100", { credentials: "same-origin" })
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
    <div className="min-h-screen flex flex-col bg-background text-gray-100 relative selection:bg-primary selection:text-white">
      {/* Background ambient light */}
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />

      <Navbar />

      {/* Clean Utility Bar: Search (No slogans) */}
      <div className="border-b border-white/[0.06] bg-surface/60 backdrop-blur-xl sticky top-14 sm:top-15 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex justify-center">
          {/* Direct Search Input */}
          <form onSubmit={handleSearch} className="relative w-full max-w-3xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("home.searchPlaceholder")}
              className="w-full pl-12 pr-24 py-3.5 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/20 focus:border-primary focus:ring-1 focus:ring-primary text-white text-sm placeholder:text-gray-500 outline-none transition-all"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white font-medium text-sm transition-colors shadow-2xs cursor-pointer"
            >
              {t("home.search")}
            </button>
          </form>
        </div>
      </div>

      {/* Main Categorized Shelves Stream */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full flex-1 space-y-12 relative z-10">
        {DEFAULT_SHELVES.map((shelf) => {
          const items = matchShelfItems(shelf);
          const Icon = shelf.icon;
          const shelfTitle = t(`home.shelf.${shelf.slug}`);

          return (
            <section key={shelf.slug} id={"shelf-" + shelf.slug} className="space-y-4 scroll-mt-28">
              {/* Shelf Header */}
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <div className="flex items-center gap-3.5">
                  <div className={"w-10 h-10 rounded-xl border flex items-center justify-center " + shelf.color}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="font-bold text-white text-base sm:text-lg tracking-tight">
                        {shelfTitle}
                      </h2>
                      <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-gray-400 text-xs font-mono">
                        {t("home.shelfItemsCount", { count: items.length.toString() })}
                      </span>
                    </div>
                  </div>
                </div>

                <Link
                  href={"/explore?" + shelf.exploreParam}
                  className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline group"
                >
                  <span>{t("home.viewShelfAll")}</span>
                </Link>
              </div>

              {/* Shelf Grid or Empty State */}
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-xl bg-white/[0.02] border border-white/[0.04] animate-pulse"
                    />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-white/10 bg-white/[0.01] text-center space-y-3">
                  <p className="text-gray-400 text-xs sm:text-sm">
                    {t("home.emptyShelfPrefix", { shelf: shelfTitle })}
                  </p>
                  <Link
                    href="/new"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t("home.addFirst")}</span>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {items.slice(0, 12).map((item) => {
                    const displayTitle = getDisplayTitle(item, locale);
                    const badgeLabel = getCardBadge(item, definitions, locale, t);

                    return (
                      <Link
                        key={item.id}
                        href={"/catalog/" + item.id}
                        className="group flex flex-col rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/20 overflow-hidden transition-all shadow-2xs hover:shadow-md"
                      >
                        {/* Thumbnail frame - 卡片整体尺寸固定，图像区域自适应真实图片比例 */}
                        <AdaptiveCardCover
                          src={item.pictures && item.pictures[0]?.url}
                          alt={displayTitle}
                          aspectClassName={shelf.aspectClassName || "aspect-square"}
                          badge={
                            <span className="px-2 py-0.5 rounded-md bg-black/65 text-white keep-white backdrop-blur-md border border-white/20 text-[10px] font-medium shadow-2xs flex items-center gap-1.5 leading-none">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                              <span className="truncate max-w-[85px]">{badgeLabel}</span>
                            </span>
                          }
                          fallbackIcon={<Icon className="w-8 h-8 opacity-40 text-primary" />}
                          fallbackTitle={displayTitle}
                        />

                        {/* Content meta */}
                        <div className="p-3 flex-1 flex flex-col justify-between">
                          <div>
                            <h3 className="font-medium text-white group-hover:text-primary transition-colors text-xs sm:text-sm line-clamp-2 leading-snug mb-1">
                              {displayTitle}
                            </h3>
                            {item.title !== displayTitle && (
                              <p className="text-[10px] text-gray-400 font-mono line-clamp-1 mb-1">
                                {item.title}
                              </p>
                            )}
                          </div>

                          <div className="pt-2 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-gray-400 font-mono">
                            <span>rev {item.version || 1}</span>
                            <span className="text-gray-400 group-hover:text-primary transition-colors flex items-center gap-0.5">
                              {t("home.details")} <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </main>

      {/* Docked Minimal Footer */}
      <footer className="border-t border-white/[0.06] py-6 bg-surface/30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-gray-400">
          <div>
            <span>© 2026 MetaFusion · Open Metadata & Resource Sharing Platform</span>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <Link href="/landing" className="hover:text-white transition-colors">
              {t("home.footerAbout")}
            </Link>
            <Link href="/explore" className="hover:text-white transition-colors">
              {t("home.footerExplore")}
            </Link>
            <Link href="/community" className="hover:text-white transition-colors">
              {t("home.footerCommunity")}
            </Link>
            <Link href="/downloads" className="hover:text-white transition-colors">
              {t("home.footerDownloads")}
            </Link>
            <a href="/docs/catalog" className="hover:text-white transition-colors">
              {t("home.footerDocs")}
            </a>
            <a href="/developers" className="hover:text-white transition-colors">
              {t("home.footerApi")}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
