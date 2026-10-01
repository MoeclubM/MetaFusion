"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Compass, Disc3, Film, Library, LogIn, PencilLine } from "lucide-react";
import { LoadingFallback } from "@/components/common/LoadingFallback";
import { Navbar } from "@/components/Navbar";
import { BrandMark } from "@/components/Logo";
import { GitHubIcon } from "@/components/Icons";
import { PageShell } from "@/components/ui/PageShell";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";

const examples = [
  { key: "music", icon: Disc3, steps: ["work", "edition", "medium", "tracks"] },
  { key: "screen", icon: Film, steps: ["work", "expression", "release", "units"] },
  { key: "books", icon: BookOpen, steps: ["work", "units", "expression", "release"] },
] as const;
const entries = [
  { href: "/home", key: "home", icon: Library },
  { href: "/explore", key: "browse", icon: Compass },
  { href: "/contribute", key: "contribute", icon: PencilLine },
] as const;

function RootLandingInner() {
  const { user } = useAuth();
  const { t } = useI18n();
  const actionClass = "inline-flex items-center justify-center gap-2 min-h-10 px-3 rounded-control border border-line bg-surface text-sm text-text-strong hover:border-primary/50 hover:text-primary";

  return (
    <div className="min-h-screen flex flex-col bg-background text-text-strong">
      <Navbar />
      <PageShell contentClassName="space-y-6">
        <header className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <BrandMark size={48} idSuffix="landing" className="shrink-0" />
              <div className="min-w-0 space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">MetaFusion</h1>
                <p className="text-sm text-text-body leading-relaxed">{t("landing.heroSubtitle")}</p>
              </div>
            </div>
            <p className="text-sm text-text-body leading-relaxed">{t("landing.intro")}</p>
            <div className="flex flex-wrap gap-2">
              <Link href="/home" className="inline-flex items-center justify-center gap-2 min-h-10 px-3 rounded-control bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
                <Library className="w-4 h-4" aria-hidden />{t("landing.enterHome")}
              </Link>
              <Link href="/explore" className={actionClass}><Compass className="w-4 h-4" aria-hidden />{t("landing.explore")}</Link>
              {!user && <a href="/login?tab=register&redirect=%2Fhome" className={actionClass}><LogIn className="w-4 h-4" aria-hidden />{t("landing.join")}</a>}
            </div>
          </div>
          <nav aria-label={t("landing.startTitle")} className="divide-y divide-line rounded-card border border-line bg-surface">
            {entries.map(({ href, key, icon: Icon }) => (
              <Link key={key} href={href} className="flex items-center gap-3 p-3 hover:bg-surfaceHover transition-colors">
                <Icon className="w-5 h-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold">{t(`landing.start.${key}.title`)}</span>
                  <p className="mt-1 text-xs text-text-muted leading-relaxed">{t(`landing.start.${key}.body`)}</p>
                </div>
                <ArrowRight className="w-4 h-4 shrink-0 text-text-muted" aria-hidden />
              </Link>
            ))}
          </nav>
        </header>
        <section aria-labelledby="landing-relations" className="space-y-3">
          <div className="border-b border-line pb-3 space-y-1">
            <h2 id="landing-relations" className="text-lg font-semibold">{t("landing.relationsTitle")}</h2>
            <p className="text-sm text-text-muted">{t("landing.relationsIntro")}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {examples.map(({ key, icon: Icon, steps }) => (
              <article key={key} className="rounded-card border border-line bg-surface p-4 space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="w-4 h-4 text-primary" aria-hidden />{t(`landing.example.${key}.title`)}</h3>
                <ul className="flex flex-wrap gap-1.5" aria-label={t(`landing.example.${key}.title`)}>
                  {steps.map((step) => <li key={step} className="rounded-chip border border-line bg-background px-2 py-1 text-xs text-text-body">{t(`landing.example.${key}.${step}`)}</li>)}
                </ul>
                <p className="text-sm text-text-body leading-relaxed">{t(`landing.example.${key}.body`)}</p>
              </article>
            ))}
          </div>
          <p className="text-xs text-text-muted leading-relaxed">{t("landing.relationsNote")}</p>
        </section>
        <nav aria-label={t("landing.docsTitle")} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
          <a href="/docs/catalog" className="inline-flex items-center gap-1.5 text-primary hover:underline"><BookOpen className="w-4 h-4" aria-hidden />{t("landing.docsCenter")}</a>
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
