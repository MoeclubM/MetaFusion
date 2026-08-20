"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";

export default function NewArtistPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8 w-full flex-1">
        <UniversalEntityEditor
          isOpen={true}
          isFullPage={true}
          targetType="artist"
          mode="create"
          onClose={() => router.back()}
          onSuccess={(res) => {
            const artistId = res?.artist?.id || res?.id;
            if (artistId) router.push(`/artists/${artistId}`);
            else router.push("/explore");
          }}
        />
      </main>
    </div>
  );
}
