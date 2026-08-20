"use client";

import React, { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";

function ReleaseNewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workId = searchParams.get("work_id");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8 w-full flex-1">
        <UniversalEntityEditor
          isOpen={true}
          isFullPage={true}
          targetType="release"
          mode="create"
          initialData={workId ? { work_id: workId } : {}}
          onClose={() => router.back()}
          onSuccess={(res) => {
            const releaseId = res?.release?.id || res?.id;
            if (releaseId) router.push(`/releases/${releaseId}`);
            else router.push("/explore");
          }}
        />
      </main>
    </div>
  );
}

export default function NewReleasePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center font-mono text-xs text-gray-500">Loading…</div>}>
      <ReleaseNewInner />
    </Suspense>
  );
}
