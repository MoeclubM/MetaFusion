"use client";

import Link from "next/link";
import { ArrowLeft, Search, X, RefreshCw, LogOut, Shield } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { UserAvatar } from "@/components/UserAvatar";
import { sidebarGroups } from "./types";
import type { Tab } from "./types";

export function AdminHeader({
  activeTab,
  searchQuery,
  setSearchQuery,
  loading,
  loadData,
  user,
  logout,
}: {
  activeTab: Tab;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  loading: boolean;
  loadData: () => void;
  user: { username: string; role: string; avatar_url?: string; display_name?: string | null } | null | undefined;
  logout: () => void;
}) {
  const { t } = useI18n();

  const currentTabLabel = (() => {
    const found = sidebarGroups.flatMap((g) => g.items).find((i) => i.id === activeTab);
    return found ? t(found.labelKey) : "";
  })();

  return (
    <header className="h-15 sm:h-16 border-b border-white/[0.08] bg-[#0c0c0f]/95 backdrop-blur px-4 flex items-center justify-between sticky top-0 z-40 shrink-0">
      {/* Left: Brand & Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all font-mono"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t("admin.header.backToFrontend")}</span>
        </Link>

        <div className="h-4 w-px bg-white/10" />

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/30 grid place-items-center">
            <Shield className="w-4 h-4 text-amber-400" />
          </div>
          <span className="font-display text-sm font-semibold tracking-tight text-white">MetaFusion</span>
          <span className="px-2 py-0.5 rounded-full font-mono text-[10px] tracking-wider bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium">
            {t("admin.header.consoleBadge")}
          </span>
        </div>

        {currentTabLabel && (
          <>
            <span className="text-gray-600 text-xs hidden md:inline">/</span>
            <span className="text-xs text-gray-300 font-medium hidden md:inline">
              {currentTabLabel}
            </span>
          </>
        )}
      </div>

      {/* Right: Search, Language Switcher, Refresh, User Profile */}
      <div className="flex items-center gap-2.5">
        {/* Global Search */}
        <div className="relative w-44 sm:w-60 md:w-72">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("admin.header.searchPlaceholder")}
            className="w-full pl-9 pr-8 h-9.5 sm:h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs sm:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-400/50 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Language Switcher */}
        <LocaleSwitcher compact />

        {/* Refresh Button */}
        <button
          onClick={loadData}
          title={t("admin.header.refreshTitle")}
          className="w-9 h-9 sm:w-10 sm:h-10 grid place-items-center rounded-lg bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:text-white hover:bg-white/[0.08] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-amber-400" : ""}`} />
        </button>

        <div className="h-5 w-px bg-white/10 mx-0.5" />

        {/* User Info & Sign Out */}
        <div className="flex items-center gap-2.5">
          <UserAvatar user={user} size="sm" shape="rounded" />
          <div className="text-right hidden sm:block">
            <div className="text-xs font-semibold text-gray-200">{user?.username || "Admin"}</div>
            <div className="font-mono text-[10px] text-amber-400/90 uppercase">{user?.role || "Staff"}</div>
          </div>
          <button
            onClick={logout}
            title={t("admin.header.logoutTitle")}
            className="w-9 h-9 sm:w-10 sm:h-10 grid place-items-center rounded-lg bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
