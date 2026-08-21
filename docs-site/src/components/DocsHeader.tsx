"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, Github, Sun, Moon, BookOpen } from "lucide-react";

export function DocsHeader({ onMenu }: { onMenu: () => void }) {
  const [dark, setDark] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setDark(isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("mf-docs-theme", next ? "dark" : "light");
    } catch {}
  };

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 dark:bg-[#0a0c10]/80 border-b border-black/5 dark:border-white/[0.06]">
      <div className="max-w-[1440px] mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={onMenu} className="lg:hidden p-2 -ml-2 rounded-md hover:bg-black/5 dark:hover:bg-white/10">
            <Menu className="w-5 h-5" />
          </button>
          <Link href="/overview" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary grid place-items-center text-white">
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="leading-none">
              <div className="font-bold text-sm tracking-tight text-gray-900 dark:text-white">MetaFusion 文档</div>
              <div className="font-mono text-[11px] text-gray-500 hidden sm:block">开放典藏 · FRBR · 1.0</div>
            </div>
          </Link>
          <span className="hidden md:inline-flex ml-2 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] border border-primary/20">独立文档站</span>
        </div>

        <div className="flex items-center gap-1.5">
          <a href="/" className="hidden sm:inline-flex items-center px-3 h-8 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-xs font-medium hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors">
            返回主站
          </a>
          <a
            href="https://github.com/MoeclubM/MetaFusion"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-black/5 dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-xs font-medium hover:bg-black/[0.08] dark:hover:bg-white/[0.10]"
          >
            <Github className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <button onClick={toggle} aria-label="toggle theme" className="w-8 h-8 grid place-items-center rounded-md border border-black/10 dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]">
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
