"use client";

import React, { useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { DOCS_SERVICE_URL, FORUM_SERVICE_URL } from "@/lib/services";
import { ExternalLink, Info, MessageSquare } from "lucide-react";

// 主题详情由独立社区论坛承载：本仓库后端不实现社区主题接口。
// 配置了 NEXT_PUBLIC_FORUM_URL 时回落到论坛首页（services.ts 尚未提供主题级 URL helper），否则展示未接入占位。
const FORUM_IS_EXTERNAL = FORUM_SERVICE_URL.startsWith("http");

export default function TopicDetailPage() {
  const { t } = useI18n();

  useEffect(() => {
    if (FORUM_IS_EXTERNAL) {
      window.location.replace(FORUM_SERVICE_URL);
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      <main className="flex-1 grid place-items-center px-4 py-16">
        <div className="text-center space-y-4 max-w-md">
          <MessageSquare className="w-8 h-8 text-primary mx-auto" />
          <p className="text-sm text-gray-400 leading-relaxed">
            {t("entity.detail.decoupledForumNotice")}
          </p>

          {FORUM_IS_EXTERNAL ? (
            <a
              href={FORUM_SERVICE_URL}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-surface font-semibold text-sm transition-colors"
            >
              <span>{t("home.enterForum")}</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          ) : (
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-mono">
                <Info className="w-3.5 h-3.5" />
                <span>{t("catalog.unavailable")}</span>
              </div>
              <div>
                <a
                  href={`${DOCS_SERVICE_URL}/community-guide`}
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:underline"
                >
                  <span>{t("navigation.docs")}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
