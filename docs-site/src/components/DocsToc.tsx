"use client";
import { useEffect, useState } from "react";
import type { Heading } from "@/lib/docs";

export function DocsToc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState<string>("");
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );
    headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="font-mono text-[11px] tracking-widest text-gray-500 uppercase">本页目录</div>
      <ul className="space-y-1 border-l border-black/10 dark:border-white/10 pl-3">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`block text-sm leading-snug py-0.5 transition-colors ${h.level === 3 ? "pl-3" : ""} ${active === h.id ? "text-primary font-medium" : "text-gray-500 hover:text-gray-900 dark:hover:text-white"}`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
