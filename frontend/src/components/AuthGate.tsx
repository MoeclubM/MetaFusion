"use client";

import React, { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";

const PROTECTED_PREFIXES = ["/admin", "/invites", "/settings", "/works/new", "/artists/new", "/releases/new"];

function isProtectedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isProtected = isProtectedPath(pathname);

  useEffect(() => {
    if (!loading && !user && isProtected) {
      router.replace("/login");
    }
  }, [loading, user, isProtected, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <span className="font-mono text-xs text-gray-500 tracking-wider">METAFUSION INITIALIZING...</span>
        </div>
      </div>
    );
  }

  // Only block protected routes while redirecting; metadata pages stay public
  if (!user && isProtected) {
    return null;
  }

  return <>{children}</>;
};
