"use client";

import React, { useEffect, useState, Suspense, useCallback } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { fetchApi, pickLocalizedName } from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { FORUM_SERVICE_URL } from "@/lib/services";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { isDistinctOriginalTitle } from "@/lib/titles";
import {
  Plus,
  Layers,
  Sparkles,
  Film,
  Tv,
  Music,
  BookOpen,
  Image as ImageIcon,
  ChevronRight,
  MessageCircle,
  Settings2,
  Info,
  AlertCircle,
} from "lucide-react";

const SHELF_ICONS: Record<string, React.ElementType> = {
  video: Film,
  movies: Film,
  "anime-movies": Film,
  "feature-films": Film,
  series: Tv,
  "anime-series": Tv,
  "anime-hub": Film,
  music: Music,
  soundtracks: Music,
  classical: Music,
  audiobooks: Music,
  book: BookOpen,
  books: BookOpen,
  comic: ImageIcon,
  comics: ImageIcon,
  special: Sparkles,
};

const SHELF_COLORS: Record<string, string> = {
  music: "bg-amber-500/10 border-amber-500/20 text-amber-500",
  soundtracks: "bg-amber-500/10 border-amber-500/20 text-amber-500",
  classical: "bg-amber-500/10 border-amber-500/20 text-amber-500",
  video: "bg-sky-500/10 border-sky-500/20 text-sky-500",
  movies: "bg-sky-500/10 border-sky-500/20 text-sky-500",
  "anime-movies": "bg-sky-500/10 border-sky-500/20 text-sky-500",
  series: "bg-sky-500/10 border-sky-500/20 text-sky-500",
  "anime-series": "bg-sky-500/10 border-sky-500/20 text-sky-500",
  "anime-hub": "bg-sky-500/10 border-sky-500/20 text-sky-500",
  special: "bg-purple-500/10 border-purple-500/20 text-purple-500",
  book: "bg-rose-500/10 border-rose-500/20 text-rose-500",
  books: "bg-rose-500/10 border-rose-500/20 text-rose-500",
  comic: "bg-rose-500/10 border-rose-500/20 text-rose-500",
  comics: "bg-rose-500/10 border-rose-500/20 text-rose-500",
  audiobooks: "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
};

// /api/catalog/shelves 返回的是货架规则（query.types / fields / vocab_terms / relations），
// 不是旧版 VirtualShelf（query_tags）。这里按真实契约建模，不再伪造 query_tags。
type ShelfQuery = {
  types?: string[] | null;
  fields?: Record<string, string[]> | null;
  vocab_terms?: Record<string, string[]> | null;
  relations?: string[] | null;
};

type PublicShelf = {
  id?: number | string;
  slug: string;
  names?: Record<string, string> | null;
  name_zh?: string;
  name_en?: string;
  name?: string;
  icon?: string;
  sort_order?: number;
  query?: ShelfQuery | null;
};

// /api/catalog/works 返回新轨实体：有 types/pictures，旧字段可能缺失，读取时做兼容。
type HomeWork = {
  id: string;
  title: string;
  original_title?: string;
  original_language?: string;
  cover_image_url?: string;
  cover_aspect?: string;
  release_date?: string;
  updated_at?: string;
  types?: string[] | null;
  pictures?: { url?: string }[] | null;
  tags?: { id?: string | number; name?: string }[] | null;
};

function getShelfColor(key: string): string {
  if (SHELF_COLORS[key]) return SHELF_COLORS[key];
  return "bg-primary/10 border-primary/20 text-primary";
}

function coverOf(work: HomeWork): string | undefined {
  return work.cover_image_url || work.pictures?.[0]?.url || undefined;
}

function dateOf(work: HomeWork): string | undefined {
  return work.release_date || work.updated_at;
}

// 只有「无其它条件」或「纯类型条件」的货架能在客户端用已发布作品列表求值。
// 含 fields / vocab_terms / relations 的规则由后端裁剪，这里不臆断结果，改展示占位说明。
function shelfIsEvaluatable(shelf: PublicShelf): boolean {
  const q = shelf.query || {};
  const hasFields = Object.values(q.fields || {}).some((v) => (v || []).length > 0);
  const hasVocab = Object.values(q.vocab_terms || {}).some((v) => (v || []).length > 0);
  const hasRelations = (q.relations || []).filter(Boolean).length > 0;
  return !hasFields && !hasVocab && !hasRelations;
}

function workMatchesShelf(work: HomeWork, shelf: PublicShelf): boolean {
  const types = (shelf.query?.types || []).filter(Boolean);
  if (types.length === 0) return true;
  const workTypes = work.types || [];
  // 数据缺少类型信息时不臆断过滤，保留展示。
  if (workTypes.length === 0) return true;
  return types.some((code) => workTypes.includes(code));
}

