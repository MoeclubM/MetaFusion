"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions, getKindName, getTagNames, type KindMap } from "@/lib/definitions";
import { pickRecordTitle } from "@/lib/titles";
import { coverUrl, type CoverBearing } from "@/lib/cover";
import { PageContainer, PageShell } from "@/components/ui/PageShell";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import { useAuth } from "@/lib/authContext";
import { EntityCard } from "@/components/common/EntityCard";
import { SearchSuggest } from "@/components/common/SearchSuggest";
import { fetchApi } from "@/lib/api";
import { localizeCatalogError } from "@/lib/catalogErrors";
import { HomeCustomizeModal } from "@/components/home/HomeCustomizeModal";
import {
  EMPTY_PREFERENCES,
  iconFor,
  normalizePreferences,
  shelfTitle,
  type HomePreferences,
  type ShelfLike,
} from "@/lib/homeSections";
import { Sparkles, Sliders } from "lucide-react";

/** 首页分区条目：图片结构复用 lib/cover 的 CoverBearing（首张即封面只在那一处定义）。 */
type EntityItem = CoverBearing & {
  id: string;
  kind: string;
  title: string;
  original_language?: string;
  translations?: Record<string, { title?: string; summary?: string; aliases?: string[] }>;
  types?: string[];
  attributes?: { tags?: string[] };
  version?: number;
};

// 分区定义（含 source：system 只能隐藏、custom 可删除）与图标集见 lib/homeSections.ts。
type FeedSection = { shelf: ShelfLike; items: EntityItem[] };

