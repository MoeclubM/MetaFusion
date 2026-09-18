"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import { can, CATALOG_IMPORT_SUBMIT } from "@/lib/permissions";
import { Layers, Users, Disc, Network, ArrowRight, Sparkles, Zap } from "lucide-react";
import { OmniImportModal } from "@/components/importer/OmniImportModal";
import { PageShell } from "@/components/ui/PageShell";
import { fetchImporterSources, ImporterSource } from "@/lib/api";
import { importerSourceIcon, importerSourceLabel } from "@/lib/importerSources";

export default function ContributeHubPage() {
  const { user } = useAuth();
  const { t, tr, locale } = useI18n();
  // 外部导入走 /api/importer/*:服务端要求 catalog.import.submit（预览与落库同权限）。
  // 无码时禁用入口并说明原因，不把人引到注定 403 的弹窗上。
  const canImport = can(user, CATALOG_IMPORT_SUBMIT);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  // 来源徽标只列**真有适配器**的来源（GET /api/importer/sources，与弹窗的来源 tab 同一份事实）。
  // 取不到（无权限 403、网关或上游异常）就不渲染徽标：原来写死的 MusicBrainz / TMDB & IMDb /
  // Bangumi 三条正是"列了导不进来的库"，降级时再补一份内置名单等于把谎再讲一遍。
  const [sources, setSources] = useState<ImporterSource[]>([]);
  useEffect(() => {
    if (!canImport) {
      setSources([]);
      return;
    }
    let active = true;
    fetchImporterSources()
      .then((res) => {
        if (active) setSources(res?.items || []);
      })
      .catch(() => {
        if (active) setSources([]);
      });
    return () => {
      active = false;
    };
  }, [canImport]);
  const cards = [
    {
      href: "/new?kind=work",
      icon: Layers,
      title: t("create.hub.cardWorkTitle"),
      desc: t("create.hub.cardWorkDesc"),
      accent: "text-sky-400",
      border: "hover:border-sky-500/30",
      bg: "bg-sky-500/10",
    },
    {
      href: "/new?kind=agent",
      icon: Users,
      title: t("create.hub.cardArtistTitle"),
      desc: t("create.hub.cardArtistDesc"),
      accent: "text-amber-400",
      border: "hover:border-amber-500/30",
      bg: "bg-amber-500/10",
    },
    {
      href: "/new?kind=release",
      icon: Disc,
      title: t("create.hub.cardReleaseTitle"),
      desc: t("create.hub.cardReleaseDesc"),
      accent: "text-emerald-400",
      border: "hover:border-emerald-500/30",
      bg: "bg-emerald-500/10",
    },
    {
      href: "/new?kind=collection",
      icon: Network,
      title: t("create.hub.cardFranchiseTitle"),
      desc: t("create.hub.cardFranchiseDesc"),
      accent: "text-indigo-400",
      border: "hover:border-indigo-500/30",
      bg: "bg-indigo-500/10",
    },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />
      <PageShell width="narrow" spacing="none" contentClassName="space-y-5 sm:space-y-6">
        <div className="space-y-1">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-text-strong">
            {t("create.hub.title")}
          </h1>
          <p className="font-mono text-xs text-gray-500 max-w-3xl">
            {t("create.hub.subtitle")}
          </p>
        </div>

        {/* 未登录提示原来写在这里，但 AuthGate 对 /contribute 先 return null 并跳登录，
            那段横幅永远渲染不到；未登录的登录门槛统一由 AuthGate 负责。 */}

        {/* Featured Hero Banner: OmniSource Fast Importer */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-linear-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:p-6 shadow-sm group">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-[11px] font-mono font-bold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t("create.hub.cardImportBadge")}</span>
              </div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-text-strong">
                {t("create.hub.cardImportTitle")}
              </h2>
              <p className="text-xs sm:text-sm text-text-body font-mono leading-relaxed">
                {t("create.hub.cardImportDesc")}
              </p>
              {!canImport && (
                <p className="font-mono text-[11px] text-amber-600 dark:text-amber-300">
                  {t("create.hub.importNoPermission")}
                </p>
              )}
              {sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] font-mono text-text-muted">
                  {sources.map((s, index) => {
                    const SourceIcon = importerSourceIcon(s);
                    return (
                      <React.Fragment key={s.id}>
                        {index > 0 && <span>•</span>}
                        <span className="inline-flex items-center gap-1.5">
                          <SourceIcon className="w-3.5 h-3.5 text-primary" /> {importerSourceLabel(tr, locale, s)}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => canImport && setIsImportModalOpen(true)}
              disabled={!canImport}
              aria-disabled={!canImport}
              title={canImport ? undefined : t("create.hub.importNoPermission")}
              className="px-5 h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-xs sm:text-sm font-mono inline-flex items-center justify-center gap-2 shrink-0 shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:shadow-none"
            >
              <Zap className="w-4 h-4 fill-white" />
              <span>{t("nav.importExternal")}</span>
            </button>
          </div>
        </div>

        {/* Manual Creation Cards */}
        <div className="space-y-2">
          <div className="text-xs font-mono text-gray-400 uppercase tracking-wider font-semibold">
            {t("create.hub.manualSectionTitle")}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  className={`group p-5 sm:p-6 rounded-2xl border border-line bg-surface hover:border-primary/40 transition-all space-y-3 shadow-xs hover:shadow-md ${c.border}`}
                >
                  <div className={`w-9 h-9 rounded-xl border border-line grid place-items-center ${c.bg}`}>
                    <Icon className={`w-4.5 h-4.5 ${c.accent}`} />
                  </div>
                  <div className="font-semibold text-text-strong text-base flex items-center gap-1.5 group-hover:text-primary transition-colors duration-fast ease-soft">
                    <span>{c.title}</span>
                    <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-base ease-soft" />
                  </div>
                  <div className="font-mono text-xs leading-relaxed text-text-muted">
                    {c.desc}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </PageShell>

      {/* 无权限时永不打开弹窗（预览也会 403）；入口本身已禁用并给出说明。 */}
      <OmniImportModal
        isOpen={canImport && isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  );
}
