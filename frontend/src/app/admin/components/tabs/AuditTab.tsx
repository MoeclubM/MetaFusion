"use client";

import React, { useState, useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ScrollText, Search, ChevronDown, ChevronRight, Code2, User, Globe } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function AuditTab({ auditLogs }: Pick<AdminDashboard, "auditLogs">) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [targetFilter, setTargetFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const targetTypes = useMemo(() => {
    const set = new Set<string>();
    auditLogs.forEach((log) => {
      if (log.target_type) set.add(log.target_type);
    });
    return Array.from(set).sort();
  }, [auditLogs]);

  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      if (targetFilter !== "all" && log.target_type !== targetFilter) {
        return false;
      }
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        log.action?.toLowerCase().includes(q) ||
        log.target_type?.toLowerCase().includes(q) ||
        log.target_id?.toLowerCase().includes(q) ||
        log.ip?.toLowerCase().includes(q) ||
        log.actor_role?.toLowerCase().includes(q) ||
        JSON.stringify(log.detail || {}).toLowerCase().includes(q)
      );
    });
  }, [auditLogs, targetFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-amber-400" />
            {t("admin.audit.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.audit.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("admin.audit.searchPlaceholder")}
              className="pl-8 pr-3 py-1.5 rounded-lg bg-surface border border-surfaceBorder text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-amber-400/50 w-48 sm:w-64"
            />
          </div>
          {targetTypes.length > 0 && (
            <select
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value)}
              className="py-1.5 px-3 rounded-lg bg-surface border border-surfaceBorder text-xs text-gray-200 font-mono focus:outline-none focus:border-amber-400/50"
            >
              <option value="all">{t("admin.audit.filterTargetAll")}</option>
              {targetTypes.map((tt) => (
                <option key={tt} value={tt}>
                  {tt}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4 w-8"></th>
              <th className="py-3 px-4">{t("admin.audit.colAction")}</th>
              <th className="py-3 px-3">{t("admin.audit.colTarget")}</th>
              <th className="py-3 px-3">{t("admin.audit.colRole")}</th>
              <th className="py-3 px-3">{t("admin.audit.colIp")}</th>
              <th className="py-3 px-4 text-right">{t("admin.audit.colTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.audit.noData")}
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                const isExpanded = expandedId === log.id;
                return (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 text-gray-500">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-amber-400" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-amber-300">
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px]">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-gray-300">
                        <span className="text-gray-200">{log.target_type}</span>
                        {log.target_id && (
                          <span className="text-gray-500 ml-1.5 text-[11px]">({log.target_id.slice(0, 8)}…)</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-gray-400">
                        <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/10 text-[10px]">
                          {log.actor_role}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-gray-400 text-[11px]">{log.ip || "—"}</td>
                      <td className="py-3 px-4 text-right font-mono text-gray-400 text-[11px]">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-background/40">
                        <td colSpan={6} className="px-6 py-4 border-t border-surfaceBorder/40">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-gray-400">
                              {log.actor_id && (
                                <div className="flex items-center gap-1.5">
                                  <User className="w-3.5 h-3.5 text-amber-400" />
                                  <span>{t("admin.audit.actorId")}:</span>
                                  <span className="text-gray-200">{log.actor_id}</span>
                                </div>
                              )}
                              {log.user_agent && (
                                <div className="flex items-center gap-1.5">
                                  <Globe className="w-3.5 h-3.5 text-sky-400" />
                                  <span>{t("admin.audit.userAgent")}:</span>
                                  <span className="text-gray-300 truncate max-w-md">{log.user_agent}</span>
                                </div>
                              )}
                            </div>
                            {log.detail && Object.keys(log.detail).length > 0 && (
                              <div>
                                <div className="text-[11px] font-mono text-gray-400 mb-1.5 flex items-center gap-1.5">
                                  <Code2 className="w-3.5 h-3.5 text-amber-400" />
                                  <span>{t("admin.audit.detailTitle")}</span>
                                </div>
                                <pre className="p-3 rounded-lg bg-black/60 border border-white/[0.06] font-mono text-[11px] text-gray-300 overflow-x-auto max-h-60">
                                  {JSON.stringify(log.detail, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
