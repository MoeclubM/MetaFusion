"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions, getTypeName, resolveLocalizedName } from "@/lib/definitions";
import { pickRecordTitle } from "@/lib/titles";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import { useAuth } from "@/lib/authContext";
import { AdaptiveCardCover } from "@/components/common/AdaptiveCardCover";
import { fetchApi } from "@/lib/api";
import {
  Search,
  Disc,
  BookOpen,
  Film,
  Tv,
  Gamepad2,
  Camera,
  Layers,
  Music,
  Sparkles,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Check,
  RotateCcw,
  Sliders,
  X,
} from "lucide-react";

type EntityItem = {
  id: string;
  kind: string;
  title: string;
  original_language?: string;
  translations?: Record<string, { title?: string; summary?: string; aliases?: string[] }>;
  types?: string[];
  pictures?: { url: string }[];
  version?: number;
};

type PublicShelf = {
  slug: string;
  names?: Record<string, string> | null;
  name_zh?: string;
  name_en?: string;
  icon?: string;
  query?: { types?: string[] | null } | null;
};

type FeedSection = { shelf: PublicShelf; items: EntityItem[] };

type HomePreferences = { order: string[]; hidden: string[] };

// 分区图标按货架声明的 icon 名映射；未声明的按 slug 兜底，最后回落到通用图标。
const ICONS: Record<string, React.ElementType> = {
  Disc,
  Tv,
  Film,
  Gamepad2,
  Camera,
  BookOpen,
  Layers,
  Music,
  Sparkles,
};

function iconFor(shelf: PublicShelf): React.ElementType {
  if (shelf.icon && ICONS[shelf.icon]) return ICONS[shelf.icon];
  return ICONS[shelf.slug] || Sparkles;
}

