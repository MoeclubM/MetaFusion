"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Select } from "@/components/ui/Select";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  showPageSize?: boolean;
  showQuickJumper?: boolean;
  showTotal?: boolean;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [12, 24, 48, 96],
  showPageSize = true,
  showQuickJumper = true,
  showTotal = true,
  className = "",
}: PaginationProps) {
  const { t } = useI18n();
  const [jumpInput, setJumpInput] = useState<string>("");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const startItem = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, total);

  // Generate pagination items
  const generatePageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const items: (number | "ellipsis-left" | "ellipsis-right")[] = [];
    if (currentPage <= 4) {
      for (let i = 1; i <= 5; i++) items.push(i);
      items.push("ellipsis-right");
      items.push(totalPages);
    } else if (currentPage >= totalPages - 3) {
      items.push(1);
      items.push("ellipsis-left");
      for (let i = totalPages - 4; i <= totalPages; i++) items.push(i);
    } else {
      items.push(1);
      items.push("ellipsis-left");
      items.push(currentPage - 1);
      items.push(currentPage);
      items.push(currentPage + 1);
      items.push("ellipsis-right");
      items.push(totalPages);
    }
    return items;
  };

  const handleJump = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(jumpInput.trim(), 10);
    if (!isNaN(target) && target >= 1 && target <= totalPages) {
      onPageChange(target);
      setJumpInput("");
    }
  };

  if (total <= 0 && !showTotal) {
    return null;
  }

  const pageNumbers = generatePageNumbers();

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs text-gray-600 dark:text-gray-400 select-none py-2 ${className}`}
    >
      {/* Total / Range Info */}
      {showTotal && (
        <div className="flex items-center gap-2 text-xs">
          <span>
            {t("pagination.range", {
              start: startItem,
              end: endItem,
              total,
            })}
          </span>
        </div>
      )}

      {/* Center / Navigation controls */}
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        {/* First Page */}
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
          className="w-8 h-8 rounded-md flex items-center justify-center border border-black/10 dark:border-white/10 bg-surface hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title={t("pagination.first")}
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>

        {/* Prev Page */}
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="w-8 h-8 rounded-md flex items-center justify-center border border-black/10 dark:border-white/10 bg-surface hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title={t("pagination.prev")}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {/* Numeric page items */}
        {pageNumbers.map((item, idx) => {
          if (item === "ellipsis-left" || item === "ellipsis-right") {
            return (
              <span
                key={`${item}-${idx}`}
                className="w-7 h-8 flex items-center justify-center text-gray-400"
              >
                …
              </span>
            );
          }

          const isCurrent = item === currentPage;
          return (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              className={`w-8 h-8 rounded-md font-mono text-xs font-semibold flex items-center justify-center transition-all ${
                isCurrent
                  ? "bg-primary text-white border border-primary shadow-xs"
                  : "bg-surface border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300"
              }`}
            >
              {item}
            </button>
          );
        })}

        {/* Next Page */}
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="w-8 h-8 rounded-md flex items-center justify-center border border-black/10 dark:border-white/10 bg-surface hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title={t("pagination.next")}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {/* Last Page */}
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
          className="w-8 h-8 rounded-md flex items-center justify-center border border-black/10 dark:border-white/10 bg-surface hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title={t("pagination.last")}
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right: Page Size & Quick Jumper */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Page Size Selector */}
        {showPageSize && onPageSizeChange && pageSizeOptions.length > 1 && (
          <div className="w-28">
            <Select
              value={String(pageSize)}
              onChange={(val) => onPageSizeChange(parseInt(val, 10))}
              fullWidth={true}
              className="h-8 px-2 text-xs font-mono"
              options={pageSizeOptions.map((opt) => ({
                value: String(opt),
                label: t("pagination.perPage", { size: opt }),
              }))}
            />
          </div>
        )}

        {/* Quick Jumper */}
        {showQuickJumper && totalPages > 1 && (
          <form onSubmit={handleJump} className="flex items-center gap-1">
            <span className="text-xs text-gray-500">{t("pagination.jumpTo")}</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              placeholder={String(currentPage)}
              className="w-12 h-8 px-1.5 rounded bg-surface border border-black/10 dark:border-white/10 text-center text-xs font-mono text-gray-800 dark:text-gray-200 focus:outline-none focus:border-primary"
            />
            <span className="text-xs text-gray-500">{t("pagination.page")}</span>
          </form>
        )}
      </div>
    </div>
  );
}
