"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { isDistinctOriginalTitle } from "@/lib/titles";

import Link from "next/link";
import { Library, Eye } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function WorksTab({
  loading,
  filteredWorks,
}: Pick<AdminDashboard, "loading" | "filteredWorks">) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Library className="w-4 h-4 text-amber-400" />
            {t("admin.works.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
            {t("admin.works.subtitle")}
          </p>
        </div>
        <span className="text-[11px] font-mono text-gray-500 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10">{t("admin.works.readOnlyAudit")}</span>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.works.colTitle")}</th>
              <th className="py-3 px-3">{t("admin.reviews.colTags")}</th>
              <th className="py-3 px-3">{t("admin.works.colReleases")}</th>
              <th className="py-3 px-3">{t("admin.works.colMetadata")}</th>
              <th className="py-3 px-4 text-right">{t("admin.works.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : filteredWorks.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.works.noData")}
                </td>
              </tr>
            ) : (
              filteredWorks.map((work) => (
                <tr key={work.id} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white">{work.title}</div>
                    {isDistinctOriginalTitle(work.original_title, work.title) && (
                      <div className="text-[11px] text-gray-400 mt-0.5">{work.original_title}</div>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {work.tags && work.tags.length > 0 ? (
                        work.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-mono"
                          >
                            #{tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-500 font-mono text-[10px]">{t("admin.reviews.noTags")}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-amber-400">{t("admin.works.versions", { count: work.releases?.length ?? 0 })}</td>
                  <td className="py-3 px-3 font-mono text-gray-400 text-[11px] max-w-xs truncate">
                    {work.catalog_metadata && Object.keys(work.catalog_metadata).length > 0 ? JSON.stringify(work.catalog_metadata) : "—"}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Link
                      href={`/works/${work.id}`}
                      target="_blank"
                      className="px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white text-xs inline-flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      <span>{t("admin.works.viewFrontend")}</span>
                    </Link>
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
