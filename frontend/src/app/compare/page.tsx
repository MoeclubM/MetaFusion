"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { Compare } from "@/components/catalog/CatalogPages";

function CompareContent() {
  const searchParams = useSearchParams();
  const ids = searchParams.get("ids") || "";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        <Compare ids={ids} />
      </main>
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
