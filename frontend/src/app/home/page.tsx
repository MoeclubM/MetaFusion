"use client";

import React, { useEffect, useState, Suspense, useCallback } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { fetchApi, Work, VirtualShelf, UserCustomShelf, UserHomeLayout } from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { HomeShelvesConfigModal } from "@/components/home/HomeShelvesConfigModal";
import {
  Compass,
  ArrowRight,
  Disc3,
  Plus,
  Layers,
  Sparkles,
  Film,
  Tv,
  Music,
  BookOpen,
  Image as ImageIcon,
  Gamepad2,
  ChevronRight,
  MessageCircle,
  Settings2,
  Database,
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

function getShelfColor(key: string, mediaType?: string): string {
  if (SHELF_COLORS[key]) return SHELF_COLORS[key];
  if (mediaType && SHELF_COLORS[mediaType]) return SHELF_COLORS[mediaType];
  return "bg-primary/10 border-primary/20 text-primary";
}

function matchesShelfTags(work: Work, queryTags: string[], requireAll: boolean, excludeTags: string[]): boolean {
  const wTags = (work.tags || []).map((t) => t.name);
  if (excludeTags && excludeTags.some((ex) => wTags.includes(ex))) return false;
  if (!queryTags || queryTags.length === 0) return true;
  if (requireAll) return queryTags.every((qt) => wTags.includes(qt));
  return queryTags.some((qt) => wTags.includes(qt));
}

function matchesMediaType(work: Work, mediaType: string): boolean {
  if (!mediaType || mediaType === "all") return true;
  const mt = work.media_type || "";
  switch (mediaType) {
    case "video":
      return ["movie", "tv_series", "anime"].includes(mt);
    case "audio":
      return ["music", "audiobook"].includes(mt);
    case "text":
      return mt === "novel";
    case "graphic":
      return ["comic", "gallery"].includes(mt);
    default:
      return mt === mediaType;
  }
}

function HomeShowcaseContent() {
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [shelves, setShelves] = useState<VirtualShelf[]>([]);
  const [customShelves, setCustomShelves] = useState<UserCustomShelf[]>([]);
  const [hiddenSlugs, setHiddenSlugs] = useState<string[]>([]);
  const [orderKeys, setOrderKeys] = useState<string[]>([]);
  const [worksByKey, setWorksByKey] = useState<Record<string, Work[]>>({});
  const [topics, setTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [publicCache, setPublicCache] = useState<Map<string, UserCustomShelf>>(new Map<string, UserCustomShelf>());

  const storageKey = user ? `mf_home_layout:${user.id}` : "mf_home_layout:guest";

  const loadAll = useCallback(async () => {
    try {
      const promises: Promise<any>[] = [
        fetchApi<VirtualShelf[]>("/catalog/shelves").catch(() => []),
        fetchApi<{ items: Work[] }>("/catalog/works?page_size=100").catch(() => ({ items: [] })),
        fetchApi<{ items: any[] }>("/community/topics?page_size=4").catch(() => ({ items: [] })),
      ];
      // custom shelves (own) — requires auth; ignore error if not logged in
      promises.push(fetchApi<{ items: UserCustomShelf[] }>("/catalog/shelves/custom?scope=own").catch(() => ({ items: [] })));
      // layout — requires auth
      promises.push(fetchApi<UserHomeLayout>("/catalog/home/layout").catch(() => null));

      const [shelvesRes, worksRes, topicsRes, customRes, layoutRes] = await Promise.all(promises);

      const allShelves: VirtualShelf[] = Array.isArray(shelvesRes) ? shelvesRes : [];
      setShelves(allShelves);
      setTopics(topicsRes?.items || []);
      const ownCustoms: UserCustomShelf[] = customRes?.items || [];
      setCustomShelves(ownCustoms);

      // layout: prefer server, fallback localStorage
      let hidden: string[] = [];
      let order: string[] = [];
      if (layoutRes && Array.isArray(layoutRes.hidden_system_slugs)) {
        hidden = layoutRes.hidden_system_slugs;
        order = layoutRes.order_json || [];
        try { localStorage.setItem(storageKey, JSON.stringify({ hidden, order })); } catch {}
      } else {
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            hidden = parsed.hidden || [];
            order = parsed.order || [];
          }
        } catch {}
      }
      // sanitize: filter hidden that still exists, order deduplicate later in modal
      setHiddenSlugs(hidden);
      if (order && order.length > 0) {
        setOrderKeys(order);
        // preload any custom:<id> not in ownCustoms (public joined)
        const missingIds = order.filter((k) => k.startsWith("custom:") && !ownCustoms.some((c) => `custom:${c.id}` === k));
        if (missingIds.length > 0) {
          const fetches = missingIds.map((k) => {
            const id = k.slice(7);
            return fetchApi<UserCustomShelf>(`/catalog/shelves/custom/${id}`).catch(() => null);
          });
          const results = await Promise.all(fetches);
          const nextCache = new Map<string, UserCustomShelf>();
          results.forEach((r) => {
            if (r && r.id) nextCache.set(`custom:${r.id}`, r);
          });
          if (nextCache.size > 0) setPublicCache(nextCache);
          // merge into order resolution — keep as is, publicCache will satisfy rendering
        }
      } else {
        // default order: system slugs + own customs
        const defOrder = [...allShelves.map((s) => s.slug), ...ownCustoms.map((c) => `custom:${c.id}`)];
        setOrderKeys(defOrder);
      }

      const allWorks: Work[] = worksRes?.items || [];
      // build map for all keys (system + custom) for quick pill counts; actual ordered rendering will recompute
      const grouped: Record<string, Work[]> = {};
      allShelves.forEach((shelf) => {
        grouped[shelf.slug] = allWorks.filter((w) => matchesMediaType(w, shelf.media_type) && matchesShelfTags(w, shelf.query_tags || [], !!shelf.require_all_tags, shelf.exclude_tags || []));
      });
      ownCustoms.forEach((cs) => {
        const key = `custom:${cs.id}`;
        grouped[key] = allWorks.filter((w) => matchesMediaType(w, cs.media_type) && matchesShelfTags(w, cs.query_tags || [], !!cs.require_all_tags, cs.exclude_tags || []));
      });
      // also for any public cached (if order had them, they were fetched above — but we already have grouped for them via second pass)
      // if we fetched publicCache, add them too
      setWorksByKey(grouped);
    } catch (err) {
      console.error("Failed to load home showcase data", err);
    } finally {
      setLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadAll();
    })();
    return () => { cancelled = true; };
  }, [loadAll]);

  // recompute worksByKey when customShelves/publicCache change and we already have works? For simplicity, recompute on loadAll only.
  // To avoid stale counts after layout changes, we keep worksByKey as initially computed; counts remain correct.

  const handleSaveLayout = async (hidden: string[], order: string[]) => {
    setHiddenSlugs(hidden);
    setOrderKeys(order);
    try { localStorage.setItem(storageKey, JSON.stringify({ hidden, order })); } catch {}
    if (user) {
      try {
        await fetchApi<UserHomeLayout>("/catalog/home/layout", {
          method: "PUT",
          body: JSON.stringify({ hidden_system_slugs: hidden, order_json: order }),
        });
      } catch (e) {
        console.warn("save layout failed", e);
      }
    }
    // refresh to ensure new order takes effect with filtering
    // we keep current worksByKey; no need to refetch unless shelves changed
  };

  const refreshCustom = async () => {
    try {
      const res = await fetchApi<{ items: UserCustomShelf[] }>("/catalog/shelves/custom?scope=own");
      setCustomShelves(res.items || []);
      // also refresh worksByKey for new customs
      const worksRes = await fetchApi<{ items: Work[] }>("/catalog/works?page_size=100").catch(() => ({ items: [] }));
      const allWorks = worksRes.items || [];
      const grouped: Record<string, Work[]> = { ...worksByKey };
      (res.items || []).forEach((cs) => {
        const key = `custom:${cs.id}`;
        grouped[key] = allWorks.filter((w) => matchesMediaType(w, cs.media_type) && matchesShelfTags(w, cs.query_tags || [], !!cs.require_all_tags, cs.exclude_tags || []));
      });
      setWorksByKey(grouped);
      // if orderKeys doesn't contain new custom, append
      const newIds = (res.items || []).map((c) => `custom:${c.id}`).filter((k) => !orderKeys.includes(k));
      if (newIds.length > 0) {
        const nextOrder = [...orderKeys, ...newIds];
        setOrderKeys(nextOrder);
        try { localStorage.setItem(storageKey, JSON.stringify({ hidden: hiddenSlugs, order: nextOrder })); } catch {}
        if (user) {
          fetchApi("/catalog/home/layout", { method: "PUT", body: JSON.stringify({ hidden_system_slugs: hiddenSlugs, order_json: nextOrder }) }).catch(() => {});
        }
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
    const key = `custom:${id}`;
    const nextOrder = orderKeys.filter((k) => k !== key);
    setOrderKeys(nextOrder);
    try { localStorage.setItem(storageKey, JSON.stringify({ hidden: hiddenSlugs, order: nextOrder })); } catch {}
  };

  // build ordered display list — public for guests
  const allKeysOrdered = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const base = orderKeys.length > 0 ? orderKeys : [...shelves.map((s) => s.slug), ...customShelves.map((c) => `custom:${c.id}`)];
    base.forEach((k) => {
      if (!k || seen.has(k)) return;
      seen.add(k);
      // skip hidden system
      if (!k.startsWith("custom:") && hiddenSlugs.includes(k)) return;
      out.push(k);
    });
    // append any missing system/custom not in order (new shelves)
    shelves.forEach((s) => {
      if (!seen.has(s.slug) && !hiddenSlugs.includes(s.slug)) {
        out.push(s.slug);
        seen.add(s.slug);
      }
    });
    customShelves.forEach((c) => {
      const k = `custom:${c.id}`;
      if (!seen.has(k)) {
        out.push(k);
        seen.add(k);
      }
    });
    // also include publicCache keys that are in order but not in customShelves
    publicCache.forEach((_, k) => {
      if (!seen.has(k) && orderKeys.includes(k)) {
        out.push(k);
        seen.add(k);
      }
    });
    return out;
  })();

  const systemMap = new Map<string, VirtualShelf>(shelves.map((s) => [s.slug, s]));
  const customMap = new Map<string, UserCustomShelf>(customShelves.map((c) => [`custom:${c.id}`, c]));
  // merge publicCache into customMap for rendering
  publicCache.forEach((v, k) => { if (!customMap.has(k)) customMap.set(k, v); });

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <Navbar />

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full flex-1 space-y-5">
        {/* Terminal Header */}
        <div className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-black/5 dark:border-white/[0.06] pb-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-primary">
                <Database className="w-3.5 h-3.5" />
                <span>HOME SHELVES · FRBR ARCHIVE</span>
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Home Showcase</h1>
            </div>
            <div className="font-mono text-[11px] text-gray-500 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.04] border border-black/10 dark:border-white/10">{t("home.channelWorksCount", { count: allKeysOrdered.length })} Channels</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {allKeysOrdered.map((key) => {
            const isCustom = key.startsWith("custom:");
            const sys = !isCustom ? systemMap.get(key) : null;
            const cs = isCustom ? customMap.get(key) : null;
            const label = isCustom
              ? (locale === "en-US" && cs?.name_en ? cs!.name_en : cs?.name_zh || key)
              : (locale === "en-US" && sys?.name_en ? sys!.name_en : sys?.name_zh || key);
            const Icon = isCustom
              ? (SHELF_ICONS[cs?.media_type || ""] || Sparkles)
              : (SHELF_ICONS[key] || SHELF_ICONS[sys?.media_type || ""] || Layers);
            const count = worksByKey[key]?.length ?? 0;
            return (
              <a
                key={key}
                href={`#shelf-${key}`}
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md border border-black/10 dark:border-white/10 bg-surface hover:border-primary/50 text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-primary transition-all whitespace-nowrap shadow-2xs"
              >
                <Icon className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                <span>{label}</span>
                <span className="font-mono text-[10px] text-gray-400">({count})</span>
              </a>
            );
          })}
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-dashed border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs font-medium whitespace-nowrap shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>{t("shelf.customize")}</span>
          </button>
        </div>
        </div>

        {/* Channel Showcases */}
        {loading ? (
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
        ) : allKeysOrdered.length === 0 ? (
          <div className="p-8 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 text-center space-y-2.5">
            <p className="font-mono text-xs text-gray-500">{t("shelf.empty")}</p>
            <p className="font-mono text-xs text-gray-400">{t("shelf.emptyHint")}</p>
            <button onClick={() => setConfigOpen(true)} className="inline-flex items-center gap-1.5 px-3.5 h-7.5 rounded-md bg-primary text-white text-xs font-semibold">
              <Settings2 className="w-3.5 h-3.5" /> {t("shelf.customize")}
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {allKeysOrdered.map((key) => {
              const isCustom = key.startsWith("custom:");
              const sys = !isCustom ? systemMap.get(key) : null;
              const cs = isCustom ? customMap.get(key) : null;
              if (!sys && !cs) return null;
              const shelfWorks = worksByKey[key] || [];
              const Icon = isCustom
                ? (SHELF_ICONS[cs?.media_type || ""] || Sparkles)
                : (SHELF_ICONS[key] || SHELF_ICONS[sys?.media_type || ""] || Layers);
              const shelfTitle = isCustom
                ? (locale === "en-US" && cs?.name_en ? cs!.name_en : cs?.name_zh || "")
                : (locale === "en-US" && sys?.name_en ? sys!.name_en : sys?.name_zh || "");

              const viewAllHref = isCustom
                ? `/explore?custom_shelf=${cs!.id}`
                : `/explore?shelf=${key}`;

              return (
                <section key={key} id={`shelf-${key}`} className="space-y-3 scroll-mt-16">
                  <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.06] pb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-sm grid place-items-center border ${getShelfColor(key, isCustom ? cs?.media_type : sys?.media_type)}`}>
                        <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </div>
                      <div>
                        <h2 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm flex items-center gap-1.5">
                          {shelfTitle}
                          {isCustom && <span className="px-1.5 py-0.2 rounded-sm bg-primary/10 text-primary border border-primary/20 font-mono text-[9px]">自建</span>}
                        </h2>
                        <p className="font-mono text-[11px] text-gray-500">
                          {t("home.channelWorksCount", { count: shelfWorks.length })}
                          {isCustom && cs?.query_tags?.length ? ` · ${(cs.query_tags || []).join(", ")}` : ""}
                        </p>
                      </div>
                    </div>

                    <Link
                      href={viewAllHref}
                      className="inline-flex items-center gap-0.5 font-mono text-xs text-primary hover:underline font-medium"
                    >
                      <span>{t("home.viewAll")}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>

                  {shelfWorks.length === 0 ? (
                    <div className="p-6 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-1.5">
                      <p className="font-mono text-xs text-gray-500">{t("home.channelEmpty")}</p>
                      <Link
                        href="/works/new"
                        className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                      >
                        <Plus className="w-3 h-3" /> {t("home.addWork")}
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
                          <div className="aspect-[3/4] w-full bg-black/5 dark:bg-black/40 relative overflow-hidden">
                            {w.cover_image_url ? (
                              <img
                                src={w.cover_image_url}
                                alt={w.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            ) : (
                              <div className="w-full h-full grid place-items-center text-gray-400">
                                <Disc3 className="w-8 h-8 opacity-30" />
                              </div>
                            )}
                            <div className="absolute top-1.5 left-1.5 px-1.5 py-0.2 rounded-sm bg-black/70 backdrop-blur-md text-[9px] font-mono text-white keep-white">
                              {w.release_date ? String(w.release_date).slice(0, 4) : t("home.archived")}
                            </div>
                          </div>
                          <div className="p-2.5 space-y-1 flex-1 flex flex-col justify-between">
                            <div>
                              <h3 className="font-semibold text-gray-900 dark:text-white text-xs line-clamp-1 group-hover:text-primary transition-colors">
                                {w.title}
                              </h3>
                              {w.original_title && (
                                <p className="font-mono text-[10px] text-gray-500 line-clamp-1">
                                  {w.original_title}
                                </p>
                              )}
                            </div>
                            {w.tags && w.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {w.tags.slice(0, 2).map((tag) => (
                                  <span
                                    key={tag.id}
                                    className="px-1 py-0.2 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] text-[9px] font-mono text-gray-500"
                                  >
                                    #{tag.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="pt-1.5 flex items-center justify-between font-mono text-[10px] text-gray-500 border-t border-black/[0.04] dark:border-white/[0.04]">
                              <span className="truncate">{w.media_type || t("home.workFallback")}</span>
                              <span className="flex items-center gap-0.5 group-hover:text-primary transition-colors">
                                {t("home.detail")} <ChevronRight className="w-3 h-3" />
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
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-primary">
                <MessageCircle className="w-3.5 h-3.5" />
                <span>COMMUNITY FORUM</span>
              </div>
              <Link href="/community" className="font-mono text-xs text-primary hover:underline flex items-center gap-1 font-medium">
                <span>{t("home.enterForum")}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <h2 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("home.communityTitle")}</h2>
              <span className="font-mono text-[11px] text-gray-500">— {t("home.boardFallback")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
              {topics.map((tp) => (
                <Link
                  key={tp.id}
                  href={`/community/${tp.id}`}
                  className="p-3 rounded-md bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06] hover:border-primary/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-all space-y-1 block group"
                >
                  <h4 className="font-semibold text-xs text-gray-900 dark:text-white line-clamp-1 group-hover:text-primary transition-colors">
                    {tp.title}
                  </h4>
                  <div className="flex items-center justify-between font-mono text-[11px] text-gray-500">
                    <span>{tp.board_code || t("home.boardFallback")}</span>
                    <span>{String(tp.created_at || "").slice(0, 10)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <HomeShelvesConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        systemShelves={shelves}
        customShelves={customShelves}
        hiddenSlugs={hiddenSlugs}
        orderKeys={orderKeys.length > 0 ? orderKeys : [...shelves.map((s) => s.slug), ...customShelves.map((c) => `custom:${c.id}`)]}
        onSaveLayout={handleSaveLayout}
        onCreateCustom={handleCreateCustom}
        onUpdateCustom={handleUpdateCustom}
        onDeleteCustom={handleDeleteCustom}
        onRefreshCustom={refreshCustom}
      />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center font-mono text-xs text-gray-500">Loading…</div>}>
      <HomeShowcaseContent />
    </Suspense>
  );
}
