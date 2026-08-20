"use client";

import { useI18n } from "@/i18n/I18nProvider";

import Link from "next/link";
import { Library, Eye } from "lucide-react";
import { categoryDisplayName } from "@/lib/api";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function WorksTab({
  loading,
  filteredWorks,
  locale,
}: Pick<AdminDashboard, "loading" | "filteredWorks" | "locale">) {
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
        <span className="text-[11px] font-mono text-gray-500 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10">只读审核</span>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.works.colTitle")}</th>
              <th className="py-3 px-3">{t("admin.works.colMedia")}</th>
              <th className="py-3 px-3">{t("admin.works.colCategory")}</th>
              <th className="py-3 px-3">{t("admin.works.colReleases")}</th>
              <th className="py-3 px-3">{t("admin.works.colMetadata")}</th>
              <th className="py-3 px-4 text-right">{t("admin.works.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : filteredWorks.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.works.noData")}
                </td>
              </tr>
            ) : (
              filteredWorks.map((work) => (
                <tr key={work.id} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white">{work.title}</div>
                    {work.original_title && <div className="text-[11px] text-gray-400 mt-0.5">{work.original_title}</div>}
                  </td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-white/[0.06] border border-white/10 text-gray-300 uppercase">
                      {work.media_type}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-gray-400 text-[11px]">
                    {work.category ? categoryDisplayName(work.category, locale) : work.category_code}
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
