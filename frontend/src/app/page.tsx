"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
import { ThemePicker } from "@/components/ThemePicker";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import {
  Library,
  LogIn,
  Compass,
  Github,
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
          <Github className="w-3.5 h-3.5" strokeWidth={1.8} />
          <span>REPO</span>
        </a>
        <ThemePicker />
        <LocaleSwitcher compact />
      </aside>

      {/* Hero Core: Enlarged Logo Left, Copy Right, Centered as a Whole */}
      <main className="relative z-10 w-full max-w-6xl mx-auto px-6 py-8 sm:py-12 flex-1 flex flex-col justify-center">
        <div className="w-full flex flex-col md:flex-row items-center justify-center gap-8 md:gap-14">
          {/* Enlarged BrandMark Logo */}
          <div className="shrink-0">
            <BrandMark size={140} withGlow={true} idSuffix="landing-hero" />
          </div>

          {/* Right Information & Actions */}
          <div className="flex-1 max-w-xl text-center md:text-left space-y-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary font-semibold">
                <Database className="w-3.5 h-3.5" />
                <span>OPEN METADATA & RESOURCE PLATFORM</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                MetaFusion
              </h1>
              <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 font-normal leading-relaxed">
                {t("landing.heroSubtitle")}
              </p>
            </div>

            {/* Action Buttons: Left "进入" (Enter), Right "加入" (Join) / "探索" (Explore) */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3.5 pt-2">
              <Link
                href={user ? "/home" : "/explore"}
                className="inline-flex items-center gap-2 px-8 h-12 rounded-full bg-primary text-white keep-white hover:opacity-90 font-semibold text-sm shadow-md hover:shadow-lg transition-all cursor-pointer"
              >
                <Library className="w-4 h-4" />
                <span>{t("landing.enter")}</span>
              </Link>

              {!user ? (
                <Link
                  href="/login?tab=register"
                  className="inline-flex items-center gap-2 px-8 h-12 rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white hover:bg-black/[0.08] dark:hover:bg-white/[0.12] font-medium text-sm transition-all cursor-pointer"
                >
                  <LogIn className="w-4 h-4 text-primary" />
                  <span>{t("landing.join")}</span>
                </Link>
              ) : (
                <Link
                  href="/explore"
                  className="inline-flex items-center gap-2 px-8 h-12 rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white hover:bg-black/[0.08] dark:hover:bg-white/[0.12] font-medium text-sm transition-all cursor-pointer"
                >
                  <Compass className="w-4 h-4 text-primary" />
                  <span>{t("landing.exploreArchive")}</span>
                </Link>
              )}
            </div>
          </div>
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
          <Github className="w-3.5 h-3.5" strokeWidth={1.6} />
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
