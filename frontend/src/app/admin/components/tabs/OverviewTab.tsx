"use client";

import {
  LayoutDashboard,
  Library,
  Music2,
  Disc3,
  HardDrive,
  Users,
  MessageSquare,
  Sparkles,
  ScrollText,
  ShieldCheck,
  Plus,
  Inbox,
  Activity,
  ArrowRight,
  User,
  Clock,
} from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";
import { useI18n } from "@/i18n/I18nProvider";
import { formatBytes } from "../types";

export function OverviewTab({
  stats,
  worksList,
  expressionsList,
  releasesList,
  assetsList,
  artistsList,
  usersList,
  topicsList,
  auditLogs,
  setActiveTab,
}: Pick<
  AdminDashboard,
  | "stats"
  | "worksList"
  | "expressionsList"
  | "releasesList"
  | "assetsList"
  | "artistsList"
  | "usersList"
  | "topicsList"
  | "auditLogs"
  | "setActiveTab"
>) {
  const { t } = useI18n();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ── 1. Header Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-purple-500/5 to-transparent border border-white/[0.08]">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-amber-400" />
            {t("admin.overview.title")}
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {t("admin.overview.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setActiveTab("reviews")}
            className="px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-semibold flex items-center gap-1.5 transition-all shadow-soft active:scale-95"
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>{t("admin.overview.guide")}</span>
          </button>
          <button
            onClick={() => setActiveTab("works")}
            className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-white text-xs font-semibold border border-white/10 flex items-center gap-1.5 transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            <span>{t("admin.overview.newWork")}</span>
          </button>
        </div>
      </div>

      {/* ── 2. Primary 4 KPI Metrics Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Works */}
        <div
          onClick={() => setActiveTab("works")}
          className="p-5 rounded-2xl bg-[#111115] border border-white/[0.08] hover:border-amber-400/40 cursor-pointer transition-all space-y-3 group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">{t("admin.sidebar.itemWorks")}</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 grid place-items-center group-hover:scale-110 transition-transform">
              <Library className="w-4 h-4 text-amber-400" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-white font-mono tracking-tight">
            {stats?.total_works ?? worksList.length}
          </div>
          <div className="text-[11px] text-gray-500 flex items-center justify-between pt-1 border-t border-white/[0.04]">
            <span>{t("admin.overview.abstractWorkDesc")}</span>
            <ArrowRight className="w-3 h-3 text-gray-600 group-hover:text-amber-400 transition-colors" />
          </div>
        </div>

        {/* Total Releases */}
        <div
          onClick={() => setActiveTab("releases")}
          className="p-5 rounded-2xl bg-[#111115] border border-white/[0.08] hover:border-sky-400/40 cursor-pointer transition-all space-y-3 group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">{t("admin.sidebar.itemReleases")}</span>
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 grid place-items-center group-hover:scale-110 transition-transform">
              <Disc3 className="w-4 h-4 text-sky-400" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-white font-mono tracking-tight">
            {stats?.total_releases ?? releasesList.length}
          </div>
          <div className="text-[11px] text-gray-500 flex items-center justify-between pt-1 border-t border-white/[0.04]">
            <span>{t("admin.overview.manifestationDesc")}</span>
            <ArrowRight className="w-3 h-3 text-gray-600 group-hover:text-sky-400 transition-colors" />
          </div>
        </div>

        {/* Total Artists / Creators */}
        <div
          onClick={() => setActiveTab("artists")}
          className="p-5 rounded-2xl bg-[#111115] border border-white/[0.08] hover:border-purple-400/40 cursor-pointer transition-all space-y-3 group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">{t("admin.overview.agentsTitle")}</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 grid place-items-center group-hover:scale-110 transition-transform">
              <Users className="w-4 h-4 text-purple-400" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-white font-mono tracking-tight">
            {artistsList.length}
          </div>
          <div className="text-[11px] text-gray-500 flex items-center justify-between pt-1 border-t border-white/[0.04]">
            <span>{t("admin.overview.agentsDesc")}</span>
            <ArrowRight className="w-3 h-3 text-gray-600 group-hover:text-purple-400 transition-colors" />
          </div>
        </div>

        {/* Registered Users */}
        <div
          onClick={() => setActiveTab("users")}
          className="p-5 rounded-2xl bg-[#111115] border border-white/[0.08] hover:border-emerald-400/40 cursor-pointer transition-all space-y-3 group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">{t("admin.overview.usersTitle")}</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 grid place-items-center group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-white font-mono tracking-tight">
            {stats?.total_users ?? usersList.length}
          </div>
          <div className="text-[11px] text-gray-500 flex items-center justify-between pt-1 border-t border-white/[0.04]">
            <span>{t("admin.overview.usersDesc")}</span>
            <ArrowRight className="w-3 h-3 text-gray-600 group-hover:text-emerald-400 transition-colors" />
          </div>
        </div>
      </div>

      {/* ── 3. Secondary Metrics Strip ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Expressions */}
        <div
          onClick={() => setActiveTab("expressions")}
          className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] cursor-pointer transition-colors flex items-center justify-between"
        >
          <div className="space-y-1">
            <div className="text-xs text-gray-400 flex items-center gap-1.5">
              <Music2 className="w-3.5 h-3.5 text-purple-400" />
              <span>{t("admin.sidebar.itemExpressions")}</span>
            </div>
            <div className="text-lg font-bold text-white font-mono">{expressionsList.length}</div>
            <div className="text-[10px] text-gray-500">{t("admin.overview.expressionDesc")}</div>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-600" />
        </div>

        {/* Physical Assets & Storage */}
        <div
          onClick={() => setActiveTab("assets")}
          className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] cursor-pointer transition-colors flex items-center justify-between"
        >
          <div className="space-y-1">
            <div className="text-xs text-gray-400 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t("admin.sidebar.itemAssets")}</span>
            </div>
            <div className="text-lg font-bold text-white font-mono">
              {stats?.total_asset_files ?? assetsList.length}
            </div>
            <div className="text-[10px] text-gray-500">
              {t("admin.overview.itemDesc", { bytes: formatBytes(stats?.total_storage_bytes ?? 0) })}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-600" />
        </div>

        {/* Community Topics & Discussions */}
        <div
          onClick={() => setActiveTab("topics")}
          className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] cursor-pointer transition-colors flex items-center justify-between"
        >
          <div className="space-y-1">
            <div className="text-xs text-gray-400 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
              <span>{t("admin.overview.topicsTitle")}</span>
            </div>
            <div className="text-lg font-bold text-white font-mono">
              {stats?.total_topics ?? topicsList.length}
            </div>
            <div className="text-[10px] text-gray-500">
              {t("admin.overview.topicsDesc", { count: stats?.total_comments ?? 0 })}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-600" />
        </div>
      </div>

      {/* ── 4. Action Shortcuts & Audit Timeline ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Quick Actions */}
        <div className="lg:col-span-5 p-5 rounded-2xl bg-[#111115] border border-white/[0.08] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              {t("admin.overview.quickActions")}
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <button
              onClick={() => setActiveTab("reviews")}
              className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-amber-500/10 hover:border-amber-500/30 text-left transition-all group"
            >
              <div className="text-xs font-semibold text-white group-hover:text-amber-300 flex items-center gap-2">
                <Inbox className="w-4 h-4 text-amber-400" />
                {t("admin.overview.guide")}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">{t("admin.overview.guideDesc")}</div>
            </button>

            <button
              onClick={() => setActiveTab("works")}
              className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-sky-500/10 hover:border-sky-500/30 text-left transition-all group"
            >
              <div className="text-xs font-semibold text-white group-hover:text-sky-300 flex items-center gap-2">
                <Library className="w-4 h-4 text-sky-400" />
                {t("admin.overview.newWork")}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">{t("admin.overview.newWorkDesc")}</div>
            </button>

            <button
              onClick={() => setActiveTab("artists")}
              className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-purple-500/10 hover:border-purple-500/30 text-left transition-all group"
            >
              <div className="text-xs font-semibold text-white group-hover:text-purple-300 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                {t("admin.overview.newAgent")}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">{t("admin.overview.newAgentDesc")}</div>
            </button>

            <button
              onClick={() => setActiveTab("health")}
              className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-emerald-500/10 hover:border-emerald-500/30 text-left transition-all group"
            >
              <div className="text-xs font-semibold text-white group-hover:text-emerald-300 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                {t("admin.sidebar.itemHealth")}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">{t("admin.overview.healthDiagnosis")}</div>
            </button>
          </div>
        </div>

        {/* Right: Recent Audit Activities */}
        <div className="lg:col-span-7 p-5 rounded-2xl bg-[#111115] border border-white/[0.08] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-sky-400" />
              {t("admin.overview.auditTitle")}
            </h3>
            <button
              onClick={() => setActiveTab("audit")}
              className="text-xs text-amber-400 hover:text-amber-300 font-mono transition-colors"
            >
              {t("admin.overview.viewAll")}
            </button>
          </div>

          <div className="space-y-2.5">
            {auditLogs.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500 font-mono">
                {t("admin.overview.noAudit")}
              </div>
            ) : (
              auditLogs.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] text-xs font-mono space-y-1.5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-white/[0.06] text-gray-200 text-[10px] font-semibold">
                      {log.action}
                    </span>
                    <span className="text-[10px] text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-gray-300 line-clamp-1">
                    {log.detail?.note || log.detail?.summary || `${log.target_type} #${log.target_id?.slice(0, 8) || ""}`}
                  </div>
                  <div className="text-[10px] text-gray-500 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    <span>Actor: {log.actor_role || "User"} ({log.actor_id?.slice(0, 8) || "System"})</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
