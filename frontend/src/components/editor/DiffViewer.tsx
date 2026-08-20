"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  diff: Record<string, { old: any; new: any }>;
  editType?: string;
  className?: string;
}

export function DiffViewer({ diff, editType = "update", className = "" }: Props) {
  const { t } = useI18n();

  const formatVal = (v: any) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  };

  if (!diff || Object.keys(diff).length === 0) {
    return (
      <div className={`p-6 rounded-card border border-white/[0.06] bg-background/30 text-center font-mono text-xs text-gray-500 ${className}`}>
        {editType === "create" ? "Initial snapshot" : t("editor.diff.noChanges")}
      </div>
    );
  }

  return (
    <div className={`space-y-3 font-mono text-xs ${className}`}>
      {Object.entries(diff).map(([key, change]) => (
        <div key={key} className="rounded-card border border-white/[0.08] bg-background/80 overflow-hidden shadow-soft">
          <div className="px-3 py-1.5 bg-white/[0.04] border-b border-white/[0.06] text-gray-400 font-bold text-[11px] flex items-center justify-between">
            <span>{key}</span>
            <span className="text-[10px] text-gray-500 font-normal">Field Diff</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06] p-3 gap-2">
            <div className="space-y-1">
              <span className="text-[10px] text-rose-400/80 uppercase font-semibold">{t("editor.diff.before")}</span>
              <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-200 break-all whitespace-pre-wrap">
                {formatVal(change.old)}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-emerald-400/80 uppercase font-semibold">{t("editor.diff.after")}</span>
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 break-all whitespace-pre-wrap">
                {formatVal(change.new)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
