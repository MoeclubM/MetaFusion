"use client";

import React from "react";
import { AuthProvider } from "@/lib/authContext";
import { AuthGate } from "./AuthGate";

export function ApplicationBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AuthGate>
        {children}
      </AuthGate>
    </AuthProvider>
  );
}
