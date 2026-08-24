"use client";
import { GitHubIcon } from "./Icons";

export function Footer() {
  return (
    <footer className="relative z-10 w-full border-t border-black/5 dark:border-white/[0.06] py-3 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 font-mono text-[11px] text-gray-500 dark:text-white/35">
        <span>© 2026 MoeClub Ltd · Open Archival Engine</span>
        <a
          href="https://github.com/MoeclubM/MetaFusion"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <GitHubIcon className="w-3.5 h-3.5" />
          <span>github.com/MoeclubM/MetaFusion</span>
        </a>
      </div>
    </footer>
  );
}
