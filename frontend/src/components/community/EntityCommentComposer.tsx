"use client";

// 条目短评发布器：详情页「评论」分节里的写入口。
//
// 之所以单独成组件：这条入口原本只挂在通用详情视图（frontend/src/components/catalog/
// EntityDetailView.tsx 的 community 分节）里，而 /works、/releases、/mediums 这些正式
// 路由各有自己的页面组件；/catalog/[id] 又会把带正式路由的 kind 重定向走（见
// frontend/src/lib/entityRoutes.ts）。结果正式路由上的评论分节只有一张列表和一个
// 「查看全部评论」链接——文案却写着「欢迎在下方发表」，用户找不到输入框（线上审计
// docs-local/audit-2026-09-19/live-ui-forms.md #3）。
//
// 权限：服务端按 community.post.create 判定（metafusion-community 的 POST
// /api/community/entities/:id/posts），这里只负责把"没登录"提前说清楚并给登录出口，
// 真正授权仍以服务端为准（403 会走下面的错误映射）。

import React, { useState } from "react";
import { AlertCircle, LogIn, Send } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { createEntityComment, fetchEntityPosts } from "@/lib/api";
import { localizeCommunityError } from "@/lib/communityErrors";
import { getAuthLoginUrl } from "@/lib/services";

/** 与互动服务 community.go 的请求体上限一致（len(body) > 20000 直接拒收）。 */
const MAX_BODY = 20000;

export function EntityCommentComposer({
  entityId,
  onPosted,
}: {
  entityId: string;
  /** 发布成功后的回调：调用方据此把新评论并进列表（id/时间一律用服务端返回值，不伪造）。 */
  onPosted?: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || submitting) return;
    if (!user) {
      // 未登录不该走到这里（按钮此时是登录链接），留一道兜底不外泄。
      window.location.href = getAuthLoginUrl(window.location.href);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const created = await createEntityComment(entityId, text);
      // 2xx 但响应没带 item：回读服务端列表，绝不在这里自造一条评论——
      // 伪 id/伪时间会让人以为已经落库，刷新后凭空消失。
      if (!created) await fetchEntityPosts(entityId);
      setBody("");
      await onPosted?.();
    } catch (err: any) {
      setError(localizeCommunityError(String(err?.message || ""), t) || t("community.error.postFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card tone="subtle" padding="card" className="space-y-3">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs text-text-faint">
          <label htmlFor="entity-comment-body" className="font-medium text-text-body font-mono cursor-pointer">
            {t("entity.page.quickReview")}
          </label>
          <span className="font-mono text-[11px] truncate">
            {user ? (
              <span className="text-emerald-600 dark:text-success font-semibold">@{user.username}</span>
            ) : (
              <a href={getAuthLoginUrl()} className="text-primary hover:underline font-medium">
                {t("entity.page.signInToComment")}
              </a>
            )}
          </span>
        </div>
        <textarea
          id="entity-comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            user
              ? t("entity.page.commentPlaceholderAuthed")
              : t("entity.page.commentPlaceholderGuest")
          }
          aria-describedby="entity-comment-hint"
          aria-invalid={error ? true : undefined}
          disabled={!user || submitting}
          maxLength={MAX_BODY}
          rows={3}
          className="w-full p-3 rounded-lg bg-surface border border-line text-xs sm:text-sm text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 resize-y"
        />
        {error && (
          <p role="alert" className="text-xs text-rose-500 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span id="entity-comment-hint" className="text-[11px] text-text-muted">
            {t("entity.page.syncNotice")}
          </span>
          {user ? (
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50 cursor-pointer mf-focus"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? t("entity.page.posting") : t("entity.page.postComment")}</span>
            </button>
          ) : (
            <a
              href={getAuthLoginUrl()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-all duration-base ease-soft mf-focus"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{t("entity.page.sendAfterLogin")}</span>
            </a>
          )}
        </div>
      </form>
    </Card>
  );
}
