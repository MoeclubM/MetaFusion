"use client";

import React, { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowRight, FileCode2, Layers, CheckCircle2, Plus, Minus, Edit3 } from "lucide-react";

interface Props {
  diff: Record<string, { old: any; new: any }>;
  editType?: string;
  className?: string;
  compact?: boolean;
}

export function DiffViewer({ diff, editType = "update", className = "", compact = false }: Props) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);

  const getFieldLabel = (key: string): string => {
    const map: Record<string, string> = {
      title: t("editor.diff.fieldTitle"),
      summary: t("editor.diff.fieldSummary"),
      original_title: t("editor.diff.fieldOriginalTitle"),
      cover_aspect: t("editor.diff.fieldCoverAspect"),
      cover_image_url: t("editor.diff.fieldCoverAspect") || "Cover URL",
      country: t("editor.diff.fieldCountry"),
      status: t("editor.diff.fieldStatus"),
      aliases: t("editor.diff.fieldAliases"),
      tags: t("editor.diff.fieldTags"),
      source_urls: t("editor.diff.fieldSourceUrls"),
      relations: t("editor.diff.fieldRelations"),
      edition_name: "Edition / Release Name",
      role: "Role",
      disambiguation: "Disambiguation",
      external_ids: "External IDs",
      release_date: "Release Date",
    };
    return map[key] ? `${map[key]} (${key})` : key;
  };

  const formatVal = (v: any) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (Array.isArray(v)) {
      if (v.length === 0) return "[] (空)";
      return v.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join("\n");
    }
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  };

  if (!diff || Object.keys(diff).length === 0) {
    return (
      <div className={`p-4 rounded-lg border border-black/10 dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] text-center font-mono text-xs text-gray-500 ${className}`}>
        {editType === "create" ? t("editor.diff.initialSnapshot") : t("editor.diff.noChanges")}
      </div>
    );
  }

  const entries = Object.entries(diff);

  return (
    <div className={`space-y-2.5 font-mono text-xs ${className}`}>
      <div className="flex items-center justify-between pb-1 text-[11px] text-gray-500">
        <span>{t("editor.diff.title")} ({entries.length})</span>
        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          className="text-primary hover:underline flex items-center gap-1 font-mono text-[10px]"
        >
          <FileCode2 className="w-3 h-3" />
          <span>{showRaw ? "切换可视化对比" : "查看原始 JSON"}</span>
        </button>
      </div>

      {showRaw ? (
        <pre className="p-3 rounded-lg bg-black/80 dark:bg-black/60 border border-black/10 dark:border-white/10 text-emerald-400 text-[11px] overflow-x-auto max-h-72">
          {JSON.stringify(diff, null, 2)}
        </pre>
      ) : (
        entries.map(([key, change]) => {
          const isAdded = (change.old === null || change.old === undefined || change.old === "") && change.new;
          const isRemoved = change.old && (change.new === null || change.new === undefined || change.new === "");

          return (
            <div key={key} className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-2xs">
              <div className="px-3 py-1.5 bg-black/[0.03] dark:bg-white/[0.04] border-b border-black/10 dark:border-white/[0.06] text-gray-700 dark:text-gray-300 font-semibold text-[11px] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Edit3 className="w-3 h-3 text-amber-500" />
                  {getFieldLabel(key)}
                </span>
                {isAdded ? (
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5">
                    <Plus className="w-2.5 h-2.5" /> 新增
                  </span>
                ) : isRemoved ? (
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center gap-0.5">
                    <Minus className="w-2.5 h-2.5" /> 移除
                  </span>
                ) : (
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    修改
                  </span>
                )}
              </div>

              <div className={`grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-black/10 dark:divide-white/[0.06] p-2.5 gap-2`}>
                <div className="space-y-1">
                  <span className="text-[10px] text-rose-500/90 font-semibold flex items-center gap-1">
                    <Minus className="w-2.5 h-2.5" /> {t("editor.diff.before")}
                  </span>
                  <div className="p-2 rounded bg-rose-500/[0.07] border border-rose-500/20 text-rose-700 dark:text-rose-300 break-all whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {formatVal(change.old)}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <Plus className="w-2.5 h-2.5" /> {t("editor.diff.after")}
                  </span>
                  <div className="p-2 rounded bg-emerald-500/[0.07] border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 break-all whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {formatVal(change.new)}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
