"use client";

import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  className?: string;
}

/** 页码窗口：恒显首末页与当前页邻页，中间断档用省略号，最多 7 个数字位。 */
function pageWindow(page: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set<number>([1, total, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (page >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => wanted.add(n));
  const pages = Array.from(wanted).filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  pages.forEach((n) => {
    const prev = out[out.length - 1];
    if (typeof prev === "number" && n - prev > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

const BTN =
  "min-w-8 h-8 px-2 rounded-lg border border-line bg-surface hover:bg-black/[0.04] dark:hover:bg-surfaceHover " +
  "disabled:opacity-40 disabled:pointer-events-none text-gray-800 dark:text-white transition-colors " +
  "duration-fast ease-soft flex items-center justify-center cursor-pointer shadow-2xs";

/**
 * 页码分页器：只有"上一页/下一页"时，上百页的结果等于无法跳转。
 * 给出页码窗口 + 首末页 + 总页数，用户才知道"还有多远"并能直接跳。
 */
export function Pagination({ page, totalPages, onChange, className = "" }: PaginationProps) {
  const { t } = useI18n();
  if (totalPages <= 1) return null;

  return (
    <nav aria-label={t("pagination.label")} className={"flex items-center gap-1.5 " + className}>
      <span className="mr-1 text-text-faint whitespace-nowrap">
        {t("pagination.totalPages", { total: totalPages.toString() })}
      </span>
      <button
        type="button"
        className={BTN}
        aria-label={t("pagination.first")}
        disabled={page <= 1}
        onClick={() => onChange(1)}
      >
        <ChevronsLeft className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className={BTN}
        aria-label={t("pagination.prev")}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      {pageWindow(page, totalPages).map((entry, i) =>
        entry === "gap" ? (
          <span key={"gap-" + i} className="px-1 text-text-faint select-none" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            aria-label={t("pagination.pageN", { n: entry.toString() })}
            aria-current={entry === page ? "page" : undefined}
            onClick={() => onChange(entry)}
            className={
              entry === page
                ? "min-w-8 h-8 px-2 rounded-lg border border-primary/30 bg-primary/15 text-primary font-bold font-mono text-xs flex items-center justify-center shadow-2xs"
                : BTN + " font-mono text-xs"
            }
          >
            {entry}
          </button>
        ),
      )}
      <button
        type="button"
        className={BTN}
        aria-label={t("pagination.next")}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className={BTN}
        aria-label={t("pagination.last")}
        disabled={page >= totalPages}
        onClick={() => onChange(totalPages)}
      >
        <ChevronsRight className="w-3.5 h-3.5" />
      </button>
    </nav>
  );
}
