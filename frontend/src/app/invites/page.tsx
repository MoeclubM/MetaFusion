"use client";

import React from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/authContext";
import { KeyRound, ShieldAlert } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export default function InvitesPage() {
  const { t } = useI18n();
  const { user } = useAuth();

  // 后端目前没有邀请码查询/分发实现（GET /auth/invite 不存在），这里不伪造
  // 邀请码或受邀列表，如实展示为暂未开放的占位页面。
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-16 w-full flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-white/5 grid place-items-center">
            <KeyRound className="w-6 h-6 text-gray-500" />
          </div>
          <p className="text-sm text-gray-500">{t("create.common.requiresLogin")}</p>
          <Link href="/login?redirect=/invites" className="px-5 h-9 rounded-full bg-primary text-white keep-white inline-flex items-center text-sm font-semibold">
            {t("nav.login")}
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-5 w-full flex-1 space-y-4 sm:space-y-5">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {t("invite.title")}
        </h1>

        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-6 sm:p-8 flex flex-col items-center gap-3 text-center shadow-soft">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 grid place-items-center">
            <ShieldAlert className="w-6 h-6 text-amber-500" strokeWidth={1.6} />
          </div>
          <div className="font-display text-base sm:text-lg font-bold text-gray-900 dark:text-white">
            {t("catalog.unavailable")}
          </div>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-md">
            {t("invite.noMembersHint")}
          </p>
        </div>
      </main>
    </div>
  );
}
