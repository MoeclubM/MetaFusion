"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import { fetchAuthSettings, PublicAuthSettings } from "@/lib/api";
import { Layers, Users, Disc, Network, ArrowRight, Lock, LogIn, Sparkles, Zap, Disc3, Film, BookOpen, AlertCircle, Mail } from "lucide-react";
import { OmniImportModal } from "@/components/importer/OmniImportModal";

export default function ContributeHubPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [authSettings, setAuthSettings] = useState<PublicAuthSettings | null>(null);

  useEffect(() => {
    fetchAuthSettings().then(setAuthSettings).catch(() => {});
  }, []);

  const cards = [
    {
      href: "/works/new",
      icon: Layers,
      title: t("create.hub.cardWorkTitle"),
      desc: t("create.hub.cardWorkDesc"),
      accent: "text-sky-400",
      border: "hover:border-sky-500/30",
      bg: "bg-sky-500/10",
    },
    {
      href: "/artists/new",
      icon: Users,
      title: t("create.hub.cardArtistTitle"),
      desc: t("create.hub.cardArtistDesc"),
      accent: "text-amber-400",
      border: "hover:border-amber-500/30",
      bg: "bg-amber-500/10",
    },
    {
      href: "/releases/new",
      icon: Disc,
      title: t("create.hub.cardReleaseTitle"),
      desc: t("create.hub.cardReleaseDesc"),
      accent: "text-emerald-400",
      border: "hover:border-emerald-500/30",
      bg: "bg-emerald-500/10",
    },
    {
      href: "/franchises/new",
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
      <main className="max-w-5xl mx-auto px-4 py-6 w-full flex-1 space-y-5 sm:space-y-6">
        <div className="space-y-1">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t("create.hub.title")}
          </h1>
          <p className="font-mono text-xs text-gray-500 max-w-3xl">
            {t("create.hub.subtitle")}
          </p>
        </div>

        {!user && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-400/20 grid place-items-center shrink-0">
                <Lock className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <div className="font-semibold text-xs text-amber-600 dark:text-amber-200">
                  {t("contribute.unauthTitle")}
                </div>
                <div className="font-mono text-[11px] text-amber-700/80 dark:text-amber-300/80">
                  {t("contribute.unauthDesc")}
                </div>
              </div>
            </div>
            <Link
              href="/login?redirect=/contribute"
              className="px-3.5 h-8 rounded-lg bg-primary text-white font-semibold text-xs font-mono inline-flex items-center justify-center gap-1.5 shrink-0 transition-opacity hover:opacity-90 shadow-xs"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{t("contribute.loginNow")}</span>
            </Link>
          </div>
        )}

        {user && user.role !== "admin" && user.role !== "archivist" && !user.is_email_verified && authSettings?.email_verification_enabled !== false && authSettings?.require_email_verification && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-400/20 grid place-items-center shrink-0">
                <AlertCircle className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <div className="font-semibold text-xs text-amber-600 dark:text-amber-200">
                  {t("contribute.emailVerificationRequiredTitle")}
                </div>
                <div className="font-mono text-[11px] text-amber-700/80 dark:text-amber-300/80">
                  {t("contribute.emailVerificationRequiredDesc")}
                </div>
              </div>
            </div>
            <Link
              href="/settings"
              className="px-3.5 h-8 rounded-lg bg-primary text-white font-semibold text-xs font-mono inline-flex items-center justify-center gap-1.5 shrink-0 transition-opacity hover:opacity-90 shadow-xs"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{t("settings.verifyEmailBtn")}</span>
            </Link>
          </div>
        )}

        {/* Featured Hero Banner: OmniSource Fast Importer */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-linear-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:p-6 shadow-sm group">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-[11px] font-mono font-bold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t("create.hub.cardImportBadge")}</span>
              </div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                {t("create.hub.cardImportTitle")}
              </h2>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 font-mono leading-relaxed">
                {t("create.hub.cardImportDesc")}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] font-mono text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1.5">
                  <Disc3 className="w-3.5 h-3.5 text-sky-500" /> MusicBrainz
                </span>
                <span>•</span>
                <span className="inline-flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-amber-500" /> TMDB & IMDb
                </span>
                <span>•</span>
                <span className="inline-flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-500" /> Bangumi (bgm.tv)
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="px-5 h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-xs sm:text-sm font-mono inline-flex items-center justify-center gap-2 shrink-0 shadow-md hover:shadow-lg transition-all cursor-pointer"
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  className={`group p-4.5 rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface hover:border-primary/40 transition-all space-y-2.5 shadow-2xs ${c.border}`}
                >
                  <div className={`w-8 h-8 rounded-lg border border-black/5 dark:border-white/10 grid place-items-center ${c.bg}`}>
                    <Icon className={`w-4 h-4 ${c.accent}`} />
                  </div>
                  <div className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-1.5 group-hover:text-primary transition-colors">
                    <span>{c.title}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <div className="font-mono text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                    {c.desc}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </main>

      <OmniImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  );
}
