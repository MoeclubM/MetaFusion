"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
const LegacyApplication = dynamic(() => import("./LegacyApplication"));
export function ApplicationBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  return path === "/" || path === "/catalog" || path.startsWith("/catalog/") ? (
    <>{children}</>
  ) : (
    <LegacyApplication>{children}</LegacyApplication>
  );
}
