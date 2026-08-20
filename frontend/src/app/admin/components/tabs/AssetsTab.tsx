"use client";

import { useI18n } from "@/i18n/I18nProvider";

import { HardDrive, RefreshCw } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";
import { formatBytes } from "../types";

export function AssetsTab({
  loading,
  filteredAssets,
  handleRetryAsset,
}: Pick<AdminDashboard, "loading" | "filteredAssets" | "handleRetryAsset">) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            {t("admin.assets.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
            {t("admin.assets.subtitle")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.assets.colFile")}</th>
              <th className="py-3 px-3">{t("admin.assets.colRole")}</th>
              <th className="py-3 px-3">{t("admin.assets.colSize")}</th>
              <th className="py-3 px-3">{t("admin.assets.colSha")}</th>
              <th className="py-3 px-3">{t("admin.assets.colTranscode")}</th>
              <th className="py-3 px-4 text-right">{t("admin.assets.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : filteredAssets.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.assets.noData")}
                </td>
              </tr>
            ) : (
              filteredAssets.map((asset) => (
                <tr key={asset.id} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white">{asset.file_name}</div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                      {asset.s3_bucket}/{asset.s3_key}
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-gray-300 text-[11px]">{asset.file_role}</td>
                  <td className="py-3 px-3 font-mono text-amber-400 text-[11px]">{formatBytes(asset.file_size)}</td>
                  <td className="py-3 px-3 font-mono text-gray-400 text-[10px] max-w-xs truncate">{asset.sha256_hash}</td>
                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                        asset.transcode_status === "completed"
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                          : asset.transcode_status === "failed"
                          ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                          : "bg-amber-500/15 border-amber-500/40 text-amber-300"
                      }`}
                    >
                      {asset.transcode_status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {asset.transcode_status === "failed" && (
                      <button
                        onClick={() => handleRetryAsset(asset.id)}
                        className="px-2.5 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs inline-flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>{t("admin.assets.retry")}</span>
                      </button>
                    )}
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