function shelfTitle(shelf: PublicShelf, locale: string): string {
  return resolveLocalizedName(shelf.names || undefined, locale, shelf.name_en || shelf.name_zh || shelf.slug);
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { definitions } = useDefinitions();
  const titleOrder = useTitleDisplayOrder();
  const { user, loading: authLoading } = useAuth();

  const [searchQuery, setSearchQuery] = useState("");
  const [sections, setSections] = useState<FeedSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [prefs, setPrefs] = useState<HomePreferences>({ order: [], hidden: [] });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      // 必须用 fetchApi：登录态 token 存在 localStorage，只有它会带 Authorization。
      // 用 components/catalog 的 api() 只会发 cookie，带身份的偏好不会被识别。
      const r = await fetchApi<{ items: FeedSection[] }>("/catalog/shelves/feed?per_shelf=12");
      setSections(r.items || []);
    } catch {
      setSections([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void loadFeed();
  }, [authLoading, loadFeed]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? "/explore?q=" + encodeURIComponent(q) : "/explore");
  };

  // 空分区不展示：推荐位不该出现"0 部作品"这类噪音。
  const visibleSections = useMemo(
    () => sections.filter((s) => (s.items || []).length > 0),
    [sections],
  );

  // 自定义面板的候选：以服务端返回的全部分区为准（含被隐藏的空分区），
  // 这样用户隐藏后仍能在面板里重新开启。
  const allSlugs = useMemo(
    () => sections.map((s) => s.shelf.slug).filter(Boolean),
    [sections],
  );

  const openCustomize = async () => {
    setSaveError("");
    setCustomizing(true);
    if (!user) return;
    try {
      const r = await fetchApi<HomePreferences>("/catalog/me/home-preferences");
      setPrefs({ order: r.order || [], hidden: r.hidden || [] });
    } catch {
      setPrefs({ order: [], hidden: [] });
    }
  };

  const toggleHidden = (slug: string) => {
    setPrefs((p) => ({
      order: p.order.filter((x) => x !== slug),
      hidden: p.hidden.includes(slug) ? p.hidden.filter((x) => x !== slug) : [...p.hidden, slug],
    }));
  };

  const move = (slug: string, dir: -1 | 1) => {
    setPrefs((p) => {
      // 面板里的显示顺序 = order 里列出的 + 其余默认序；移动时先物化完整顺序。
      const listed = p.order.filter((x) => allSlugs.includes(x) && !p.hidden.includes(x));
      const rest = allSlugs.filter(
        (s) => !listed.includes(s) && !p.hidden.includes(s),
      );
      const seq = [...listed, ...rest];
      const i = seq.indexOf(slug);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= seq.length) return p;
      [seq[i], seq[j]] = [seq[j], seq[i]];
      return { ...p, order: seq };
    });
  };

  const savePrefs = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await fetchApi("/catalog/me/home-preferences", { method: "PUT", body: JSON.stringify(prefs) });
      setCustomizing(false);
      await loadFeed();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetPrefs = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await fetchApi("/catalog/me/home-preferences", { method: "PUT", body: JSON.stringify({ order: [], hidden: [] }) });
      setPrefs({ order: [], hidden: [] });
      await loadFeed();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const panelSections = useMemo(() => {
    const listed = prefs.order.filter((x) => allSlugs.includes(x));
    const rest = allSlugs.filter((s) => !listed.includes(s));
    const seq = [...listed, ...rest];
    const byslug = new Map(sections.map((s) => [s.shelf.slug, s.shelf]));
    return seq.map((slug) => byslug.get(slug)).filter(Boolean) as PublicShelf[];
  }, [prefs.order, allSlugs, sections]);

  const showSkeleton = authLoading || loading;

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100 relative selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />

      <Navbar />

      <div className="border-b border-white/[0.06] bg-surface/60 backdrop-blur-xl sticky top-14 sm:top-15 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex justify-center">
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full flex-1 space-y-10 relative z-10">
        {user && (
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-lg font-bold tracking-tight text-white">
              {t("home.recommended")}
            </h1>
            <button
              type="button"
              onClick={() => void openCustomize()}
              className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-xs font-medium text-gray-300 hover:text-white transition-colors cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{t("home.customize")}</span>
            </button>
          </div>
        )}

        {failed && (
          <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-mono">
            {t("catalog.connectionError")}
          </div>
        )}

        {showSkeleton ? (
          <div className="space-y-10">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-4">
                <div className="h-5 w-40 bg-white/[0.04] rounded-md animate-pulse" />
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <div key={j} className="aspect-square rounded-xl bg-white/[0.02] border border-white/[0.04] animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : visibleSections.length === 0 && !failed ? (
          <div className="p-10 rounded-xl border border-dashed border-white/10 bg-white/[0.01] text-center space-y-3">
            <Sparkles className="w-7 h-7 text-gray-600 mx-auto" />
            <p className="text-sm text-gray-400">{t("home.recommendEmpty")}</p>
            <Link
              href="/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t("home.addFirst")}</span>
            </Link>
          </div>
        ) : (
          visibleSections.map(({ shelf, items }) => {
            const Icon = iconFor(shelf);
            const title = shelfTitle(shelf, locale);
            return (
              <section key={shelf.slug} className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl border border-primary/20 bg-primary/10 flex items-center justify-center text-primary">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="font-bold text-white text-base sm:text-lg tracking-tight">{title}</h2>
                      <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-gray-400 text-xs font-mono">
                        {t("home.itemCount", { count: items.length.toString() })}
                      </span>
                    </div>
                  </div>
                  <Link
                    href={"/explore?" + shelfExploreParam(shelf)}
                    className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline"
                  >
                    <span>{t("home.viewAll")}</span>
                  </Link>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {items.map((item) => {
                    const displayTitle = pickRecordTitle(locale, item.translations, item.title, {
                      order: titleOrder,
                      originalLanguage: item.original_language,
                    });
                    const badge = badgeFor(item, definitions, locale, t);
                    return (
                      <Link
                        key={item.id}
                        href={"/catalog/" + item.id}
                        className="group flex flex-col rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/20 overflow-hidden transition-all shadow-2xs hover:shadow-md"
                      >
                        <AdaptiveCardCover
                          src={item.pictures && item.pictures[0]?.url}
                          alt={displayTitle}
                          aspectClassName="aspect-square"
                          badge={
                            <span className="px-2 py-0.5 rounded-md bg-black/65 text-white keep-white backdrop-blur-md border border-white/20 text-[10px] font-medium shadow-2xs flex items-center gap-1.5 leading-none">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                              <span className="truncate max-w-[85px]">{badge}</span>
                            </span>
                          }
                          fallbackIcon={<Icon className="w-8 h-8 opacity-40 text-primary" />}
                          fallbackTitle={displayTitle}
                        />
                        <div className="p-3 flex-1 flex flex-col justify-between">
                          <div>
                            <h3 className="font-medium text-white group-hover:text-primary transition-colors text-xs sm:text-sm line-clamp-2 leading-snug mb-1">
                              {displayTitle}
                            </h3>
                            {item.title !== displayTitle && (
                              <p className="text-[10px] text-gray-400 font-mono line-clamp-1 mb-1">{item.title}</p>
                            )}
                          </div>
                          <div className="pt-2 border-t border-white/[0.04] flex items-center justify-end text-[10px] text-gray-400 font-mono">
                            <span className="group-hover:text-primary transition-colors flex items-center gap-0.5">
                              {t("home.details")} <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </main>

      {customizing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-surface shadow-elevated">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
              <h2 className="font-display font-bold text-sm text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-primary" />
                {t("home.customizeTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setCustomizing(false)}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] text-gray-400 hover:text-white transition-colors cursor-pointer"
                aria-label={t("catalog.cancel")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
              <p className="text-xs text-gray-500 pb-1">{t("home.customizeHint")}</p>
              {panelSections.length === 0 ? (
                <p className="text-xs text-gray-500 py-6 text-center">{t("shelf.empty")}</p>
              ) : (
                panelSections.map((shelf, idx) => {
                  const hidden = prefs.hidden.includes(shelf.slug);
                  const Icon = iconFor(shelf);
                  return (
                    <div
                      key={shelf.slug}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.02]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleHidden(shelf.slug)}
                        className={
                          "w-5 h-5 rounded border grid place-items-center shrink-0 transition-colors cursor-pointer " +
                          (hidden
                            ? "border-white/15 bg-transparent text-transparent"
                            : "border-primary bg-primary text-white")
                        }
                        aria-pressed={!hidden}
                        aria-label={t("home.toggleSection")}
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <Icon className={"w-4 h-4 shrink-0 " + (hidden ? "text-gray-600" : "text-primary")} />
                      <span className={"flex-1 text-xs truncate " + (hidden ? "text-gray-600 line-through" : "text-gray-200")}>
                        {shelfTitle(shelf, locale)}
                      </span>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => move(shelf.slug, -1)}
                        className="p-1 rounded hover:bg-white/[0.06] text-gray-400 hover:text-white disabled:opacity-25 disabled:pointer-events-none cursor-pointer"
                        aria-label={t("home.moveUp")}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === panelSections.length - 1}
                        onClick={() => move(shelf.slug, 1)}
                        className="p-1 rounded hover:bg-white/[0.06] text-gray-400 hover:text-white disabled:opacity-25 disabled:pointer-events-none cursor-pointer"
                        aria-label={t("home.moveDown")}
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-5 py-4 border-t border-white/[0.08] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void resetPrefs()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-gray-400 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t("home.customizeReset")}</span>
              </button>
              <div className="flex items-center gap-2">
                {saveError && <span className="text-[11px] text-red-400 font-mono">{saveError}</span>}
                <button
                  type="button"
                  onClick={() => void savePrefs()}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-white/[0.06] py-6 bg-surface/30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-gray-400">
          <div>
            <span>© 2026 MetaFusion · Open Metadata &amp; Resource Sharing Platform</span>
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
            <Link href="/docs/catalog" className="hover:text-white transition-colors">
              {t("home.footerDocs")}
            </Link>
            <a href="/developers" className="hover:text-white transition-colors">
              {t("home.footerApi")}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// 分区"查看全部"进入探索页：用该分区规则的首个类型过滤，跳转目标与推荐内容一致。
// 规则没限定类型（收录全部作品）时只带 kind=work。
function shelfExploreParam(shelf: PublicShelf): string {
  const first = (shelf.query?.types || []).filter(Boolean)[0];
  return first ? `kind=work&type=${encodeURIComponent(first)}` : "kind=work";
}

function badgeFor(
  item: EntityItem,
  defs: any,
  loc: string,
  translate: (k: string) => string,
): string {
  if (item.types && item.types.length > 0) {
    for (const code of item.types) {
      const name = getTypeName(defs, code, loc);
      if (name && name !== code) return name;
    }
  }
  const kindKey = "catalog.kind." + item.kind;
  const translated = translate(kindKey);
  if (translated && translated !== kindKey) return translated;
  if (item.kind === "work") return translate("home.kind.work");
  if (item.kind === "release") return translate("home.kind.release");
  if (item.kind === "agent") return translate("home.kind.agent");
  return item.kind;
}
