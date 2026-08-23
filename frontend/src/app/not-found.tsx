"use client";

import React from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
import { Compass, Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <main className="min-h-screen bg-background relative flex flex-col items-center justify-center px-6 py-12 selection:bg-primary selection:text-white">
      {/* Background ambient light */}
      <div className="absolute inset-0 bg-radial-vignette opacity-60 pointer-events-none" aria-hidden />
      <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />

      <div className="relative z-10 max-w-md w-full text-center flex flex-col items-center">
        <div className="mb-6 animate-pulse">
          <BrandMark size={72} withGlow={true} idSuffix="not-found" />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono tracking-wider mb-4">
          <span>STATUS 404</span>
          <span>•</span>
          <span>NOT FOUND</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
          {t("notFound.title") || "页面未找到"}
        </h1>
        <p className="text-sm sm:text-base text-gray-400 mb-8 leading-relaxed">
          {t("notFound.desc") || "您访问的实体、文献档案或页面不存在，可能已被迁移或移除。"}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 w-full">
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t("common.back") || "返回上一页"}</span>
          </button>

          <Link
            href="/home"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-medium shadow-lg shadow-primary/25 transition-all"
          >
            <Home className="w-4 h-4" />
            <span>{t("nav.home") || "返回首页"}</span>
          </Link>

          <Link
            href="/explore"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 text-sm font-medium transition-colors"
          >
            <Compass className="w-4 h-4 text-sky-400" />
            <span>{t("nav.explore") || "探索档案"}</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
