"use client";

import { useI18n } from "@/i18n/I18nProvider";
import Link from "next/link";
import { Music2, Clock, Trash2, ExternalLink } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function ExpressionsTab({
  loading,
  filteredExpressions,
  worksList,
  handleDeleteExpression,
}: Pick<AdminDashboard, "loading" | "filteredExpressions" | "worksList" | "handleDeleteExpression">) {
  const { t } = useI18n();

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl bg-[#111115] border border-white/[0.08]">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Music2 className="w-5 h-5 text-purple-400" />
            {t("admin.expressions.title")}
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {t("admin.expressions.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-xs text-gray-400 px-3 py-1 rounded-full bg-white/[0.04] border border-white/10">
            {t("admin.expressions.count", { count: filteredExpressions.length })}
          </span>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#111115] overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.02] text-gray-400 border-b border-white/[0.08] text-[11px] font-mono">
            <tr>
              <th className="py-3.5 px-4 font-semibold">{t("admin.expressions.colTitle")}</th>
              <th className="py-3.5 px-3 font-semibold">{t("admin.expressions.colWork")}</th>
              <th className="py-3.5 px-3 font-semibold">{t("admin.expressions.colIsrc")}</th>
              <th className="py-3.5 px-3 font-semibold">{t("admin.expressions.colDuration")}</th>
              <th className="py-3.5 px-4 text-right font-semibold">{t("admin.expressions.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-16 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : filteredExpressions.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center text-gray-500 font-mono">
                  {t("admin.expressions.noData")}
                </td>
              </tr>
            ) : (
              filteredExpressions.map((entry) => (
                <tr key={entry.id} className="hover:bg-white/[0.02] transition-colors group">
                  {/* Track / Recording Title */}
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-white group-hover:text-purple-300 transition-colors">
                      {entry.title}
                    </div>
                    {entry.artist_credit && (
                      <div className="text-[11px] text-gray-400 mt-0.5 font-mono">
                        {entry.artist_credit}
                      </div>
                    )}
                  </td>

                  {/* Associated Work */}
                  <td className="py-3.5 px-3">
                    {entry.work_id ? (
                      <Link
                        href={`/works/${entry.work_id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 font-medium hover:underline text-xs"
                      >
                        <span className="line-clamp-1 max-w-[200px]">
                          {worksList.find((w) => w.id === entry.work_id)?.title || entry.work_id}
                        </span>
                        <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                      </Link>
                    ) : (
                      <span className="text-gray-600 font-mono">—</span>
                    )}
                  </td>

                  {/* ISRC / Code */}
                  <td className="py-3.5 px-3 font-mono text-gray-400 text-[11px]">
                    {entry.isrc || entry.isbn ? (
                      <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                        {entry.isrc || entry.isbn}
                      </span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>

                  {/* Duration */}
                  <td className="py-3.5 px-3 font-mono text-gray-300 text-[11px]">
                    {entry.duration_seconds || entry.duration ? (
                      <span className="inline-flex items-center gap-1 text-gray-400">
                        <Clock className="w-3 h-3 text-gray-500" />
                        {Math.floor((entry.duration_seconds || entry.duration || 0) / 60)}:
                        {String((entry.duration_seconds || entry.duration || 0) % 60).padStart(2, "0")}
                      </span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>

                  {/* Action */}
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => handleDeleteExpression(entry.id, entry.title)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs hover:bg-rose-500/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{t("admin.expressions.delete")}</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
