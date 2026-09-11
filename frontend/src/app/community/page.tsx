"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { CatalogProvider, useCatalog } from "@/components/catalog/CatalogProvider";
import { fetchApi, type User } from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { FORUM_SERVICE_URL } from "@/lib/services";
import { UserAvatar } from "@/components/UserAvatar";

// Markdown 渲染依赖 katex/highlight.js（数百 KB），按需加载以免拖慢列表首屏。
const MarkdownRenderer = dynamic(() => import("@/components/MarkdownRenderer"), {
  loading: () => <div className="h-4 my-1.5 rounded bg-black/[0.04] dark:bg-white/[0.04] animate-pulse" />,
});
import {
  MessageSquare,
  Info,
  Loader2,
  MessageCircle,
  Search,
  Clock,
  ArrowUpNarrowWide,
  Trash2,
  X,
  Send,
} from "lucide-react";

// 配置了独立论坛服务（http 地址）时，社区由外部系统承载，直接跳转；
// 未配置时使用本仓库后端的社区模块（实体锚定的短评讨论流）。
const FORUM_IS_EXTERNAL = FORUM_SERVICE_URL.startsWith("http");

type FeedItem = {
  id: string;
  entity_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  entity_title?: string;
  entity_kind?: string;
};

type SortMode = "recent" | "oldest";

