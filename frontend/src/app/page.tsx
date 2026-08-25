"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
import { ThemePicker } from "@/components/ThemePicker";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { GitHubIcon } from "@/components/Icons";
import {
  Library,
  LogIn,
  Compass,
  BookOpen,
  Database,
} from "lucide-react";

function RootLandingInner() {
  const { user } = useAuth();
  const { t } = useI18n();

  return (
    <div className="min-h-screen sm:h-screen sm:max-h-screen bg-background relative flex flex-col justify-between overflow-x-hidden sm:overflow-hidden selection:bg-primary selection:text-white">
      {/* ── Background subtle ambient light ── */}
      <div className="absolute inset-0 bg-radial-vignette opacity-60 pointer-events-none" aria-hidden />
      <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-32 -right-32 w-[600px] h-[600px] bg-sky-500/8 rounded-full blur-[140px] pointer-events-none" aria-hidden />

      {/* Floating Top-Right Controls (Rounded Pills) */}
      <aside aria-label="Page controls" className="absolute top-5 right-5 z-20 flex items-center gap-2">
        <a
          href="/docs/overview"
          className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-black/5 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-white/70 hover:text-gray-900 dark:hover:text-white text-xs font-mono font-medium transition-colors"
          title={t("landing.docsTitle")}
        >
          <BookOpen className="w-3.5 h-3.5 text-primary" strokeWidth={1.8} />
          <span>DOCS</span>
        </a>
        <a
          href="https://github.com/MoeclubM/MetaFusion"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub — MoeclubM/MetaFusion"
          className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-black/5 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-white/70 hover:text-gray-900 dark:hover:text-white text-xs font-mono font-medium transition-colors"
        >
          <GitHubIcon className="w-3.5 h-3.5" />
          <span>REPO</span>
        </a>
        <ThemePicker />
        <LocaleSwitcher compact />
      </aside>

      {/* Hero Core: Perfectly Centered Stacked Layout */}
      <main className="relative z-10 w-full max-w-4xl mx-auto px-6 py-10 sm:py-16 flex-1 flex flex-col items-center justify-center text-center">
        {/* BrandMark Logo & Glowing Halo */}
        <div className="mb-6 relative group">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl transform scale-125 group-hover:scale-150 transition-transform duration-700 pointer-events-none" />
          <BrandMark size={112} withGlow={true} idSuffix="landing-hero" className="relative z-10 drop-shadow-xl" />
        </div>

        {/* Tagline Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-primary/10 border border-primary/20 font-mono text-xs uppercase tracking-widest text-primary font-semibold mb-4">
          <Database className="w-3.5 h-3.5" />
          <span>{t("landing.tagline")}</span>
        </div>

        {/* Main Brand Title */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-gray-900 dark:text-white mb-4">
          MetaFusion
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed mb-8">
          {t("landing.heroSubtitle")}
        </p>

        {/* Action Buttons: Centered */}
        <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
          <Link
            href={user ? "/home" : "/explore"}
            className="inline-flex items-center gap-2.5 px-8 h-12 rounded-full bg-primary text-white keep-white hover:opacity-90 font-semibold text-sm shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all cursor-pointer"
          >
            <Library className="w-4 h-4" />
            <span>{t("landing.enter")}</span>
          </Link>

          {!user ? (
            <Link
              href="/login?tab=register"
              className="inline-flex items-center gap-2.5 px-8 h-12 rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white hover:bg-black/[0.08] dark:hover:bg-white/[0.12] font-medium text-sm transition-all cursor-pointer"
            >
              <LogIn className="w-4 h-4 text-primary" />
              <span>{t("landing.join")}</span>
            </Link>
          ) : (
            <Link
              href="/explore"
              className="inline-flex items-center gap-2.5 px-8 h-12 rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white hover:bg-black/[0.08] dark:hover:bg-white/[0.12] font-medium text-sm transition-all cursor-pointer"
            >
              <Compass className="w-4 h-4 text-primary" />
              <span>{t("landing.exploreArchive")}</span>
            </Link>
          )}
        </div>

        {/* Architecture Highlights */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-mono text-gray-500 dark:text-white/40">
          <span className="px-2.5 py-1 rounded-md bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
            {t("landing.featureGraph")}
          </span>
          <span className="text-black/20 dark:text-white/20">·</span>
          <span className="px-2.5 py-1 rounded-md bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
            {t("landing.featureCAS")}
          </span>
          <span className="text-black/20 dark:text-white/20">·</span>
          <span className="px-2.5 py-1 rounded-md bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
            {t("landing.featureOpen")}
          </span>
        </div>
      </main>

      {/* Docked Minimal Footer */}
      <footer className="relative z-10 w-full max-w-5xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-black/5 dark:border-white/[0.06] font-mono text-xs text-gray-500 dark:text-white/35">
        <div className="flex items-center gap-4 flex-wrap">
          <span>© 2026 MoeClub Ltd · Open Metadata & Resource Platform</span>
          <span className="hidden sm:inline text-black/20 dark:text-white/20">|</span>
          <a href="/docs/overview" className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors">
            {t("landing.docsCenter")}
          </a>
          <a href="/docs/api-overview" className="text-gray-600 dark:text-gray-400 hover:text-primary transition-colors">
            Open API
          </a>
        </div>
        <a
          href="https://github.com/MoeclubM/MetaFusion"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <GitHubIcon className="w-3.5 h-3.5" />
          <span>github.com/MoeclubM/MetaFusion</span>
        </a>
      </footer>
    </div>
  );
}

export default function RootLandingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center font-mono text-sm text-gray-500">Loading…</div>}>
      <RootLandingInner />
    </Suspense>
  );
}
