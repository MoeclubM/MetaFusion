"use client";
import { AuthProvider } from "@/lib/authContext";
import { AuthGate } from "./AuthGate";
import { PlayerProvider } from "@/lib/playerContext";
import { GlobalAudioPlayer } from "./GlobalAudioPlayer";
import { ConditionalFooter } from "./ConditionalFooter";
export default function LegacyApplication({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AuthGate>
        <PlayerProvider>
          {children}
          <GlobalAudioPlayer />
          <ConditionalFooter />
        </PlayerProvider>
      </AuthGate>
    </AuthProvider>
  );
}
