"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { PageShell } from "@/components/ui/PageShell";
import { Compare } from "@/components/catalog/CatalogPages";

function CompareContent() {
  const searchParams = useSearchParams();
  const ids = searchParams.get("ids") || "";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <PageShell width="page">
        <Compare ids={ids} />
      </PageShell>
    </div>
  );
}

function CompareFallback() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen grid place-items-center text-sm text-gray-500">{t("common.loading")}</div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<CompareFallback />}>
      <CompareContent />
    </Suspense>
  );
}
