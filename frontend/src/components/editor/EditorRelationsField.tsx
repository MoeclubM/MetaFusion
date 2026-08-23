"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Search, Network, List } from "lucide-react";
import { fetchApi, RelationType, catalogHubOf, isCatalogHub } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { Select } from "@/components/ui/Select";
import { VisualRelationEditor } from "@/components/graph/VisualRelationEditor";

export interface RelationRow {
  target_id: string;
  target_type: string;
  relationship_type: string;
  qualifier?: string;
  begin_date?: string;
  end_date?: string;
  ended?: boolean;
  target_label?: string;
}

interface Props {
  relations: RelationRow[];
  relationTypes: RelationType[];
  sourceType: "work" | "artist" | "release" | "franchise";
  sourceEntityType?: string;
  addRelationRow: () => void;
  removeRelationRow: (idx: number) => void;
  updateRelationRow: (idx: number, patch: Partial<RelationRow>) => void;
}

const HUB_TYPES = ["work", "artist", "release", "franchise"] as const;

function uniqueHubs(allowed: string[] | undefined): string[] {
  const src = allowed && allowed.length > 0 ? allowed : [...HUB_TYPES];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of src) {
    const hub = catalogHubOf(code);
    if (seen.has(hub)) continue;
    seen.add(hub);
    out.push(hub);
  }
  return out;
}

function artistSearchEntityType(allowed: string[] | undefined, targetHub: string): string {
  if (targetHub !== "artist" || !allowed?.length) return "";
  if (allowed.includes("artist")) return "";
  const subtypes = allowed.filter((c) => !isCatalogHub(c));
  return subtypes.length === 1 ? subtypes[0] : "";
}

function typeAllowed(allowed: string[] | undefined, actual: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  const set = new Set(allowed.map((x) => x.toLowerCase()));
  return actual.some((c) => set.has(c.toLowerCase()));
}

