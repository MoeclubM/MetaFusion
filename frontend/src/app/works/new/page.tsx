"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";

export default function NewWorkPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8 w-full flex-1">
        <UniversalEntityEditor
          isOpen={true}
          isFullPage={true}
          targetType="work"
          mode="create"
          onClose={() => router.back()}
          onSuccess={(res) => {
            const workId = res?.work?.id || res?.id;
            if (workId) router.push(`/works/${workId}`);
            else router.push("/explore");
          }}
        />
      </main>
    </div>
  );
}
