"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { BookOpen, Compass, LogIn } from "lucide-react";
import { LoadingFallback } from "@/components/common/LoadingFallback";
import { Navbar } from "@/components/Navbar";
import { BrandMark } from "@/components/Logo";
import { GitHubIcon } from "@/components/Icons";
import { PageShell } from "@/components/ui/PageShell";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";

function RootLandingInner() {
  const { user } = useAuth();
  const { t } = useI18n();
  const actionClass = "inline-flex items-center justify-center gap-2 min-h-10 px-3 rounded-control border border-line bg-surface text-sm text-text-strong hover:border-primary/50 hover:text-primary";

  return (
    <div className="min-h-screen flex flex-col bg-background text-text-strong">
      <Navbar />
      <PageShell width="narrow" contentClassName="space-y-5">
        <header className="flex items-start gap-3">
          <BrandMark size={48} idSuffix="landing" className="shrink-0" />
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">MetaFusion</h1>
            <p className="text-sm text-text-body leading-relaxed">{t("landing.heroSubtitle")}</p>
          </div>
        </header>
        <div className="flex flex-wrap gap-2">
          <Link href="/explore" className="inline-flex items-center justify-center gap-2 min-h-10 px-3 rounded-control bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
            <Compass className="w-4 h-4" />{t("landing.exploreArchive")}
          </Link>
          <Link href="/" className={actionClass}>{t("landing.enterHome")}</Link>
          {!user && <Link href="/login?tab=register" className={actionClass}><LogIn className="w-4 h-4" />{t("landing.join")}</Link>}
        </div>
        <nav aria-label={t("landing.docsTitle")} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
          <a href="/docs/catalog" className="inline-flex items-center gap-1.5 text-primary hover:underline"><BookOpen className="w-4 h-4" />{t("landing.docsCenter")}</a>
          <Link href="/developers" className="text-primary hover:underline">{t("home.footerApi")}</Link>
          <a href="https://github.com/MoeclubM/MetaFusion" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-text-muted hover:text-primary"><GitHubIcon className="w-4 h-4" />GitHub</a>
        </nav>
      </PageShell>
    </div>
  );
}

export default function RootLandingPage() {
  return <Suspense fallback={<LoadingFallback />}><RootLandingInner /></Suspense>;
}
