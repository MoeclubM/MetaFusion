"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { HardDrive, AlertCircle, CheckCircle2, Clock, XCircle, Copy, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { AssetFile } from "@/lib/api";
import { formatBytes } from "../types";

interface AssetDetailModalProps {
  open: boolean;
  onClose: () => void;
  asset: AssetFile | null;
}

export function AssetDetailModal({ open, onClose, asset }: AssetDetailModalProps) {
  const { t } = useI18n();
  const [copiedSha, setCopiedSha] = React.useState(false);

  if (!asset) return null;

  const copySha = () => {
    if (asset.sha256_hash) {
      navigator.clipboard.writeText(asset.sha256_hash);
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("admin.assets.detailTitle")}
      icon={<HardDrive className="w-4 h-4 text-emerald-400" />}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        {/* Top summary card */}
        <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-white break-all">{asset.file_name}</div>
              <div className="text-[11px] text-gray-400 font-mono mt-0.5">{asset.mime_type || "application/octet-stream"}</div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-mono border inline-flex items-center gap-1.5 shrink-0 ${
                asset.transcode_status === "completed"
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : asset.transcode_status === "failed"
                  ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                  : asset.transcode_status === "processing"
                  ? "bg-sky-500/15 border-sky-500/40 text-sky-300"
                  : "bg-amber-500/15 border-amber-500/40 text-amber-300"
              }`}
            >
              {asset.transcode_status === "completed" && <CheckCircle2 className="w-3.5 h-3.5" />}
              {asset.transcode_status === "failed" && <XCircle className="w-3.5 h-3.5" />}
              {asset.transcode_status === "processing" && <Clock className="w-3.5 h-3.5 animate-spin" />}
              {asset.transcode_status === "pending" && <Clock className="w-3.5 h-3.5" />}
              <span>{asset.transcode_status}</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-white/5 font-mono text-[11px]">
            <div>
              <span className="text-gray-500 block text-[10px]">{t("admin.assets.colRole")}</span>
              <span className="text-gray-300">{asset.file_role}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[10px]">{t("admin.assets.colSize")}</span>
              <span className="text-amber-400">{formatBytes(asset.file_size)}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[10px]">Asset ID</span>
              <span className="text-gray-400">{asset.id?.slice(0, 8)}...</span>
            </div>
          </div>
        </div>

        {/* S3 Storage location */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
          <div className="text-[10px] font-mono text-gray-500">{t("admin.assets.s3Location")}</div>
          <div className="font-mono text-[11px] text-gray-300 break-all select-all">
            s3://{asset.s3_bucket}/{asset.s3_key}
          </div>
        </div>

        {/* SHA-256 Hash */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-gray-500">SHA-256 Checksum</span>
            <button
              type="button"
              onClick={copySha}
              className="text-[10px] font-mono text-gray-400 hover:text-white inline-flex items-center gap-1"
            >
              {copiedSha ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedSha ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <div className="font-mono text-[11px] text-amber-300 break-all select-all">
            {asset.sha256_hash || "—"}
          </div>
        </div>

        {/* Transcode Error (if any) */}
        {asset.transcode_error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-xs">
              <AlertCircle className="w-4 h-4" />
              <span>{t("admin.assets.transcodeError")}</span>
            </div>
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-rose-200/90 leading-relaxed bg-black/30 p-2 rounded-lg">
              {asset.transcode_error}
            </pre>
          </div>
        )}

        {/* Technical Specs JSON */}
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-gray-400">{t("admin.assets.techSpecs")}</div>
          <div className="p-3 rounded-xl bg-[#0d0d11] border border-white/10 overflow-x-auto max-h-48">
            <pre className="font-mono text-[11px] text-emerald-300 leading-relaxed">
              {asset.technical_specs && Object.keys(asset.technical_specs).length > 0
                ? JSON.stringify(asset.technical_specs, null, 2)
                : "{ /* No technical specs recorded */ }"}
            </pre>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-gray-300 hover:text-white"
          >
            {t("admin.assets.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
