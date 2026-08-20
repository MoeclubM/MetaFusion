"use client";
import React from "react";
import { ForumBoard, Tag } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export function CommunityTagFilter({
  availableTags,
  filterTagId,
  onSelect,
  onClear,
  limit = 16,
}: {
  availableTags: Tag[];
  filterTagId: number | null;
  onSelect: (id: number | null) => void;
  onClear: () => void;
  limit?: number;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={onClear}
        className={`px-2 py-1 rounded-full border text-[11px] font-medium ${filterTagId === null ? "bg-white text-black border-white" : "bg-surface border-surfaceBorder text-gray-400"}`}
      >
        {t("common.all")}
      </button>
      {availableTags.slice(0, limit).map((tag) => (
        <button
          key={tag.id}
          onClick={() => onSelect(tag.id)}
          className={`px-2 py-1 rounded-full border text-[11px] font-medium ${filterTagId === tag.id ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-surface border-surfaceBorder text-gray-400"}`}
        >
          #{tag.name}
        </button>
      ))}
    </div>
  );
}

export function BoardList({
  boards,
  selectedBoard,
  onSelect,
  topics,
  resolveIcon,
  boardDisplayName,
  locale,
}: {
  boards: ForumBoard[];
  selectedBoard: string;
  onSelect: (code: string) => void;
  topics: any[];
  resolveIcon: (b: ForumBoard) => React.ElementType;
  boardDisplayName: (b: ForumBoard, locale: string) => string;
  locale: string;
}) {
  return (
    <div className="space-y-0.5">
      {boards.map((board) => {
        const Icon = resolveIcon(board);
        const isActive = selectedBoard === board.code;
        return (
          <button
            key={board.code}
            onClick={() => onSelect(board.code)}
            className={`w-full group flex items-center gap-2.5 px-2.5 py-2.5 rounded-md border text-left transition-colors ${isActive ? "bg-surface border-surfaceBorder text-white shadow-sm" : "border-transparent text-gray-400 hover:text-white hover:bg-surface/70"}`}
          >
            <span className={`w-7 h-7 rounded-md flex items-center justify-center border shrink-0 ${board.bgColor} ${board.borderColor}`}>
              <Icon className={`w-3.5 h-3.5 ${board.color}`} />
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block text-xs font-semibold leading-none truncate ${isActive ? "text-white" : "text-gray-300 group-hover:text-white"}`}>{boardDisplayName(board, locale)}</span>
              <span className="block text-[10px] text-gray-500 truncate leading-tight mt-0.5">{board.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
