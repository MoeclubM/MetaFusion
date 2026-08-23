"use client";

import React, { useEffect, useState, Suspense, useCallback } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import {
  fetchApi,
  Work,
  VirtualShelf,
  UserCustomShelf,
  UserHomeLayout,
  resetDefaultShelves,
  ensureDefaultShelves,
} from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { HomeShelvesConfigModal } from "@/components/home/HomeShelvesConfigModal";
import { EntityCover } from "@/components/common/EntityCover";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { isDistinctOriginalTitle } from "@/lib/titles";
import { shelfRuleToExploreHref } from "@/lib/shelfQuery";
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

type ChannelShelf = {
  key: string;
  slug: string;
  name_zh: string;
  name_en?: string;
  query_tags?: string[] | null;
  require_all_tags?: boolean;
  exclude_tags?: string[] | null;
};

function getShelfColor(key: string): string {
  if (SHELF_COLORS[key]) return SHELF_COLORS[key];
  return "bg-primary/10 border-primary/20 text-primary";
}

function matchesShelfCriteria(
  work: Work,
  queryTags: string[],
  requireAll: boolean,
  excludeTags: string[]
): boolean {
  const wTags = (work.tags || []).map((t: any) => (t?.name ? t.name : typeof t === "string" ? t : ""));
  if (excludeTags && excludeTags.some((ex) => wTags.includes(ex))) return false;
  if (!queryTags || queryTags.length === 0) return true;
  return requireAll ? queryTags.every((qt) => wTags.includes(qt)) : queryTags.some((qt) => wTags.includes(qt));
}

function flattenSystemShelves(nodes: VirtualShelf[]): VirtualShelf[] {
  const out: VirtualShelf[] = [];
  const walk = (list: VirtualShelf[]) => {
    list.forEach((s) => {
      out.push(s);
      if (s.children && s.children.length > 0) walk(s.children);
    });
  };
  walk(nodes);
  return out;
}

function groupWorksForChannels(channels: ChannelShelf[], allWorks: Work[]): Record<string, Work[]> {
  const grouped: Record<string, Work[]> = {};
  channels.forEach((ch) => {
    grouped[ch.key] = allWorks.filter((w) =>
      matchesShelfCriteria(w, ch.query_tags || [], !!ch.require_all_tags, ch.exclude_tags || [])
    );
  });
  return grouped;
}

function customKey(id: string): string {
  return `custom:${id}`;
}

