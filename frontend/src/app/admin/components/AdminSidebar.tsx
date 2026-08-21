"use client";

import { useI18n } from "@/i18n/I18nProvider";
import type { Tab } from "./types";
import { sidebarGroups } from "./types";

export function AdminSidebar({
  activeTab,
  setActiveTab,
  setSearchQuery,
  pendingReviewsCount,
}: {
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  setSearchQuery: (v: string) => void;
  pendingReviewsCount: number;
}) {
  const { t } = useI18n();

  return (
    <aside className="w-60 border-r border-white/[0.08] bg-[#0c0c0f]/90 backdrop-blur flex flex-col p-3 gap-5 shrink-0 overflow-y-auto">
      {/* Sidebar Navigation Groups */}
      <nav className="space-y-4 flex-1">
        {sidebarGroups.map((group) => (
          <div key={group.labelKey} className="space-y-1">
            <div className="px-2.5 py-1 text-[10px] font-mono tracking-wider text-gray-500 uppercase font-semibold">
              {t(group.labelKey)}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = activeTab === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setSearchQuery("");
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all text-left group ${
                      active
                        ? "bg-amber-400 text-black font-semibold shadow-sm"
                        : "text-gray-400 hover:text-white hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          active ? "text-black" : "text-gray-400 group-hover:text-amber-400"
                        }`}
                      />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </div>

                    {item.id === "reviews" && pendingReviewsCount > 0 ? (
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold shadow-sm ${
                          active
                            ? "bg-black text-white"
                            : "bg-rose-500 text-white animate-pulse"
                        }`}
                      >
                        {pendingReviewsCount}
                      </span>
                    ) : item.badgeKey ? (
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                          active
                            ? "bg-black/15 text-black font-medium"
                            : "bg-white/[0.04] text-gray-400 border border-white/[0.06]"
                        }`}
                      >
                        {t(item.badgeKey)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