function HomeShowcaseContent() {
  const { t, locale } = useI18n();
  const { user, loading: authLoading } = useAuth();

  const [shelves, setShelves] = useState<PublicShelf[]>([]);
  const [works, setWorks] = useState<HomeWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [shelvesRes, worksRes] = await Promise.all([
        fetchApi<{ items: PublicShelf[] }>("/catalog/shelves"),
        fetchApi<{ items: HomeWork[] }>("/catalog/works?page_size=100"),
      ]);
      setShelves((shelvesRes?.items || []).filter((s) => s && s.slug));
      setWorks(worksRes?.items || []);
    } catch (err) {
      console.error("Failed to load home showcase data", err);
      setShelves([]);
      setWorks([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    loadAll();
  }, [authLoading, loadAll]);

  const showPageSkeleton = authLoading || loading;

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <Navbar />

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full flex-1 space-y-5">
        {/* 自定义布局 / 自定义货架依赖未实现的后端接口，降级为显式占位说明。 */}
        {user && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="inline-flex items-center gap-2 px-3.5 h-9 rounded-md border border-dashed border-black/10 dark:border-white/10 bg-surface/50 text-gray-500 text-sm">
              <Settings2 className="w-4 h-4" />
              <span>{t("home.shelves.editMyList")}</span>
              <span className="font-mono text-xs text-amber-500">{t("catalog.unavailable")}</span>
            </div>
          </div>
        )}

        {loadError && (
          <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300 text-xs font-mono flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{t("catalog.connectionError")}</span>
          </div>
        )}

        {showPageSkeleton ? (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-5 w-40 bg-black/5 dark:bg-white/5 rounded-md animate-pulse" />
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {[1, 2, 3, 4, 5].map((j) => (
                    <div key={j} className="aspect-[3/4] rounded-lg bg-black/5 dark:bg-white/5 animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : shelves.length === 0 ? (
          <div className="p-8 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 text-center space-y-2.5">
            <p className="font-mono text-sm text-gray-500">{t("shelf.empty")}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {shelves.map((shelf) => {
              const evaluatable = shelfIsEvaluatable(shelf);
              const shelfWorks = evaluatable ? works.filter((w) => workMatchesShelf(w, shelf)) : [];
              const Icon = SHELF_ICONS[shelf.slug] || Layers;
              const shelfTitle = pickLocalizedName(
                locale,
                shelf.names,
                shelf.name_zh,
                shelf.name_en || shelf.name,
                shelf.slug
              );

              return (
                <section key={shelf.slug} id={`shelf-${shelf.slug}`} className="space-y-3 scroll-mt-16">
                  <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.06] pb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-sm grid place-items-center border ${getShelfColor(shelf.slug)}`}>
                        <Icon className="w-4 h-4" strokeWidth={1.8} />
                      </div>
                      <div>
                        <h2 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">
                          {shelfTitle}
                        </h2>
                        <p className="font-mono text-sm text-gray-500">
                          {evaluatable
                            ? t("home.channelWorksCount", { count: shelfWorks.length })
                            : t("catalog.unavailable")}
                        </p>
                      </div>
                    </div>

                    <Link
                      href="/explore"
                      className="inline-flex items-center gap-0.5 font-mono text-sm text-primary hover:underline font-medium"
                    >
                      <span>{t("home.viewAll")}</span>
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>

                  {!evaluatable ? (
                    <div className="p-6 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-1.5">
                      <p className="font-mono text-sm text-gray-500 inline-flex items-center justify-center gap-2">
                        <Info className="w-4 h-4" />
                        <span>{t("catalog.unavailable")}</span>
                      </p>
                    </div>
                  ) : shelfWorks.length === 0 ? (
                    <div className="p-6 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-1.5">
                      <p className="font-mono text-sm text-gray-500">{t("home.channelEmpty")}</p>
                      <Link
                        href="/works/new"
                        className="inline-flex items-center gap-2 font-mono text-sm text-primary hover:underline"
                      >
                        <Plus className="w-4 h-4" /> {t("home.addWork")}
                      </Link>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {shelfWorks.slice(0, 5).map((w) => (
                        <Link
                          key={w.id}
                          href={`/works/${w.id}`}
                          className="group relative rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-sm overflow-hidden shadow-2xs hover:shadow-elevated hover:border-primary/50 transition-all flex flex-col"
                        >
                          <AdaptiveCover
                            src={coverOf(w)}
                            alt={w.title}
                            title={w.title}
                            originalTitle={w.original_title}
                            id={w.id}
                            tags={(w.tags || []).map((tag) => (tag?.name ? tag.name : ""))}
                            aspect={w.cover_aspect}
                            className="bg-black/5 dark:bg-black/40 group-hover:scale-105 transition-transform duration-300 origin-center"
                          />
                          <div className="p-4 space-y-1 flex-1 flex flex-col justify-between">
                            <div>
                              <h3 className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-1 group-hover:text-primary transition-colors">
                                {w.title}
                              </h3>
                              {isDistinctOriginalTitle(w.original_title, w.title) && (
                                <p className="font-mono text-xs text-gray-500 line-clamp-1">{w.original_title}</p>
                              )}
                            </div>
                            {w.tags && w.tags.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-0.5">
                                {w.tags.slice(0, 2).map((tag, i) => (
                                  <span
                                    key={tag.id ?? `${w.id}-${i}`}
                                    className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] text-xs font-mono text-gray-500"
                                  >
                                    #{tag.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="pt-1.5 flex items-center justify-between font-mono text-xs text-gray-500 border-t border-black/[0.04] dark:border-white/[0.04]">
                              <span className="truncate">
                                {dateOf(w) ? String(dateOf(w)).slice(0, 10) : t("home.workFallback")}
                              </span>
                              <span className="flex items-center gap-0.5 group-hover:text-primary transition-colors">
                                {t("home.detail")} <ChevronRight className="w-4 h-4" />
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
        )}

        {/* 社区入口跳转到独立论坛服务，不再请求本后端的社区讨论域接口。 */}
        <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
          <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-2">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
              <MessageCircle className="w-4 h-4" />
              <span>{t("home.communityTitle")}</span>
            </div>
            <Link
              href={FORUM_SERVICE_URL}
              className="font-mono text-sm text-primary hover:underline flex items-center gap-2 font-medium"
            >
              <span>{t("home.enterForum")}</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="font-mono text-xs text-gray-500 leading-relaxed">
            {t("entity.detail.decoupledForumNotice")}
          </p>
        </section>
      </main>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center font-mono text-sm text-gray-500">Loading…</div>}>
      <HomeShowcaseContent />
    </Suspense>
  );
}