export default function HomePage() {
  const { t, tr, locale } = useI18n();
  const router = useRouter();
  const { definitions, kinds } = useDefinitions();
  const titleOrder = useTitleDisplayOrder();
  const { user, loading: authLoading } = useAuth();

  const [searchQuery, setSearchQuery] = useState("");
  const [sections, setSections] = useState<FeedSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [prefs, setPrefs] = useState<HomePreferences>(EMPTY_PREFERENCES);
  const [templates, setTemplates] = useState<ShelfLike[]>([]);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      // 统一走 fetchApi：同域 Cookie、语言头与错误处理保持一致。
      // 用 components/catalog 的 api() 只会发 cookie，带身份的偏好不会被识别。
      const r = await fetchApi<{ items: FeedSection[] }>("/catalog/shelves/feed?per_shelf=12");
      setSections(Array.isArray(r.items) ? r.items : []);
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

  // 空分区不展示：推荐位不该出现"0 部作品"这类噪音。
  const visibleSections = useMemo(
    () => sections.filter((s) => (Array.isArray(s.items) ? s.items : []).length > 0),
    [sections],
  );

  const openCustomize = async () => {
    setSaveError("");
    setCustomizing(true);
    if (!user) return;
    setPrefsLoading(true);
    try {
      // 偏好给出用户自己的分区配置；/catalog/shelves 给出系统预设——它既是「添加分区」
      // 的候选，也是隐藏分区的定义来源（feed 已按偏好把隐藏项过滤掉了）。
      const [loaded, tpl] = await Promise.all([
        fetchApi<HomePreferences>("/catalog/me/home-preferences"),
        fetchApi<{ items: ShelfLike[] }>("/catalog/shelves"),
      ]);
      setPrefs(normalizePreferences(loaded));
      setTemplates(Array.isArray(tpl.items) ? tpl.items : []);
    } catch {
      setPrefs(EMPTY_PREFERENCES);
      setTemplates([]);
    } finally {
      setPrefsLoading(false);
    }
  };

  const savePrefs = async (payload: HomePreferences) => {
    setSaving(true);
    setSaveError("");
    try {
      await fetchApi("/catalog/me/home-preferences", { method: "PUT", body: JSON.stringify(payload) });
      setCustomizing(false);
      await loadFeed();
    } catch (e) {
      // 后端给的是稳定错误码（invalid_slug / too_many_sections …），翻成四语文案再显示。
      setSaveError(localizeCatalogError((e as Error).message, t));
    } finally {
      setSaving(false);
    }
  };

  // 恢复默认 = 清空偏好、回落到系统预设；不改系统货架，也不影响别人。
  const resetPrefs = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await fetchApi("/catalog/me/home-preferences", {
        method: "PUT",
        body: JSON.stringify(EMPTY_PREFERENCES),
      });
      setPrefs(EMPTY_PREFERENCES);
      setCustomizing(false);
      await loadFeed();
    } catch (e) {
      setSaveError(localizeCatalogError((e as Error).message, t));
    } finally {
      setSaving(false);
    }
  };

  const showSkeleton = authLoading || loading;

  // 根容器裁剪装饰光晕：-bottom-40/-right-40 的 600px 光晕溢出到视口外会撑出横向滚动条
  // （线上实测桌面 +154px / 移动 +161px）。用 overflow-clip 而不是 overflow-hidden——
  // clip 不建滚动容器，页内 sticky 的搜索栏与顶栏照旧相对视口吸附。
  return (
    <div className="min-h-screen flex flex-col bg-background text-text-strong relative overflow-clip selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />

      <Navbar />

      <div className="border-b border-line-subtle bg-surface/60 backdrop-blur-xl sticky top-[var(--mf-header-h)] z-30 shadow-xs">
        <PageContainer className="py-4 flex justify-center">
          <SearchSuggest
            className="w-full max-w-3xl"
            size="lg"
            value={searchQuery}
            onValueChange={setSearchQuery}
            onSubmit={(q) => router.push(q ? "/explore?q=" + encodeURIComponent(q) : "/explore")}
            placeholder={t("home.searchPlaceholder")}
            submitLabel={t("home.search")}
          />
        </PageContainer>
      </div>

      {/* 首页区块间距保持 40px：首屏块与列表差异大，收紧会挤在一起。 */}
      <PageShell width="page" spacing="none" contentClassName="space-y-10" className="relative z-10">
        {user && (
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-lg font-bold tracking-tight text-emphasis">
              {t("home.recommended")}
            </h1>
            <button
              type="button"
              onClick={() => void openCustomize()}
              className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-lg border border-line bg-emphasis/[0.03] hover:bg-emphasis/[0.07] text-xs font-medium text-text-body hover:text-emphasis transition-colors duration-fast ease-soft cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{t("home.customize")}</span>
            </button>
          </div>
        )}

        {failed && (
          <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-warn-soft text-xs font-mono">
            {t("catalog.connectionError")}
          </div>
        )}

        {showSkeleton ? (
          <div className="space-y-10">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-4">
                <div className="h-5 w-40 bg-emphasis/[0.04] rounded-md animate-pulse" />
                <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <div key={j} className="aspect-[3/4] rounded-xl bg-emphasis/[0.02] border border-line-subtle animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : visibleSections.length === 0 && !failed ? (
          <div className="p-10 rounded-xl border border-dashed border-line bg-emphasis/[0.01] text-center space-y-3">
            <Sparkles className="w-7 h-7 text-gray-600 mx-auto" />
            <p className="text-sm text-text-muted">{t("home.recommendEmpty")}</p>
            <Link
              href="/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors duration-fast ease-soft"
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
                <div className="flex items-center justify-between border-b border-emphasis/[0.08] pb-3">
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl border border-primary/20 bg-primary/10 flex items-center justify-center text-primary">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="font-bold text-emphasis text-base sm:text-lg tracking-tight">{title}</h2>
                      <span className="px-2 py-0.5 rounded-full bg-emphasis/[0.06] text-text-muted text-xs font-mono">
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

                <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
                  {items.map((item) => {
                    const displayTitle = pickRecordTitle(locale, item.translations, item.title, {
                      order: titleOrder,
                      originalLanguage: item.original_language,
                    });
                    // 角标显示**实体类型**（八骨架 kind），不是业务分类：
                    // 分类由货架（catalog.shelves）承担，业务类型在卡片正文里另行展示。
                    const badge = badgeFor(item.kind, kinds, locale, tr);
                    // 首页分区只看封面（首张图）：多图画廊在详情页。
                    const cover = coverUrl(item);
                    return (
                      <EntityCard
                        key={item.id}
                        id={item.id}
                        kind={item.kind}
                        badgeLabel={badge}
                        title={displayTitle}
                        baseTitle={item.title}
                        tags={getTagNames(definitions, item.attributes?.tags, locale)}
                        pictureUrl={cover}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </PageShell>

      <HomeCustomizeModal
        open={customizing}
        loading={prefsLoading}
        prefs={prefs}
        templates={templates}
        feedSections={sections}
        defs={definitions}
        saving={saving}
        error={saveError}
        onClose={() => setCustomizing(false)}
        onSave={(payload) => void savePrefs(payload)}
        onReset={() => void resetPrefs()}
      />

      <footer className="border-t border-line-subtle py-6 bg-surface/30 backdrop-blur-md">
        <PageContainer className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-text-muted">
          <div>
            <span>© 2026 MetaFusion · Open Metadata &amp; Resource Sharing Platform</span>
          </div>
          {/* 这里只留顶栏没有的入口：/landing 与 /explore、/community、/docs/catalog
              都已由顶栏 Logo 与主导航覆盖，不再重复。 */}
          <div className="flex items-center gap-4 flex-wrap">
            <a href="/developers" className="hover:text-emphasis transition-colors duration-fast ease-soft">
              {t("home.footerApi")}
            </a>
          </div>
        </PageContainer>
      </footer>
    </div>
  );
}

// 分区"查看全部"进入探索页：用该分区规则的首个类型过滤，跳转目标与推荐内容一致。
// 规则没限定类型（收录全部作品）时只带 kind=work。
function shelfExploreParam(shelf: ShelfLike): string {
  const first = (shelf.query?.types || []).filter(Boolean)[0];
  return first ? `kind=work&type=${encodeURIComponent(first)}` : "kind=work";
}

// 卡片左上角角标 = 实体类型（八骨架 kind），名称取服务端 definitions 的多语言 kinds，
// 缺失时回退前端字典的同名键。**不再**用业务类型当"分类"角标：
//   * 业务类型（album/song/动画…）是动态类型，本就该在卡片正文里以类型标签呈现；
//   * "分类"这件事只由货架（catalog.shelves，数据驱动、后台可配、名称多语言）承担。
// 这样页面不再出现"系统自己发明一套固定分类"的东西。
function badgeFor(
  kind: string,
  kinds: KindMap | null,
  loc: string,
  translate: (k: string, f: string) => string,
): string {
  return getKindName(kinds, kind, loc, translate("catalog.kind." + kind, kind));
}
