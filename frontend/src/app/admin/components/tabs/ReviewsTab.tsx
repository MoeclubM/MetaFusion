"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { isDistinctOriginalTitle } from "@/lib/titles";

import Link from "next/link";
import { ShieldCheck, Check, X, Eye } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function ReviewsTab({
  loading,
  filteredReviewWorks,
  pendingReviewsCount,
  reviewFilter,
  setReviewFilter,
  reviewingId,
  handleApproveWork,
  handleRejectWork,
}: Pick<
  AdminDashboard,
  | "loading"
  | "filteredReviewWorks"
  | "pendingReviewsCount"
  | "reviewFilter"
  | "setReviewFilter"
  | "reviewingId"
  | "handleApproveWork"
  | "handleRejectWork"
>) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-rose-400" />
            {t("admin.reviews.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
            {t("admin.reviews.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-surface border border-surfaceBorder rounded-lg p-1 text-xs font-mono">
          <button
            onClick={() => setReviewFilter("pending_review")}
            className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
              reviewFilter === "pending_review"
                ? "bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <span>{t("admin.reviews.pending")}</span>
            {pendingReviewsCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] grid place-items-center font-bold">
                {pendingReviewsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setReviewFilter("published")}
            className={`px-2.5 py-1 rounded transition-colors ${
              reviewFilter === "published"
                ? "bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t("admin.reviews.published")}
          </button>
          <button
            onClick={() => setReviewFilter("rejected")}
            className={`px-2.5 py-1 rounded transition-colors ${
              reviewFilter === "rejected"
                ? "bg-gray-500/20 text-gray-300 font-semibold border border-gray-500/30"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t("admin.reviews.rejected")}
          </button>
          <button
            onClick={() => setReviewFilter("all")}
            className={`px-2.5 py-1 rounded transition-colors ${
              reviewFilter === "all"
                ? "bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t("admin.reviews.all")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.reviews.colTitle")}</th>
              <th className="py-3 px-3">{t("admin.reviews.colCreator")}</th>
              <th className="py-3 px-3">{t("admin.reviews.colTags")}</th>
              <th className="py-3 px-3">{t("admin.reviews.colDate")}</th>
              <th className="py-3 px-3">{t("admin.reviews.colStatus")}</th>
              <th className="py-3 px-4 text-right">{t("admin.reviews.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : filteredReviewWorks.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.reviews.noEntries")}
                </td>
              </tr>
            ) : (
              filteredReviewWorks.map((work) => {
                const isPending = work.status === "pending_review";
                const isPublished = work.status === "published" || work.status === "completed";
                const isRejected = work.status === "rejected";
                return (
                  <tr key={work.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{work.title}</div>
                      {isDistinctOriginalTitle(work.original_title, work.title) && (
                        <div className="text-[11px] text-gray-400 mt-0.5">{work.original_title}</div>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-300">{work.creator?.username || "—"}</td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {work.tags && work.tags.length > 0 ? (
                          work.tags.map((t) => (
                            <span
                              key={t.id}
                              className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-mono"
                            >
                              #{t.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500 font-mono text-[10px]">{t("admin.reviews.noTags")}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-400 text-[11px]">
                      {work.created_at ? new Date(work.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3 px-3">
                      {isPending && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1 w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                          {t("admin.reviews.pending")}
                        </span>
                      )}
                      {isPublished && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 w-fit block">
                          {t("admin.reviews.published")}
                        </span>
                      )}
                      {isRejected && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-gray-500/15 text-gray-400 border border-gray-500/30 w-fit block">
                          {t("admin.reviews.rejected")}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isPending ? (
                          <>
                            <button
                              disabled={reviewingId === work.id}
                              onClick={() => handleApproveWork(work.id)}
                              className="px-2.5 py-1 rounded bg-emerald-500 text-black font-semibold text-xs hover:bg-emerald-400 transition-colors flex items-center gap-1 shadow-sm"
                            >
                              <Check className="w-3 h-3" />
                              <span>{t("admin.reviews.approve")}</span>
                            </button>
                            <button
                              disabled={reviewingId === work.id}
                              onClick={() => handleRejectWork(work.id)}
                              className="px-2.5 py-1 rounded bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs hover:bg-rose-500/30 transition-colors flex items-center gap-1"
                            >
                              <X className="w-3 h-3" />
                              <span>{t("admin.reviews.reject")}</span>
                            </button>
                          </>
                        ) : isRejected ? (
                          <button
                            disabled={reviewingId === work.id}
                            onClick={() => handleApproveWork(work.id)}
                            className="px-2.5 py-1 rounded bg-white/[0.06] border border-white/10 text-gray-300 hover:text-white text-xs"
                          >
                            {t("admin.reviews.reapprove")}
                          </button>
                        ) : null}

                        <Link
                          href={`/works/${work.id}`}
                          target="_blank"
                          className="px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white text-xs inline-flex items-center gap-1"
                          title={t("admin.reviews.previewTitle")}
                        >
                          <Eye className="w-3 h-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
