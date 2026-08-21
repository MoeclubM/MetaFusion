"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { RelationType } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

interface RelationRow {
  target_id: string;
  relationship_type: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
}

interface Props {
  relations: RelationRow[];
  relationTypes: RelationType[];
  addRelationRow: () => void;
  removeRelationRow: (idx: number) => void;
  updateRelationRow: (idx: number, patch: Partial<RelationRow>) => void;
}

export function EditorRelationsField({
  relations,
  relationTypes,
  addRelationRow,
  removeRelationRow,
  updateRelationRow,
}: Props) {
  const { t, locale } = useI18n();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-white">{t("editor.relations.title")}</h3>
          <p className="text-[11px] text-gray-500">{t("editor.relations.desc")}</p>
        </div>
        <button
          type="button"
          onClick={addRelationRow}
          className="px-3.5 h-9 rounded-lg bg-white text-black text-xs sm:text-sm font-semibold flex items-center gap-1.5 hover:bg-gray-200 transition-colors shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {t("editor.relations.addRow")}
        </button>
      </div>

      {relations.length === 0 && (
        <div className="p-8 rounded-card border border-white/[0.06] bg-background/30 text-center font-mono text-xs sm:text-sm text-gray-500">
          {t("editor.relations.noRelations")}
        </div>
      )}

      <div className="space-y-3">
        {relations.map((rel, idx) => (
          <div key={idx} className="p-4 rounded-xl bg-background/70 border border-white/10 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <div className="md:col-span-5 space-y-1">
                <label className="text-xs font-mono text-gray-400">{t("editor.relations.targetIdLabel")}</label>
                <input
                  type="text"
                  required
                  value={rel.target_id}
                  onChange={(e) => updateRelationRow(idx, { target_id: e.target.value })}
                  placeholder={t("editor.relations.targetIdPlaceholder")}
                  className="w-full px-3.5 h-10 rounded-lg bg-surface border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="md:col-span-6 space-y-1">
                <label className="text-xs font-mono text-gray-400">{t("editor.relations.roleLabel")}</label>
                <select
                  value={rel.relationship_type}
                  onChange={(e) => updateRelationRow(idx, { relationship_type: e.target.value })}
                  className="w-full px-3.5 h-10 rounded-lg bg-surface border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
                >
                  {relationTypes.map((rt) => {
                    const label = locale.startsWith("zh")
                      ? (rt.name_zh || rt.names?.["zh-CN"] || rt.code)
                      : (rt.name_en || rt.names?.["en-US"] || rt.name_zh || rt.code);
                    return (
                      <option key={rt.code} value={rt.code}>
                        {label} ({rt.code})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="md:col-span-1 flex justify-end md:pt-5">
                <button
                  type="button"
                  onClick={() => removeRelationRow(idx)}
                  className="p-2 rounded-lg hover:bg-rose-500/20 text-gray-500 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Relation Temporal Interval */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2.5 border-t border-white/[0.04] items-center">
              <div>
                <input
                  type="text"
                  value={rel.begin_date || ""}
                  onChange={(e) => updateRelationRow(idx, { begin_date: e.target.value })}
                  placeholder={t("editor.relations.beginPlaceholder")}
                  className="w-full px-3 h-9 rounded-lg bg-surface/50 border border-white/10 text-white font-mono text-xs sm:text-sm focus:outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <input
                  type="text"
                  value={rel.end_date || ""}
                  onChange={(e) => updateRelationRow(idx, { end_date: e.target.value })}
                  placeholder={t("editor.relations.endPlaceholder")}
                  className="w-full px-3 h-9 rounded-lg bg-surface/50 border border-white/10 text-white font-mono text-xs sm:text-sm focus:outline-none focus:border-amber-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`rel_ended_${idx}`}
                  checked={rel.ended || false}
                  onChange={(e) => updateRelationRow(idx, { ended: e.target.checked })}
                  className="w-4 h-4 rounded bg-background border-white/10 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor={`rel_ended_${idx}`} className="text-xs text-gray-400 font-mono cursor-pointer">
                  {t("editor.relations.endedCheckbox")}
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
