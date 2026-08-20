"use client";
import { usePathname } from "next/navigation";
import { Footer } from "./Footer";

export function ConditionalFooter() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/" || pathname === "/landing") return null;
  return <Footer />;
}
