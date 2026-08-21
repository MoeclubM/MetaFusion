"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "@/lib/docs";
import { SearchBox } from "./SearchBox";

export function DocsSidebar({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-black/5 dark:border-white/[0.06]">
        <SearchBox groups={groups} onNavigate={onNavigate} />
      </div>
      <nav className="flex-1 overflow-y-auto p-3 space-y-5">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-2 py-1 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{g.title}</div>
            <ul className="mt-1 space-y-0.5">
              {g.items.map((it) => {
                const active = pathname === it.href;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      onClick={onNavigate}
                      className={`block px-2.5 py-1.5 rounded-md text-sm leading-snug transition-colors ${
                        active
                          ? "bg-primary text-white font-medium"
                          : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/[0.06] hover:text-gray-900 dark:hover:text-white"
                      }`}
                    >
                      {it.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="p-3 border-t border-black/5 dark:border-white/[0.06] font-mono text-[11px] text-gray-500 space-y-1">
        <div>© 2026 MetaFusion</div>
        <a href="https://github.com/MoeclubM/MetaFusion" target="_blank" rel="noopener noreferrer" className="hover:text-primary underline underline-offset-2">
          GitHub
        </a>
      </div>
    </div>
  );
}
