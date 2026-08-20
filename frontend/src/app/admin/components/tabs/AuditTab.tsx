"use client";

import { useI18n } from "@/i18n/I18nProvider";

import { ScrollText } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function AuditTab({ auditLogs }: Pick<AdminDashboard, "auditLogs">) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-gray-400" />
            {t("admin.audit.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.audit.subtitle")}</p>
        </div>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.audit.colAction")}</th>
              <th className="py-3 px-3">{t("admin.audit.colTarget")}</th>
              <th className="py-3 px-3">{t("admin.audit.colRole")}</th>
              <th className="py-3 px-3">{t("admin.audit.colIp")}</th>
              <th className="py-3 px-4 text-right">{t("admin.audit.colTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {auditLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.audit.noData")}
                </td>
              </tr>
            ) : (
              auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-4 font-mono font-semibold text-amber-300">{log.action}</td>
                  <td className="py-3 px-3 font-mono text-gray-300">
                    {log.target_type} ({log.target_id?.slice(0, 8)}…)
                  </td>
                  <td className="py-3 px-3 font-mono text-gray-400">{log.actor_role}</td>
                  <td className="py-3 px-3 font-mono text-gray-400 text-[11px]">{log.ip || "—"}</td>
                  <td className="py-3 px-4 text-right font-mono text-gray-400 text-[11px]">{new Date(log.created_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