function HomeShowcaseContent() {
  const { t, locale } = useI18n();
  const { user, loading: authLoading } = useAuth();

  const [guestShelves, setGuestShelves] = useState<VirtualShelf[]>([]);
  const [customShelves, setCustomShelves] = useState<UserCustomShelf[]>([]);
  const [orderKeys, setOrderKeys] = useState<string[]>([]);
  const [worksByKey, setWorksByKey] = useState<Record<string, Work[]>>({});
  const [topics, setTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const storageKey = user ? `mf_home_layout:${user.id}` : "mf_home_layout:guest";

  const persistOrder = (order: string[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ hidden: [], order }));
    } catch {}
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setCopyFailed(false);
    try {
      const worksPromise = fetchApi<{ items: Work[] }>("/catalog/works?page_size=100").catch(() => ({ items: [] }));
      const topicsPromise = fetchApi<{ items: any[] }>("/community/topics?page_size=4").catch(() => ({ items: [] }));

      let channels: ChannelShelf[] = [];
      let nextOrder: string[] = [];
      let nextCustom: UserCustomShelf[] = [];
      let nextGuest: VirtualShelf[] = [];
      let failedCopy = false;

      if (user) {
        try {
          const ensured = await ensureDefaultShelves();
          nextCustom = ensured.items || [];
          nextOrder =
            ensured.order && ensured.order.length > 0
              ? ensured.order
              : nextCustom.map((c) => customKey(c.id));
        } catch (e) {
          console.error("ensure default shelves failed", e);
          failedCopy = true;
          nextCustom = [];
          nextOrder = [];
        }
        channels = nextCustom.map((c) => ({
          key: customKey(c.id),
          slug: c.slug,
          name_zh: c.name_zh,
          name_en: c.name_en,
          query_tags: c.query_tags,
          require_all_tags: c.require_all_tags,
          exclude_tags: c.exclude_tags,
        }));
      } else {
        const shelvesRes = await fetchApi<VirtualShelf[]>("/catalog/shelves").catch(() => []);
        nextGuest = flattenSystemShelves(Array.isArray(shelvesRes) ? shelvesRes : []);
        nextOrder = nextGuest.map((s) => s.slug);
        channels = nextGuest.map((s) => ({
          key: s.slug,
          slug: s.slug,
          name_zh: s.name_zh,
          name_en: s.name_en,
          query_tags: s.query_tags,
          require_all_tags: s.require_all_tags,
          exclude_tags: s.exclude_tags,
        }));
      }

      const [worksRes, topicsRes] = await Promise.all([worksPromise, topicsPromise]);
      setTopics(topicsRes?.items || []);
      setCustomShelves(nextCustom);
      setGuestShelves(nextGuest);
      setOrderKeys(nextOrder);
      setCopyFailed(failedCopy);
      persistOrder(nextOrder);
      setWorksByKey(groupWorksForChannels(channels, worksRes?.items || []));
    } catch (err) {
      console.error("Failed to load home showcase data", err);
    } finally {
      setLoading(false);
    }
    // persistOrder uses storageKey; include it via user id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, storageKey]);

  useEffect(() => {
    if (authLoading) return;
    loadAll();
  }, [authLoading, loadAll]);

  const handleSaveLayout = async (_hidden: string[], order: string[]) => {
    setOrderKeys(order);
    persistOrder(order);
    if (user) {
      try {
        await fetchApi<UserHomeLayout>("/catalog/home/layout", {
          method: "PUT",
          body: JSON.stringify({ hidden_system_slugs: [], order_json: order }),
        });
      } catch (e) {
        console.warn("save layout failed", e);
      }
    }
  };

  const refreshCustom = async () => {
    try {
      const res = await fetchApi<{ items: UserCustomShelf[] }>("/catalog/shelves/custom?scope=own");
      const items = res.items || [];
      setCustomShelves(items);
      const worksRes = await fetchApi<{ items: Work[] }>("/catalog/works?page_size=100").catch(() => ({ items: [] }));
      const channels: ChannelShelf[] = items.map((c) => ({
        key: customKey(c.id),
        slug: c.slug,
        name_zh: c.name_zh,
        name_en: c.name_en,
        query_tags: c.query_tags,
        require_all_tags: c.require_all_tags,
        exclude_tags: c.exclude_tags,
      }));
      setWorksByKey(groupWorksForChannels(channels, worksRes.items || []));
      const known = new Set(orderKeys);
      const nextOrder = [
        ...orderKeys.filter((k) => items.some((c) => customKey(c.id) === k)),
        ...items.map((c) => customKey(c.id)).filter((k) => !known.has(k)),
      ];
      setOrderKeys(nextOrder);
      persistOrder(nextOrder);
      if (user) {
        fetchApi("/catalog/home/layout", {
          method: "PUT",
          body: JSON.stringify({ hidden_system_slugs: [], order_json: nextOrder }),
        }).catch(() => {});
      }
    } catch {}
  };

  const handleCreateCustom = async (payload: Partial<UserCustomShelf> & { slug: string; name_zh: string }) => {
    await fetchApi<UserCustomShelf>("/catalog/shelves/custom", { method: "POST", body: JSON.stringify(payload) });
  };

  const handleUpdateCustom = async (id: string, payload: Partial<UserCustomShelf>) => {
    await fetchApi(`/catalog/shelves/custom/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  };

  const handleDeleteCustom = async (id: string) => {
    await fetchApi(`/catalog/shelves/custom/${id}`, { method: "DELETE" });
    const key = customKey(id);
    const nextOrder = orderKeys.filter((k) => k !== key);
    setOrderKeys(nextOrder);
    persistOrder(nextOrder);
  };

  const handleResetDefaults = async () => {
    try {
      const res = await resetDefaultShelves();
      const items = res?.items || [];
      const nextOrder = res?.order && res.order.length > 0 ? res.order : items.map((c) => customKey(c.id));
      setCustomShelves(items);
      setOrderKeys(nextOrder);
      setCopyFailed(false);
      persistOrder(nextOrder);
      const worksRes = await fetchApi<{ items: Work[] }>("/catalog/works?page_size=100").catch(() => ({ items: [] }));
      const channels: ChannelShelf[] = items.map((c) => ({
        key: customKey(c.id),
        slug: c.slug,
        name_zh: c.name_zh,
        name_en: c.name_en,
        query_tags: c.query_tags,
        require_all_tags: c.require_all_tags,
        exclude_tags: c.exclude_tags,
      }));
      setWorksByKey(groupWorksForChannels(channels, worksRes.items || []));
    } catch (e) {
      console.error("handleResetDefaults failed", e);
      setCopyFailed(true);
    }
  };

  const customMap = new Map<string, UserCustomShelf>(customShelves.map((c) => [customKey(c.id), c]));
  const guestMap = new Map<string, VirtualShelf>(guestShelves.map((s) => [s.slug, s]));

  const displayChannels: ChannelShelf[] = (() => {
    const seen = new Set<string>();
    const out: ChannelShelf[] = [];
    const pushCustom = (c: UserCustomShelf) => {
      const key = customKey(c.id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
        slug: c.slug,
        name_zh: c.name_zh,
        name_en: c.name_en,
        query_tags: c.query_tags,
        require_all_tags: c.require_all_tags,
        exclude_tags: c.exclude_tags,
      });
    };
    const pushGuest = (s: VirtualShelf) => {
      if (seen.has(s.slug)) return;
      seen.add(s.slug);
      out.push({
        key: s.slug,
        slug: s.slug,
        name_zh: s.name_zh,
        name_en: s.name_en,
        query_tags: s.query_tags,
        require_all_tags: s.require_all_tags,
        exclude_tags: s.exclude_tags,
      });
    };

    if (user) {
      orderKeys.forEach((k) => {
        const c = customMap.get(k);
        if (c) pushCustom(c);
      });
      customShelves.forEach(pushCustom);
    } else {
      const base = orderKeys.length > 0 ? orderKeys : guestShelves.map((s) => s.slug);
      base.forEach((k) => {
        const s = guestMap.get(k);
        if (s) pushGuest(s);
      });
      guestShelves.forEach(pushGuest);
    }
    return out;
  })();

  const showPageSkeleton = authLoading || loading;

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <Navbar />

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full flex-1 space-y-5">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!user && !authLoading && (
            <p className="font-mono text-[11px] text-gray-500 mr-auto">{t("home.shelves.guestPreviewHint")}</p>
          )}
          {user ? (
            <button
              type="button"
              onClick={() => setConfigOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 h-9 max-sm:min-h-[44px] rounded-md border border-dashed border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-sm font-medium whitespace-nowrap"
            >
              <Settings2 className="w-4 h-4" />
              <span>{t("home.shelves.editMyList")}</span>
            </button>
          ) : (
            !authLoading && (
              <Link
                href="/login?redirect=/home"
                className="inline-flex items-center gap-2 px-3.5 h-9 max-sm:min-h-[44px] rounded-md border border-dashed border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-sm font-medium whitespace-nowrap"
              >
                <Settings2 className="w-4 h-4" />
                <span>{t("home.shelves.loginToEdit")}</span>
              </Link>
            )
          )}
        </div>

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
        ) : displayChannels.length === 0 ? (
          <div className="p-8 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 text-center space-y-2.5">
            <p className="font-mono text-sm text-gray-500">{t("shelf.empty")}</p>
            {user && copyFailed && (
              <p className="font-mono text-sm text-gray-400">{t("home.shelves.copyFailed")}</p>
            )}
            {!user && <p className="font-mono text-sm text-gray-400">{t("home.shelves.guestPreviewHint")}</p>}
            {user ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfigOpen(true)}
                  className="inline-flex items-center gap-2 px-3.5 h-9 max-sm:min-h-[44px] rounded-md bg-primary text-white text-sm font-semibold"
                >
                  <Settings2 className="w-4 h-4" /> {t("home.shelves.editMyList")}
                </button>
              </div>
            ) : (
              <Link
                href="/login?redirect=/home"
                className="inline-flex items-center gap-2 px-3.5 h-9 max-sm:min-h-[44px] rounded-md bg-primary text-white text-sm font-semibold"
              >
                <Settings2 className="w-4 h-4" /> {t("home.shelves.loginToEdit")}
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {displayChannels.map((ch) => {
              const shelfWorks = worksByKey[ch.key] || [];
              const Icon = SHELF_ICONS[ch.slug] || Layers;
              const shelfTitle = locale === "en-US" && ch.name_en ? ch.name_en : ch.name_zh || "";
              const viewAllHref = shelfRuleToExploreHref(ch);

              return (
                <section key={ch.key} id={`shelf-${ch.key}`} className="space-y-3 scroll-mt-16">
                  <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.06] pb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-sm grid place-items-center border ${getShelfColor(ch.slug)}`}>
                        <Icon className="w-4 h-4" strokeWidth={1.8} />
                      </div>
                      <div>
                        <h2 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">
                          {shelfTitle}
                        </h2>
                        <p className="font-mono text-sm text-gray-500">
                          {t("home.channelWorksCount", { count: shelfWorks.length })}
                          {ch.query_tags?.length ? ` · ${ch.query_tags.join(", ")}` : ""}
                        </p>
                      </div>
                    </div>

                    <Link
                      href={viewAllHref}
                      className="inline-flex items-center gap-0.5 font-mono text-sm text-primary hover:underline font-medium"
                    >
                      <span>{t("home.viewAll")}</span>
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>

                  {shelfWorks.length === 0 ? (
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
                            src={w.cover_image_url}
                            alt={w.title}
                            title={w.title}
                            originalTitle={w.original_title}
                            id={w.id}
                        tags={(w.tags || []).map((t) => (t?.name ? t.name : typeof t === "string" ? t : ""))}
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
                                {w.tags.slice(0, 2).map((tag) => (
                                  <span
                                    key={tag.id}
                                    className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] text-xs font-mono text-gray-500"
                                  >
                                    #{tag.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="pt-1.5 flex items-center justify-between font-mono text-xs text-gray-500 border-t border-black/[0.04] dark:border-white/[0.04]">
                              <span className="truncate">{w.release_date ? String(w.release_date).slice(0, 10) : t("home.workFallback")}</span>
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

        {topics.length > 0 && (
          <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
            <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-2">
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
                <MessageCircle className="w-4 h-4" />
                <span>COMMUNITY FORUM</span>
              </div>
              <Link href="/community" className="font-mono text-sm text-primary hover:underline flex items-center gap-2 font-medium">
                <span>{t("home.enterForum")}</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <h2 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("home.communityTitle")}</h2>
              <span className="font-mono text-sm text-gray-500">— {t("home.boardFallback")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
              {topics.map((tp) => (
                <Link
                  key={tp.id}
                  href={`/community/${tp.id}`}
                  className="p-4 rounded-md bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06] hover:border-primary/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-all space-y-1 block group"
                >
                  <h4 className="font-semibold text-sm text-gray-900 dark:text-white line-clamp-1 group-hover:text-primary transition-colors">
                    {tp.title}
                  </h4>
                  <div className="flex items-center justify-between font-mono text-sm text-gray-500">
                    <span>{tp.board_code || t("home.boardFallback")}</span>
                    <span>{String(tp.created_at || "").slice(0, 10)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      {user && (
        <HomeShelvesConfigModal
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          customShelves={customShelves}
          orderKeys={orderKeys}
          onSaveLayout={handleSaveLayout}
          onCreateCustom={handleCreateCustom}
          onUpdateCustom={handleUpdateCustom}
          onDeleteCustom={handleDeleteCustom}
          onRefreshCustom={refreshCustom}
          onResetDefaults={handleResetDefaults}
        />
      )}
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
