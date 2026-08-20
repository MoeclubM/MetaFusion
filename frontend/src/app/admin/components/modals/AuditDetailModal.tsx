"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ScrollText, Clock, UserCheck, Shield } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { AdminAuditLog } from "@/lib/api";

interface AuditDetailModalProps {
  open: boolean;
  onClose: () => void;
  log: AdminAuditLog | null;
}

export function AuditDetailModal({ open, onClose, log }: AuditDetailModalProps) {
  const { t } = useI18n();

  if (!log) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("admin.audit.detailTitle")}
      icon={<ScrollText className="w-4 h-4 text-amber-400" />}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4 text-xs">
        {/* Info badges */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-amber-300 text-sm">{log.action}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.06] border border-white/10 text-gray-300">
              {log.actor_role}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 font-mono text-[11px]">
            <div>
              <span className="text-gray-500 block text-[10px]">Target Type / ID</span>
              <span className="text-gray-300 break-all">{log.target_type} : {log.target_id || "—"}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[10px]">Client IP</span>
              <span className="text-gray-300">{log.ip || "127.0.0.1"}</span>
            </div>
          </div>

          <div className="text-[10px] text-gray-500 font-mono flex items-center gap-1 pt-1">
            <Clock className="w-3 h-3" />
            <span>{new Date(log.created_at).toLocaleString()}</span>
          </div>
        </div>

        {/* Payload Diff */}
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-gray-400">{t("admin.audit.payload")}</div>
          <div className="p-3 rounded-xl bg-[#0d0d11] border border-white/10 overflow-x-auto max-h-60">
            <pre className="font-mono text-[11px] text-sky-300 leading-relaxed">
              {log.detail && Object.keys(log.detail).length > 0
                ? JSON.stringify(log.detail, null, 2)
                : "{ /* No detail payload */ }"}
            </pre>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-gray-300 hover:text-white"
          >
            {t("admin.audit.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
