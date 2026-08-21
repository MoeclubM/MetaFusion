"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { NavGroup } from "@/lib/docs";

export function SearchBox({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const [q, setQ] = useState("");
  const items = useMemo(() => groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.title }))), [groups]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return items.filter((it) => it.title.toLowerCase().includes(s) || (it.description && it.description.toLowerCase().includes(s))).slice(0, 8);
  }, [q, items]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索文档…"
          className="w-full pl-8 pr-7 h-8 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
        {q && (
          <button onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {q && (
        <div className="absolute z-20 mt-2 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#151821] shadow-lg overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">无匹配结果</div>
          ) : (
            <ul className="max-h-64 overflow-auto py-1">
              {filtered.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => {
                      setQ("");
                      onNavigate?.();
                    }}
                    className="block px-3 py-2 hover:bg-black/5 dark:hover:bg-white/[0.06]"
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{it.title}</div>
                    <div className="font-mono text-[11px] text-gray-500">
                      {it.group} · {it.description || it.slug}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
