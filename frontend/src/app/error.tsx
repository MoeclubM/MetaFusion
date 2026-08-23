"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
import { RotateCcw, Home, AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    // 生产环境中记录错误到监控系统
    console.error("MetaFusion Application Error Boundary Caught:", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-background relative flex flex-col items-center justify-center px-6 py-12 selection:bg-primary selection:text-white">
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-radial-vignette opacity-60 pointer-events-none" aria-hidden />
      <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />

      <div className="relative z-10 max-w-lg w-full text-center flex flex-col items-center">
        <div className="mb-6">
          <BrandMark size={72} withGlow={true} idSuffix="error-boundary" />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono tracking-wider mb-4">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>APPLICATION ERROR</span>
          {error.digest && <span>• {error.digest.slice(0, 8)}</span>}
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
          {t("error.title") || "页面遇到异常"}
        </h1>
        <p className="text-sm sm:text-base text-gray-400 mb-4 leading-relaxed">
          {t("error.desc") || "系统遇到了未预期的错误。该问题已被自动捕获，您可以尝试重新加载或返回首页。"}
        </p>

        {process.env.NODE_ENV !== "production" && error.message && (
          <div className="w-full text-left bg-black/40 border border-white/10 rounded-xl p-3 mb-6 overflow-x-auto max-h-32 text-xs font-mono text-rose-300">
            {error.message}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 w-full mt-4">
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-medium shadow-lg shadow-primary/25 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{t("error.retry") || "重试加载"}</span>
          </button>

          <Link
            href="/home"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 text-sm font-medium transition-colors"
          >
            <Home className="w-4 h-4" />
            <span>{t("nav.home") || "返回首页"}</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
