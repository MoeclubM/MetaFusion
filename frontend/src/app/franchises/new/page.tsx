"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";

export default function NewFranchisePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8 w-full flex-1">
        <UniversalEntityEditor
          isOpen={true}
          isFullPage={true}
          targetType="franchise"
          mode="create"
          onClose={() => router.back()}
          onSuccess={(res) => {
            const id = res?.franchise?.id || res?.id;
            if (id) router.push(`/franchises/${id}`);
            else router.push("/explore?type=franchises");
          }}
        />
      </main>
    </div>
  );
}
