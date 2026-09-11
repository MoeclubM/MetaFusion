"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { CatalogProvider, useCatalog } from "@/components/catalog/CatalogProvider";
import { fetchApi } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { FORUM_SERVICE_URL } from "@/lib/services";
import { UserAvatar } from "@/components/UserAvatar";
import { MessageSquare, MessageCircle, ArrowLeft, Loader2, Info } from "lucide-react";

// Markdown 渲染依赖 katex/highlight.js（数百 KB），按需加载。
const MarkdownRenderer = dynamic(() => import("@/components/MarkdownRenderer"), {
  loading: () => <div className="h-4 my-1.5 rounded bg-black/[0.04] dark:bg-white/[0.04] animate-pulse" />,
});

// 外部论坛已配置时，主题详情由外部系统承载。
const FORUM_IS_EXTERNAL = FORUM_SERVICE_URL.startsWith("http");

type PostDetail = {
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

function PostDetailInner() {
  const { t, locale } = useI18n();
  const params = useParams();
  const router = useRouter();
  const { modules } = useCatalog();
  const id = (params?.id as string) || "";

  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const communityEnabled = modules.some(
    (m) => m.id === "community" && m.enabled && m.healthy,
  );
  const modulesResolved = modules.length > 0;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    try {
      const r = await fetchApi<PostDetail>(`/community/posts/${id}`);
      setPost(r);
    } catch {
      // 该 id 可能是实体 id（历史链接形如 /community/<entity>）：转到该条目的讨论。
      try {
        const feed = await fetchApi<{ items: PostDetail[] }>(
          `/community/feed?entity_id=${encodeURIComponent(id)}&limit=1`,
        );
        if ((feed.items || []).length > 0) {
          router.replace(`/community?entity_id=${encodeURIComponent(id)}`);
          return;
        }
      } catch {
        /* ignore, 走未找到分支 */
      }
      setPost(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (FORUM_IS_EXTERNAL) return;
    if (!modulesResolved || !communityEnabled) {
      setLoading(false);
      return;
    }
    void load();
  }, [modulesResolved, communityEnabled, load]);

  useEffect(() => {
    if (FORUM_IS_EXTERNAL) window.location.replace(FORUM_SERVICE_URL);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8 space-y-5">
        <Link
          href="/community"
          className="inline-flex items-center gap-1.5 text-xs font-mono text-gray-500 hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t("community.backToFeed")}</span>
        </Link>

        {!modulesResolved || loading ? (
          <div className="grid place-items-center py-16 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !communityEnabled ? (
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-surface p-8 text-center space-y-3">
            <Info className="w-6 h-6 text-amber-400 mx-auto" />
            <p className="text-sm text-gray-400">{t("community.moduleDisabled")}</p>
          </div>
        ) : notFound || !post ? (
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-surface p-10 text-center space-y-3">
            <MessageSquare className="w-7 h-7 text-gray-600 mx-auto" />
            <p className="text-sm text-gray-400">{t("community.postNotFound")}</p>
            <Link href="/community" className="text-xs font-mono text-primary hover:underline">
              {t("community.backToFeed")}
            </Link>
          </div>
        ) : (
          <article className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <UserAvatar user={{ username: post.author_name }} size="md" />
              <div className="min-w-0">
                <div className="font-semibold text-sm text-gray-800 dark:text-gray-200 truncate">
                  {post.author_name}
                </div>
                <time className="font-mono text-[11px] text-gray-500">
                  {formatTime(post.created_at, locale)}
                </time>
              </div>
            </div>

            <MarkdownRenderer content={post.body} />

            {post.entity_id && (
              <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.06] flex flex-wrap items-center gap-3">
                <Link
                  href={`/catalog/${post.entity_id}`}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline break-all"
                >
                  <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{post.entity_title || t("community.feedLinkedEntity")}</span>
                </Link>
                <Link
                  href={`/community?entity_id=${encodeURIComponent(post.entity_id)}`}
                  className="text-xs font-mono text-gray-500 hover:text-primary transition-colors"
                >
                  {t("community.viewEntityDiscussion")}
                </Link>
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  );
}

export default function PostDetailPage() {
  return (
    <CatalogProvider>
      <PostDetailInner />
    </CatalogProvider>
  );
}
