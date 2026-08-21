"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";

export default function DevelopersRedirectPage() {
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    window.location.replace("/docs/api-overview");
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 font-mono text-sm text-gray-500">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
        <span>{t("developers.redirecting")}</span>
      </div>
      <a href="/docs/api-overview" className="mt-3 text-xs text-primary underline">
        {t("developers.clickIfNoRedirect")}
      </a>
    </div>
  );
}

