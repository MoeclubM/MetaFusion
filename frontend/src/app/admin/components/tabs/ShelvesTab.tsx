"use client";

import { useI18n } from "@/i18n/I18nProvider";

import Link from "next/link";
import { Layers, Plus, Eye, Edit2, Trash2 } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function ShelvesTab({
  loading,
  filteredShelves,
  handleOpenCreateShelf,
  handleOpenEditShelf,
  handleDeleteShelf,
}: Pick<AdminDashboard, "loading" | "filteredShelves" | "handleOpenCreateShelf" | "handleOpenEditShelf" | "handleDeleteShelf">) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            {t("admin.shelves.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
            {t("admin.shelves.subtitle")}
          </p>
        </div>
        <button
          onClick={handleOpenCreateShelf}
          className="px-3 py-1.5 rounded-lg bg-emerald-400 text-black text-xs font-semibold hover:bg-emerald-300 transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("admin.shelves.new")}</span>
        </button>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.shelves.colSlug")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colNameZh")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colNameEn")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colQuery")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colMatch")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colOrder")}</th>
              <th className="py-3 px-4 text-right">{t("admin.shelves.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : filteredShelves.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.shelves.noData")}
                </td>
              </tr>
            ) : (
              filteredShelves.map((shelf) => (
                <tr key={shelf.id || shelf.slug} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-4 font-mono text-emerald-300 font-bold">{shelf.slug}</td>
                  <td className="py-3 px-3 font-semibold text-white">{shelf.name_zh}</td>
                  <td className="py-3 px-3 font-mono text-gray-400 text-[11px]">{shelf.name_en || "—"}</td>
                  <td className="py-3 px-3">
                    <div className="flex flex-wrap gap-1 max-w-sm">
                      {shelf.query_tags && shelf.query_tags.length > 0 ? (
                        shelf.query_tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-mono"
                          >
                            #{tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-500 font-mono text-[10px]">{t("admin.shelves.allWorks")}</span>
                      )}
                      {shelf.exclude_tags && shelf.exclude_tags.length > 0 && (
                        <span className="text-[10px] font-mono text-rose-400">{t("admin.shelves.exclude", { tags: shelf.exclude_tags.map((tag) => `#${tag}`).join(",") })}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-[11px]">
                    {shelf.require_all_tags ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px]">{t("admin.shelves.and")}</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px]">{t("admin.shelves.or")}</span>
                    )}
                  </td>
                  <td className="py-3 px-3 font-mono text-gray-400">{shelf.sort_order ?? 0}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        href={`/explore?shelf=${shelf.slug}`}
                        target="_blank"
                        className="px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white text-xs inline-flex items-center gap-1"
                        title={t("admin.shelves.viewShelf")}
                      >
                        <Eye className="w-3 h-3" />
                      </Link>
                      <button
                        onClick={() => handleOpenEditShelf(shelf)}
                        className="px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white text-xs inline-flex items-center gap-1"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDeleteShelf(shelf.slug)}
                        className="px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 text-xs inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
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