function formatTime(value: string, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

function CommunityFeed() {
  const { t, locale } = useI18n();
  const { modules } = useCatalog();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const entityFilter = searchParams.get("entity_id") || "";

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState<string>("");
  // 发帖：仅在带 entity_id 进入（即从某个条目跳来）时启用，因为短评锚定实体。
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");

  const communityEnabled = modules.some(
    (m) => m.id === "community" && m.enabled && m.healthy,
  );
  // modules 未加载完成时不闪现"未开放"，加载后再按开关决定。
  const modulesResolved = modules.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (entityFilter) params.set("entity_id", entityFilter);
      if (sort === "oldest") params.set("sort", "oldest");
      if (q.trim()) params.set("q", q.trim());
      const qs = params.toString();
      // 必须用 fetchApi：登录态 token 存在 localStorage，只有它会带 Authorization。
      const r = await fetchApi<{ items: FeedItem[] }>(
        "/community/feed" + (qs ? `?${qs}` : ""),
      );
      setItems(r.items || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [entityFilter, sort, q]);

  useEffect(() => {
    if (!modulesResolved || !communityEnabled) {
      setLoading(false);
      return;
    }
    void load();
  }, [modulesResolved, communityEnabled, load]);

  // 外部论坛已配置时交由外部系统承载。
  useEffect(() => {
    if (FORUM_IS_EXTERNAL) window.location.replace(FORUM_SERVICE_URL);
  }, []);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQ(qInput);
  };

  const onDelete = async (id: string) => {
    if (!window.confirm(t("community.deleteConfirm"))) return;
    setDeleting(id);
    try {
      await fetchApi(`/community/posts/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting("");
    }
  };

  const onSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !entityFilter) return;
    setPosting(true);
    setPostError("");
    try {
      await fetchApi(`/community/entities/${entityFilter}/posts`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setDraft("");
      await load();
    } catch (err) {
      setPostError((err as Error).message);
    } finally {
      setPosting(false);
    }
  };

  const canDelete = (p: FeedItem) =>
    !!user && (user.id === p.author_id || (user as User).role === "admin");

  // 侧栏"涉及的条目"：按当前结果去重聚合。计数反映当前结果集，不冒充全站总量。
  const scopeEntities = useMemo(() => {
    const map = new Map<string, { id: string; title: string; count: number }>();
    for (const it of items) {
      if (!it.entity_id) continue;
      const cur = map.get(it.entity_id);
      if (cur) cur.count += 1;
      else
        map.set(it.entity_id, {
          id: it.entity_id,
          title: it.entity_title || it.entity_id,
          count: 1,
        });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 30);
  }, [items]);

  const scopedTitle = entityFilter
    ? items[0]?.entity_title || t("community.feedLinkedEntity")
    : t("navigation.community");

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
          {/* 左栏：讨论范围（实体锚定，取代旧论坛的"分区"） */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-black/[0.06] dark:border-white/[0.06]">
                <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500">
                  {t("community.scope")}
                </span>
              </div>
              <nav className="p-2 space-y-0.5">
                <Link
                  href="/community"
                  className={
                    "flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors " +
                    (!entityFilter
                      ? "bg-primary/10 text-primary border border-primary/25 font-semibold"
                      : "text-gray-600 dark:text-gray-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-gray-900 dark:hover:text-white border border-transparent")
                  }
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{t("community.allDiscussions")}</span>
                </Link>
                {scopeEntities.length > 0 && (
                  <div className="pt-2 mt-1 border-t border-black/[0.06] dark:border-white/[0.06] space-y-0.5">
                    <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-gray-500">
                      {t("community.discussedEntities")}
                    </div>
                    {scopeEntities.map((en) => {
                      const on = entityFilter === en.id;
                      return (
                        <Link
                          key={en.id}
                          href={`/community?entity_id=${encodeURIComponent(en.id)}`}
                          className={
                            "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors " +
                            (on
                              ? "bg-primary/10 text-primary border border-primary/25 font-semibold"
                              : "text-gray-600 dark:text-gray-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-gray-900 dark:hover:text-white border border-transparent")
                          }
                          title={en.title}
                        >
                          <span className="truncate">{en.title}</span>
                          <span className="font-mono text-[10px] text-gray-500 shrink-0">{en.count}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </nav>
            </div>
          </aside>

          {/* 右栏：讨论流 */}
          <div className="min-w-0 space-y-5">
            <header className="space-y-1.5">
              <h1 className="font-display text-xl font-bold flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-emerald-500" strokeWidth={1.75} />
                {scopedTitle}
              </h1>
              <p className="text-sm text-gray-500">{t("community.feedSubtitle")}</p>
            </header>

            {entityFilter && (
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-primary/25 bg-primary/10 text-primary font-mono">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {t("community.scopedToEntity")}
                </span>
                <Link href="/community" className="inline-flex items-center gap-1 text-gray-500 hover:text-white transition-colors">
                  <X className="w-3.5 h-3.5" />
                  <span>{t("community.clearScope")}</span>
                </Link>
              </div>
            )}

            {!modulesResolved || loading ? (
              <div className="grid place-items-center py-16 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : !communityEnabled ? (
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-surface p-8 text-center space-y-3">
                <Info className="w-6 h-6 text-amber-400 mx-auto" />
                <p className="text-sm text-gray-400">{t("community.moduleDisabled")}</p>
              </div>
            ) : (
              <>
                {/* 工具条：搜索 + 排序 */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl bg-surface border border-black/10 dark:border-white/[0.08]">
                  <form onSubmit={onSearchSubmit} className="relative flex-1 flex items-center">
                    <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      value={qInput}
                      onChange={(e) => setQInput(e.target.value)}
                      placeholder={t("community.searchPlaceholder")}
                      className="w-full pl-9 pr-16 py-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-primary outline-none transition-all"
                    />
                    <button
                      type="submit"
                      className="absolute right-1.5 px-3 py-1 rounded bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {t("catalog.searchAction")}
                    </button>
                  </form>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSort("recent")}
                      className={
                        "inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs border transition-colors cursor-pointer " +
                        (sort === "recent"
                          ? "bg-primary/15 border-primary/40 text-primary font-semibold"
                          : "bg-surface border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white")
                      }
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>{t("community.sortRecent")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSort("oldest")}
                      className={
                        "inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs border transition-colors cursor-pointer " +
                        (sort === "oldest"
                          ? "bg-primary/15 border-primary/40 text-primary font-semibold"
                          : "bg-surface border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white")
                      }
                    >
                      <ArrowUpNarrowWide className="w-3.5 h-3.5" />
                      <span>{t("community.sortOldest")}</span>
                    </button>
                  </div>
                </div>

                {/* 发帖：仅在锁定某个条目时可用（短评锚定实体） */}
                {entityFilter && user && (
                  <form
                    onSubmit={onSubmitPost}
                    className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-4 space-y-2.5"
                  >
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      maxLength={20000}
                      placeholder={t("community.postPlaceholder")}
                      className="w-full px-3 py-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-primary outline-none resize-y transition-all"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-mono text-gray-500">
                        {t("community.markdownHint")}
                      </span>
                      <div className="flex items-center gap-2">
                        {postError && <span className="text-[11px] text-red-400 font-mono">{postError}</span>}
                        <button
                          type="submit"
                          disabled={posting || !draft.trim()}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{posting ? t("common.saving") : t("community.post")}</span>
                        </button>
                      </div>
                    </div>
                  </form>
                )}

                {error ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center space-y-3">
                    <p className="text-sm text-red-400">{t("catalog.connectionError")}</p>
                    <button
                      type="button"
                      onClick={() => void load()}
                      className="text-xs font-mono text-primary hover:underline"
                    >
                      {t("catalog.retry")}
                    </button>
                  </div>
                ) : items.length === 0 ? (
                  <div className="rounded-xl border border-black/10 dark:border-white/10 bg-surface p-10 text-center space-y-2">
                    <MessageCircle className="w-7 h-7 text-gray-600 mx-auto" />
                    <p className="text-sm text-gray-400">{t("community.feedEmpty")}</p>
                    <p className="text-xs text-gray-600">{t("community.feedEmptyHint")}</p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {items.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-4 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <UserAvatar user={{ username: p.author_name }} size="sm" />
                            <span className="font-semibold text-xs text-gray-700 dark:text-gray-300 truncate">
                              {p.author_name}
                            </span>
                            <time className="font-mono text-[11px] text-gray-500 shrink-0">
                              {formatTime(p.created_at, locale)}
                            </time>
                          </div>
                          {canDelete(p) && (
                            <button
                              type="button"
                              onClick={() => void onDelete(p.id)}
                              disabled={deleting === p.id}
                              className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer"
                              title={t("catalog.remove")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <MarkdownRenderer content={p.body} compact />

                        {p.entity_id && (
                          <Link
                            href={`/catalog/${p.entity_id}`}
                            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline break-all"
                          >
                            <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{p.entity_title || t("community.feedLinkedEntity")}</span>
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function CommunityPage() {
  return (
    <CatalogProvider>
      <Suspense
        fallback={
          <div className="min-h-screen bg-background grid place-items-center text-xs font-mono text-gray-500">
            Loading...
          </div>
        }
      >
        <CommunityFeed />
      </Suspense>
    </CatalogProvider>
  );
}