export function EditorRelationsField({
  relations,
  relationTypes,
  sourceType,
  sourceEntityType,
  addRelationRow,
  removeRelationRow,
  updateRelationRow,
}: Props) {
  const { t, locale } = useI18n();
  const { entityTypeLabel } = useTaxonomy();
  const sourceCodes = useMemo(() => {
    const codes: string[] = [sourceType];
    if (sourceType === "artist" && sourceEntityType) codes.push(sourceEntityType);
    return codes;
  }, [sourceType, sourceEntityType]);

  const [viewMode, setViewMode] = useState<"visual" | "list">("visual");

  const filteredTypes = useMemo(() => {
    const list = relationTypes.filter((rt) => typeAllowed(rt.allowed_source_types, sourceCodes));
    return list.length > 0 ? list : relationTypes;
  }, [relationTypes, sourceCodes]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-gray-900 dark:text-white">{t("editor.relations.title")}</h3>
          <p className="text-[11px] text-gray-500">{t("editor.relations.desc")}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* 模式切换 */}
          <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 border border-border/50 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("visual")}
              className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition-all ${
                viewMode === "visual"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              {t("graph.visualEditor")}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition-all ${
                viewMode === "list"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="w-3.5 h-3.5" />
              列表表单
            </button>
          </div>

          {viewMode === "list" && (
            <button
              type="button"
              onClick={addRelationRow}
              className="px-3.5 h-8 rounded-lg bg-primary text-white text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("editor.relations.addRow")}
            </button>
          )}
        </div>
      </div>

      {viewMode === "visual" ? (
        <VisualRelationEditor
          sourceType={sourceType}
          relations={relations}
          relationTypes={filteredTypes}
          onAddRelation={(newRel) => {
            addRelationRow();
            updateRelationRow(relations.length, newRel);
          }}
          onRemoveRelation={removeRelationRow}
          onUpdateRelation={updateRelationRow}
        />
      ) : (
        <>
          {relations.length === 0 && (
            <div className="p-8 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface text-center font-mono text-xs sm:text-sm text-gray-500">
              {t("editor.relations.noRelations")}
            </div>
          )}

          <div className="space-y-3">
            {relations.map((rel, idx) => (
              <RelationEditorRow
                key={idx}
                rel={rel}
                idx={idx}
                filteredTypes={filteredTypes}
                locale={locale}
                t={t}
                entityTypeLabel={entityTypeLabel}
                updateRelationRow={updateRelationRow}
                removeRelationRow={removeRelationRow}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RelationEditorRow({
  rel,
  idx,
  filteredTypes,
  locale,
  t,
  entityTypeLabel,
  updateRelationRow,
  removeRelationRow,
}: {
  rel: RelationRow;
  idx: number;
  filteredTypes: RelationType[];
  locale: string;
  t: (key: string) => string;
  entityTypeLabel: (code?: string | null) => string;
  updateRelationRow: (idx: number, patch: Partial<RelationRow>) => void;
  removeRelationRow: (idx: number) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; label: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const selectedRt = filteredTypes.find((rt) => rt.code === rel.relationship_type);
  const targetOptions = uniqueHubs(selectedRt?.allowed_target_types);
  const subtypeFilter = artistSearchEntityType(selectedRt?.allowed_target_types, rel.target_type);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1 || !rel.target_type) {
      setHits([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const hub = catalogHubOf(rel.target_type);
        const path =
          hub === "artist"
            ? "artists"
            : hub === "work"
            ? "works"
            : hub === "release"
            ? "releases"
            : hub === "franchise"
            ? "franchises"
            : "";
        if (!path) {
          setHits([]);
          return;
        }
        const qs = new URLSearchParams({ q: term, page_size: "8" });
        if (hub === "artist" && subtypeFilter) qs.set("entity_type", subtypeFilter);
        const res = await fetchApi<{ items: any[] }>(`/catalog/${path}?${qs.toString()}`);
        setHits(
          (res.items || []).map((it) => ({
            id: it.id,
            label: it.title || it.name || it.edition_name || it.id,
          }))
        );
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(handle);
  }, [q, rel.target_type, subtypeFilter]);

  return (
    <div className="p-4 rounded-lg bg-surface border border-black/10 dark:border-white/10 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
        <div className="md:col-span-3 space-y-1">
          <label className="text-xs font-mono text-gray-500">{t("editor.relations.roleLabel")}</label>
          <Select
            value={rel.relationship_type}
            onChange={(val) => {
              const next = filteredTypes.find((rt) => rt.code === val);
              const nextTargets = uniqueHubs(next?.allowed_target_types);
              updateRelationRow(idx, {
                relationship_type: val,
                target_type: nextTargets[0] || rel.target_type || "work",
              });
            }}
            className="font-mono"
            options={filteredTypes.map((rt) => {
              const label = locale.startsWith("zh")
                ? rt.name_zh || rt.names?.["zh-CN"] || rt.code
                : rt.name_en || rt.names?.["en-US"] || rt.name_zh || rt.code;
              return { value: rt.code, label: `${label} (${rt.code})` };
            })}
          />
        </div>

        <div className="md:col-span-2 space-y-1">
          <label className="text-xs font-mono text-gray-500">{t("editor.relations.targetTypeLabel")}</label>
          <Select
            value={catalogHubOf(rel.target_type)}
            onChange={(val) => updateRelationRow(idx, { target_type: val, target_id: "", target_label: "" })}
            className="font-mono"
            options={targetOptions.map((tp) => {
              const hubKey = `editor.relations.hub.${tp}`;
              const hubLabel = t(hubKey) !== hubKey ? t(hubKey) : tp;
              const extra = tp === "artist" && subtypeFilter ? ` · ${entityTypeLabel(subtypeFilter)}` : "";
              return { value: tp, label: `${hubLabel}${extra}` };
            })}
          />
        </div>

        <div className="md:col-span-6 space-y-1 relative">
          <label className="text-xs font-mono text-gray-500">{t("editor.relations.targetSearchLabel")}</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={rel.target_label || q}
              onChange={(e) => {
                setQ(e.target.value);
                updateRelationRow(idx, { target_label: e.target.value, target_id: rel.target_id });
              }}
              placeholder={t("editor.relations.targetSearchPlaceholder")}
              className="w-full pl-9 pr-3 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-primary"
            />
          </div>
          {hits.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-md border border-surfaceBorder bg-surface shadow-elevated overflow-hidden">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      updateRelationRow(idx, { target_id: h.id, target_label: h.label });
                      setQ("");
                      setHits([]);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-white hover:bg-black/[0.04] dark:hover:bg-white/10"
                  >
                    {h.label}
                    <span className="ml-2 font-mono text-[10px] text-gray-500">{h.id.slice(0, 8)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searching && <p className="text-[10px] font-mono text-gray-500">{t("editor.relations.searching")}</p>}
          <input
            type="text"
            required
            value={rel.target_id}
            onChange={(e) => updateRelationRow(idx, { target_id: e.target.value })}
            placeholder={t("editor.relations.targetIdPlaceholder")}
            className="w-full px-3 h-9 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-xs focus:outline-none focus:border-primary"
          />
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2.5 border-t border-black/5 dark:border-white/[0.06] items-center">
        <input
          type="text"
          value={rel.qualifier || ""}
          onChange={(e) => updateRelationRow(idx, { qualifier: e.target.value })}
          placeholder={t("editor.relations.qualifierPlaceholder")}
          className="w-full px-3 h-9 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-xs sm:text-sm focus:outline-none focus:border-primary"
        />
        <input
          type="text"
          value={rel.begin_date || ""}
          onChange={(e) => updateRelationRow(idx, { begin_date: e.target.value })}
          placeholder={t("editor.relations.beginPlaceholder")}
          className="w-full px-3 h-9 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-xs sm:text-sm focus:outline-none focus:border-primary"
        />
        <input
          type="text"
          value={rel.end_date || ""}
          onChange={(e) => updateRelationRow(idx, { end_date: e.target.value })}
          placeholder={t("editor.relations.endPlaceholder")}
          className="w-full px-3 h-9 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-xs sm:text-sm focus:outline-none focus:border-primary"
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`rel_ended_${idx}`}
            checked={rel.ended || false}
            onChange={(e) => updateRelationRow(idx, { ended: e.target.checked })}
            className="w-4 h-4 rounded bg-background border-black/10 dark:border-white/10 text-primary focus:ring-0 cursor-pointer"
          />
          <label htmlFor={`rel_ended_${idx}`} className="text-xs text-gray-500 font-mono cursor-pointer">
            {t("editor.relations.endedCheckbox")}
          </label>
        </div>
      </div>
    </div>
  );
}
