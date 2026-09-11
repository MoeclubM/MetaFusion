"use client";

import React, { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { getStorageEntityUrl, hasResourceStation } from "@/lib/services";
import { DownloadCloud, ExternalLink, HardDrive } from "lucide-react";

function DownloadsInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const subjectId = searchParams.get("subject_id") || searchParams.get("ref") || "";
  const configured = hasResourceStation();
  const targetUrl = getStorageEntityUrl(subjectId || undefined);

  useEffect(() => {
    // 仅在配置了外部资源站时跳转；否则会自我重定向回本页形成死循环。
    if (configured) window.location.replace(targetUrl);
  }, [configured, targetUrl]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      <main className="flex-1 grid place-items-center px-4 py-16">
        {configured ? (
          <div className="text-center space-y-4 max-w-sm">
            <DownloadCloud className="w-8 h-8 text-primary mx-auto" />
            <p className="text-sm text-gray-400">{t("catalog.resourceGatewayRedirecting")}</p>
            <a
              href={targetUrl}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-surface font-semibold text-sm transition-colors"
            >
              <span>{t("catalog.resourceGatewayVisit")}</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        ) : (
          <div className="text-center space-y-3 max-w-sm">
            <HardDrive className="w-8 h-8 text-gray-500 mx-auto" />
            <p className="text-sm text-gray-400 leading-relaxed">
              {t("catalog.resourceStationNotReady")}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function DownloadsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background grid place-items-center text-xs font-mono text-gray-500">
          Loading...
        </div>
      }
    >
      <DownloadsInner />
    </Suspense>
  );
}
