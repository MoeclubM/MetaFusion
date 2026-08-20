"use client";
import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-black/5 dark:border-white/[0.06] py-3.5 mt-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-[11px] font-mono text-gray-500 dark:text-white/35">
        <span>© 2026 MoeClub Ltd · All Rights Reserved</span>
        <a
          href="https://github.com/MoeclubM/MetaFusion"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <Github className="w-3.5 h-3.5" strokeWidth={1.6} />
          <span>github.com/MoeclubM/MetaFusion</span>
        </a>
      </div>
    </footer>
  );
}
