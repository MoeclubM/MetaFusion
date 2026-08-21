"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
import { ThemePicker } from "@/components/ThemePicker";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import {
 ArrowRight,
 Library,
 LogIn,
 Compass,
 Github,
 Disc,
 Film,
 Gamepad2,
 BookOpen,
 Users,
 Search,
 Layers,
 Database,
 Sparkles,
} from "lucide-react";

function RootLandingInner() {
 const { user } = useAuth();
 const { t } = useI18n();
 const router = useRouter();
 const [quickQuery, setQuickQuery] = useState("");

 const handleSearch = (e: React.FormEvent) => {
 e.preventDefault();
 if (quickQuery.trim()) {
 router.push(`/explore?q=${encodeURIComponent(quickQuery.trim())}`);
 } else {
 router.push("/explore");
 }
 };

 return (
 <div className="min-h-screen bg-background relative flex flex-col justify-between overflow-x-hidden selection:bg-primary selection:text-white">
 {/* ── Background subtle grid & ambient ── */}
 <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
 <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />

 {/* Top Telemetry Header */}
 <header className="relative z-20 w-full max-w-7xl mx-auto px-4 py-3 flex items-center justify-between border-b border-black/5 dark:border-white/[0.06]">
 <div className="flex items-center gap-3">
 <Link href="/" className="flex items-center gap-2 group">
 <BrandMark size={24} withGlow={false} idSuffix="root-nav" />
 <span className="font-display text-lg tracking-tight text-gray-900 dark:text-white group-hover:text-primary transition-colors">
 MetaFusion
 </span>
 </Link>

 </div>

 <div className="flex items-center gap-2 sm:gap-2">
 <a
 href="/docs/overview"
 className="inline-flex items-center gap-1.5 px-3 h-9 max-sm:min-h-[44px] rounded-md bg-black/5 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-white/70 hover:text-gray-900 dark:hover:text-white text-sm font-mono font-medium transition-colors"
 title="MetaFusion 完整文档"
 >
 <BookOpen className="w-4 h-4 text-primary" strokeWidth={1.8} />
 <span className="hidden sm:inline">DOCS</span>
 </a>
 <a
 href="https://github.com/MoeclubM/MetaFusion"
 target="_blank"
 rel="noopener noreferrer"
 aria-label="GitHub — MoeclubM/MetaFusion"
 className="inline-flex items-center gap-2 px-3.5 h-9 max-sm:min-h-[44px] rounded-md bg-black/5 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-white/70 hover:text-gray-900 dark:hover:text-white text-sm font-mono font-medium transition-colors"
 >
 <Github className="w-4 h-4" strokeWidth={1.8} />
 <span className="hidden sm:inline">REPO</span>
 </a>
 <ThemePicker />
 <LocaleSwitcher compact />
 {user ? (
 <Link
 href="/home"
 className="inline-flex items-center gap-2 px-3 h-9 max-sm:min-h-[44px] rounded-md bg-primary text-white keep-white hover:opacity-90 text-sm font-semibold shadow-xs transition-opacity"
 >
 <Library className="w-4 h-4" />
 <span>{t("landing.enterHome")}</span>
 </Link>
 ) : (
 <Link
 href="/login"
 className="inline-flex items-center gap-2 px-3 h-9 max-sm:min-h-[44px] rounded-md bg-primary text-white keep-white hover:opacity-90 text-sm font-semibold shadow-xs transition-opacity"
 >
 <LogIn className="w-4 h-4" />
 <span>{t("nav.login")}</span>
 </Link>
 )}
 </div>
 </header>

 {/* Main Terminal Center */}
 <main className="relative z-10 w-full max-w-5xl mx-auto px-4 py-6 flex-1 flex flex-col justify-center space-y-5">
 {/* Terminal Header & Search Console */}
 <div className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md space-y-4 shadow-soft">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-black/5 dark:border-white/[0.06] pb-3">
 <div className="space-y-0.5">
 <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
 <Database className="w-4 h-4" />
 <span>OPEN METADATA ARCHIVE TERMINAL</span>
 </div>
 <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
 MetaFusion Data Core
 </h1>
 </div>
 <div className="flex items-center gap-2 font-mono text-sm text-gray-500 dark:text-gray-400">
 <span className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.04] border border-black/10 dark:border-white/10">
 FRBR ARCHIVAL MODEL
 </span>
 </div>
 </div>

 {/* Quick Search Terminal Input */}
 <form onSubmit={handleSearch} className="relative w-full">
   <div className="relative flex items-center">
     <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
     <input
       type="text"
       placeholder={t("explore.searchPlaceholder")}
       value={quickQuery}
       onChange={(e) => setQuickQuery(e.target.value)}
       className="w-full pl-12 pr-32 h-12 sm:h-13 max-sm:min-h-[48px] rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm sm:text-base text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono transition-all"
     />
     <button
       type="submit"
       className="absolute right-1.5 top-1/2 -translate-y-1/2 px-4 h-9.5 sm:h-10 max-sm:min-h-[40px] rounded-lg bg-primary text-white keep-white hover:opacity-90 font-mono text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer"
     >
       <span>EXECUTE</span>
       <ArrowRight className="w-4 h-4" />
     </button>
   </div>
 </form>

 {/* Action Row */}
 <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
 <div className="flex items-center gap-2">
 <Link
 href="/explore"
 className="inline-flex items-center gap-2 px-3.5 h-10 max-sm:min-h-[44px] rounded-md bg-white text-black hover:bg-gray-100 border border-white/20 text-sm font-semibold transition-all shadow-xs"
 >
 <Compass className="w-4 h-4 text-primary" />
 <span>{t("landing.exploreArchive")}</span>
 </Link>
 {!user && (
 <Link
 href="/login?tab=register"
 className="inline-flex items-center gap-2 px-3.5 h-10 max-sm:min-h-[44px] rounded-md bg-black/[0.03] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-800 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white text-sm font-medium transition-all"
 >
 <Sparkles className="w-4 h-4 text-amber-500" />
 <span>{t("landing.joinCommunity")}</span>
 </Link>
 )}
 </div>

 <div className="font-mono text-sm text-gray-500 flex items-center gap-3">
 <span>WORK · EXPRESSION · RELEASE · ITEM</span>
 </div>
 </div>
 </div>

 {/* High-Density Media Channel Matrix */}
 <div className="p-4 sm:p-5 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/70 backdrop-blur-md space-y-3 shadow-soft">
 <div className="flex items-center justify-between">
 <span className="font-mono text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
 <Layers className="w-4 h-4 text-primary" />
 <span>{t("landing.quickExplore")}</span>
 </span>
 <Link href="/explore" className="font-mono text-sm text-primary hover:underline flex items-center gap-2">
 <span>{t("landing.allArchives")}</span>
 <ArrowRight className="w-4 h-4" />
 </Link>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
 <Link
 href="/explore?media_type=music"
 className="p-4 rounded-md bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06] hover:border-amber-400/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-all flex flex-col items-center gap-2 text-center group"
 >
 <div className="w-8 h-8 rounded-sm bg-amber-500/10 border border-amber-500/20 grid place-items-center group-hover:scale-105 transition-transform">
 <Disc className="w-4 h-4 text-amber-400" />
 </div>
 <div>
 <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("landing.catMusic")}</div>
 <div className="font-mono text-xs text-gray-500">Music / OST</div>
 </div>
 </Link>

 <Link
 href="/explore?media_type=anime"
 className="p-4 rounded-md bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06] hover:border-sky-400/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-all flex flex-col items-center gap-2 text-center group"
 >
 <div className="w-8 h-8 rounded-sm bg-sky-500/10 border border-sky-500/20 grid place-items-center group-hover:scale-105 transition-transform">
 <Film className="w-4 h-4 text-sky-400" />
 </div>
 <div>
 <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("landing.catAnime")}</div>
 <div className="font-mono text-xs text-gray-500">Anime / Cinema</div>
 </div>
 </Link>

 <Link
 href="/explore?media_type=game"
 className="p-4 rounded-md bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06] hover:border-purple-400/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-all flex flex-col items-center gap-2 text-center group"
 >
 <div className="w-8 h-8 rounded-sm bg-purple-500/10 border border-purple-500/20 grid place-items-center group-hover:scale-105 transition-transform">
 <Gamepad2 className="w-4 h-4 text-purple-400" />
 </div>
 <div>
 <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("landing.catGame")}</div>
 <div className="font-mono text-xs text-gray-500">Game / VN</div>
 </div>
 </Link>

 <Link
 href="/explore?media_type=literature"
 className="p-4 rounded-md bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06] hover:border-rose-400/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-all flex flex-col items-center gap-2 text-center group"
 >
 <div className="w-8 h-8 rounded-sm bg-rose-500/10 border border-rose-500/20 grid place-items-center group-hover:scale-105 transition-transform">
 <BookOpen className="w-4 h-4 text-rose-400" />
 </div>
 <div>
 <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("landing.catLiterature")}</div>
 <div className="font-mono text-xs text-gray-500">Literature / Art</div>
 </div>
 </Link>

 <Link
 href="/explore?type=artists"
 className="p-4 rounded-md bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06] hover:border-emerald-400/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-all flex flex-col items-center gap-2 text-center group col-span-2 sm:col-span-1"
 >
 <div className="w-8 h-8 rounded-sm bg-emerald-500/10 border border-emerald-500/20 grid place-items-center group-hover:scale-105 transition-transform">
 <Users className="w-4 h-4 text-emerald-400" />
 </div>
 <div>
 <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("landing.catArtists")}</div>
 <div className="font-mono text-xs text-gray-500">Entities / Graph</div>
 </div>
 </Link>
 </div>
 </div>
 </main>

 {/* Docked Minimal Footer */}
 <footer className="relative z-10 w-full max-w-5xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-black/5 dark:border-white/[0.06] font-mono text-sm text-gray-500 dark:text-white/35">
  <div className="flex items-center gap-4 flex-wrap">
    <span>© 2026 MoeClub Ltd · Open Archival Engine</span>
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
  <Github className="w-4 h-4" strokeWidth={1.6} />
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
