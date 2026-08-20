"use client";

import { useI18n } from "@/i18n/I18nProvider";

import React from "react";
import { Disc3, ChevronRight, ChevronDown } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function ReleasesTab({
  loading,
  filteredReleases,
  expandedReleaseId,
  setExpandedReleaseId,
  verifyingReleaseId,
  handleToggleVerification,
}: Pick<
  AdminDashboard,
  "loading" | "filteredReleases" | "expandedReleaseId" | "setExpandedReleaseId" | "verifyingReleaseId" | "handleToggleVerification"
>) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Disc3 className="w-4 h-4 text-sky-400" />
            {t("admin.releases.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
            {t("admin.releases.subtitle")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.releases.colName")}</th>
              <th className="py-3 px-3">{t("admin.releases.colWork")}</th>
              <th className="py-3 px-3">{t("admin.releases.colPublisher")}</th>
              <th className="py-3 px-3">{t("admin.releases.colMediums")}</th>
              <th className="py-3 px-3">{t("admin.releases.colVerify")}</th>
              <th className="py-3 px-4 text-right">{t("admin.releases.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : filteredReleases.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.releases.noData")}
                </td>
              </tr>
            ) : (
              filteredReleases.map((release) => (
                <React.Fragment key={release.id}>
                  <tr className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{release.edition_name}</div>
                      {release.packaging && <div className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.releases.packaging", { value: release.packaging })}</div>}
                    </td>
                    <td className="py-3 px-3 text-sky-400 font-mono">{release.work ? release.work.title : "—"}</td>
                    <td className="py-3 px-3 font-mono text-gray-400 text-[11px]">
                      <div>{release.publisher || release.publisher_entity?.name || "—"}</div>
                      {release.catalog_number && <div className="text-gray-400">{release.catalog_number}</div>}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-400 text-[11px]">
                      {release.mediums?.length ? t("admin.releases.discs", { count: release.mediums.length }) : "—"}
                    </td>
                    <td className="py-3 px-3">
                      <button
                        disabled={verifyingReleaseId === release.id}
                        onClick={() => handleToggleVerification(release.id, release.is_master_verified)}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
                          release.is_master_verified
                            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25"
                            : "bg-white/[0.04] border-white/10 text-gray-400 hover:text-white"
                        }`}
                      >
                        {release.is_master_verified ? t("admin.releases.verified") : t("admin.releases.unverified")}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setExpandedReleaseId(expandedReleaseId === release.id ? null : release.id)}
                        className="px-2.5 py-1 rounded bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white text-xs inline-flex items-center gap-1"
                      >
                        {expandedReleaseId === release.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <span>{t("admin.releases.detailButton")}</span>
                      </button>
                    </td>
                  </tr>
                  {expandedReleaseId === release.id && (
                    <tr>
                      <td colSpan={6} className="bg-black/30 p-4 border-y border-white/[0.06]">
                        <div className="space-y-3">
                          <div className="text-xs font-semibold text-gray-300 font-mono">{t("admin.releases.detailTitle")}</div>
                          {release.mediums && release.mediums.length > 0 ? (
                            <div className="space-y-2">
                              {release.mediums.map((m) => (
                                <div key={m.id} className="p-3 rounded-lg bg-surface border border-surfaceBorder text-xs space-y-2">
                                  <div className="font-semibold text-white flex items-center justify-between">
                                    <span>
                                      Disc {m.position}: {m.name} ({m.format})
                                    </span>
                                    <span className="font-mono text-gray-400">{t("admin.releases.tracks", { count: m.tracks?.length || 0 })}</span>
                                  </div>
                                  {m.tracks && m.tracks.length > 0 && (
                                    <div className="divide-y divide-white/[0.04] font-mono text-[11px]">
                                      {m.tracks.map((t) => (
                                        <div key={t.id} className="py-1 flex items-center justify-between text-gray-400">
                                          <span>
                                            {String(t.position).padStart(2, "0")}. {t.title}
                                          </span>
                                          <span>
                                            {t.duration_seconds
                                              ? `${Math.floor(t.duration_seconds / 60)}:${String(t.duration_seconds % 60).padStart(2, "0")}`
                                              : ""}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-gray-500 text-xs">{t("admin.releases.noMediums")}</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
