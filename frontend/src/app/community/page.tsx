"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { CatalogProvider, useCatalog } from "@/components/catalog/CatalogProvider";
import { api } from "@/components/catalog/api";
import { useI18n } from "@/i18n/I18nProvider";
import { FORUM_SERVICE_URL } from "@/lib/services";
import { MessageSquare, Info, Loader2, MessageCircle } from "lucide-react";

// 配置了独立论坛服务（http 地址）时，社区由外部系统承载，直接跳转；
// 未配置时使用本仓库后端的社区模块（短评讨论流）。
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
  const searchParams = useSearchParams();
  const entityFilter = searchParams.get("entity_id") || "";

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const communityEnabled = modules.some(
    (m) => m.id === "community" && m.enabled && m.healthy,
  );
  // modules 未加载完成时不闪现"未开放"，加载后再按开关决定。
  const modulesResolved = modules.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api<{ items: FeedItem[] }>("/community/feed");
      const list = r.items || [];
      setItems(
        entityFilter ? list.filter((x) => x.entity_id === entityFilter) : list,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [entityFilter]);

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

  const title = entityFilter
    ? items[0]?.entity_title || t("community.feedLinkedEntity")
    : t("navigation.community");

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-10 space-y-6">
        <header className="space-y-1.5">
          <h1 className="font-display text-xl font-bold flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-500" strokeWidth={1.75} />
            {title}
          </h1>
          <p className="text-sm text-gray-500">{t("community.feedSubtitle")}</p>
        </header>

        {!modulesResolved || loading ? (
          <div className="grid place-items-center py-16 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !communityEnabled ? (
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-surface p-8 text-center space-y-3">
            <Info className="w-6 h-6 text-amber-400 mx-auto" />
            <p className="text-sm text-gray-400">{t("community.moduleDisabled")}</p>
          </div>
        ) : error ? (
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
                className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-gray-700 dark:text-gray-300 truncate">
                    {p.author_name}
                  </span>
                  <time className="font-mono text-gray-500 shrink-0">
                    {formatTime(p.created_at, locale)}
                  </time>
                </div>
                <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line break-words">
                  {p.body}
                </p>
                {p.entity_id && (
                  <Link
                    href={`/catalog/${p.entity_id}`}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline break-all"
                  >
                    <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {p.entity_title || t("community.feedLinkedEntity")}
                    </span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
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
