"use client";

import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import { Layers, Users, Disc, ArrowRight, Lock, LogIn } from "lucide-react";

export default function ContributeHubPage() {
  const { user } = useAuth();
  const { t } = useI18n();

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
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-5 w-full flex-1 space-y-4 sm:space-y-5">
        <div className="space-y-1">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{t("create.hub.title")}</h1>
          <p className="font-mono text-xs text-gray-500 max-w-3xl">{t("create.hub.subtitle")}</p>
        </div>

        {!user && (
          <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="w-7.5 h-7.5 rounded-md bg-amber-400/20 grid place-items-center shrink-0">
                <Lock className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <div className="font-semibold text-xs text-amber-600 dark:text-amber-200">{t("contribute.unauthTitle")}</div>
                <div className="font-mono text-[11px] text-amber-700/80 dark:text-amber-300/80">{t("contribute.unauthDesc")}</div>
              </div>
            </div>
            <Link
              href="/login?redirect=/contribute"
              className="px-3.5 h-7.5 rounded-md bg-primary text-white font-semibold text-xs font-mono inline-flex items-center justify-center gap-1.5 shrink-0 transition-opacity hover:opacity-90 shadow-xs"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{t("contribute.loginNow")}</span>
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.href}
                href={c.href}
                className={`group p-4 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface hover:border-primary/40 transition-all space-y-2.5 shadow-2xs ${c.border}`}
              >
                <div className={`w-8 h-8 rounded-md border border-black/5 dark:border-white/10 grid place-items-center ${c.bg}`}>
                  <Icon className={`w-4 h-4 ${c.accent}`} />
                </div>
                <div className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-1.5 group-hover:text-primary transition-colors">
                  <span>{c.title}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </div>
                <div className="font-mono text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{c.desc}</div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
