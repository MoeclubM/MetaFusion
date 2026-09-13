"use client";

import React, { useEffect, useState } from "react";
import { Layers, Plus, Eye, Edit2, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicNamesEditor, MultilingualBadges } from "@/components/common/DynamicNamesEditor";
import { Modal } from "@/components/ui/Modal";
import { fetchDefinitions } from "@/lib/definitions";
import type { DynamicDefinitions } from "@/lib/definitions";

export interface ShelfQuery {
  types?: string[];
  fields?: Record<string, string[]>;
  vocab_terms?: Record<string, string[]>;
  relations?: string[];
}

export interface ShelfItem {
  id: number;
  slug: string;
  names?: Record<string, string>;
  query: ShelfQuery;
  sort: string;
  icon: string;
  enabled: boolean;
  sort_order: number;
}

const EMPTY_NAMES = { "zh-CN": "", "zh-TW": "", "ja-JP": "", "en-US": "" };

function emptyShelf(count: number): Partial<ShelfItem> {
  return {
    slug: "",
    names: { ...EMPTY_NAMES },
    query: { types: [], fields: {}, vocab_terms: {}, relations: [] },
    sort: "updated",
    icon: "",
    enabled: true,
    sort_order: (count + 1) * 10,
  };
}

function describeRule(shelf: ShelfItem): string[] {
  const q = shelf.query || {};
  const parts: string[] = [];
  (q.types || []).forEach((x) => parts.push(`type:${x}`));
  Object.entries(q.fields || {}).forEach(([k, vs]) =>
    (vs || []).forEach((v) => parts.push(`${k}=${v}`)),
  );
  Object.entries(q.vocab_terms || {}).forEach(([k, vs]) =>
    (vs || []).forEach((v) => parts.push(`${k}:${v}`)),
  );
  (q.relations || []).forEach((x) => parts.push(`rel:${x}`));
  return parts;
}

export function ShelvesTab() {
  const { t } = useI18n();
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [defs, setDefs] = useState<DynamicDefinitions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShelfItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<ShelfItem>>(emptyShelf(0));
  const [typeInput, setTypeInput] = useState("");
  const [relInput, setRelInput] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldVal, setFieldVal] = useState("");
  const [vocabKey, setVocabKey] = useState("");
  const [vocabVal, setVocabVal] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/shelves", { credentials: "same-origin" }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body as { items: ShelfItem[] };
      });
      setItems(res.items || []);
    } catch (err: any) {
      setError(err.message || t("admin.shelves.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    fetchDefinitions().then((d) => setDefs(d)).catch(() => {});
  }, []);

  const openCreate = () => {
    setForm(emptyShelf(items.length));
    setTypeInput("");
    setRelInput("");
    setFieldKey("");
    setFieldVal("");
    setVocabKey("");
    setVocabVal("");
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (shelf: ShelfItem) => {
    const names: Record<string, string> = { ...(shelf.names || {}) };
    for (const k of Object.keys(EMPTY_NAMES)) {
      if (!(k in names)) names[k] = "";
    }
    setForm({
      ...shelf,
      names,
      query: {
        types: [...(shelf.query?.types || [])],
        fields: { ...(shelf.query?.fields || {}) },
        vocab_terms: { ...(shelf.query?.vocab_terms || {}) },
        relations: [...(shelf.query?.relations || [])],
      },
    });
    setTypeInput("");
    setRelInput("");
    setFieldKey("");
    setFieldVal("");
    setVocabKey("");
    setVocabVal("");
    setEditing(shelf);
    setCreating(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const names = { ...(form.names || {}) };
    const nameZh = (names["zh-CN"] || "").trim();
    const nameEn = (names["en-US"] || "").trim();
    if (!form.slug?.trim() || !nameZh || !nameEn) {
      setError(t("admin.shelves.required"));
      return;
    }
    const payload = {
      slug: form.slug.trim().toLowerCase(),
      names,
      query: {
        types: form.query?.types || [],
        fields: form.query?.fields || {},
        vocab_terms: form.query?.vocab_terms || {},
        relations: form.query?.relations || [],
      },
      sort: form.sort || "updated",
      icon: form.icon || "",
      enabled: form.enabled ?? true,
      sort_order: form.sort_order ?? 0,
    };
    try {
      if (editing) {
        await fetch(`/api/admin/shelves/${editing.id}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        });
      } else {
        await fetch("/api/admin/shelves", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        });
      }
      setCreating(false);
      setEditing(null);
      loadData();
    } catch (err: any) {
      setError(err.message || t("admin.shelves.saveFailed"));
    }
  };

  const handleDelete = async (shelf: ShelfItem) => {
    if (!window.confirm(t("admin.shelves.deleteConfirm", { slug: shelf.slug }))) return;
    setError(null);
    try {
      await fetch(`/api/admin/shelves/${shelf.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      });
      loadData();
    } catch (err: any) {
      setError(err.message || t("admin.shelves.deleteFailed"));
    }
  };

  const q = form.query || { types: [], fields: {}, vocab_terms: {}, relations: [] };
  const addType = () => {
    const v = typeInput.trim();
    if (!v || (q.types || []).includes(v)) return;
    setForm({ ...form, query: { ...q, types: [...(q.types || []), v] } });
    setTypeInput("");
  };
  const addRelation = () => {
    const v = relInput.trim();
    if (!v || (q.relations || []).includes(v)) return;
    setForm({ ...form, query: { ...q, relations: [...(q.relations || []), v] } });
    setRelInput("");
  };
  const addFieldPair = () => {
    const k = fieldKey.trim();
    const v = fieldVal.trim();
    if (!k || !v) return;
    const cur = { ...(q.fields || {}) };
    cur[k] = [...(cur[k] || []), ...(cur[k] || []).includes(v) ? [] : [v]];
    setForm({ ...form, query: { ...q, fields: cur } });
    setFieldVal("");
  };
  const addVocabPair = () => {
    const k = vocabKey.trim();
    const v = vocabVal.trim();
    if (!k || !v) return;
    const cur = { ...(q.vocab_terms || {}) };
    cur[k] = [...(cur[k] || []), ...(cur[k] || []).includes(v) ? [] : [v]];
    setForm({ ...form, query: { ...q, vocab_terms: cur } });
    setVocabVal("");
  };

  const typeOptions = Object.keys(defs?.types || {});
  const relationOptions = Object.keys(defs?.relations || {});
  const fieldOptions = Object.keys(defs?.fields || {});
  const vocabOptions = Object.keys(defs?.vocabularies || {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            {t("admin.shelves.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
            {t("admin.shelves.subtitle")}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 rounded-lg bg-emerald-400 text-black text-xs font-semibold hover:bg-emerald-300 transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("admin.shelves.new")}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-xs font-mono">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-[#0e0e12] overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.02] border-b border-white/10 text-gray-400 text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.shelves.colSlug")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colNames")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colRule")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colSort")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colIcon")}</th>
              <th className="py-3 px-3 text-center">{t("admin.shelves.colEnabled")}</th>
              <th className="py-3 px-3">{t("admin.shelves.colOrder")}</th>
              <th className="py-3 px-4 text-right">{t("admin.shelves.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.shelves.noData")}
                </td>
              </tr>
            ) : (
              items.map((shelf) => {
                const rule = describeRule(shelf);
                return (
                  <tr key={shelf.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4 font-mono text-emerald-300 font-bold">{shelf.slug}</td>
                    <td className="py-3 px-3">
                      <MultilingualBadges names={shelf.names} />
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {rule.length === 0 ? (
                          <span className="text-gray-500 font-mono text-[10px]">{t("admin.shelves.emptyRule")}</span>
                        ) : (
                          rule.map((r) => (
                            <span
                              key={r}
                              className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-mono"
                            >
                              {r}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-gray-300">{shelf.sort || "updated"}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-gray-300">{shelf.icon || "—"}</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`w-2 h-2 inline-block rounded-full ${shelf.enabled ? "bg-emerald-400" : "bg-gray-600"}`} />
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-400">{shelf.sort_order ?? 0}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <a
                          href={`/explore?shelf=${encodeURIComponent(shelf.slug)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                          title={t("admin.shelves.viewShelf")}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => openEdit(shelf)}
                          className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                          title={t("common.edit")}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(shelf)}
                          className="p-1.5 rounded-md hover:bg-rose-500/10 text-gray-400 hover:text-rose-400 transition-colors"
                          title={t("common.delete")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={creating || !!editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? t("admin.shelves.editTitle") : t("admin.shelves.createTitle")}
        icon={<Layers className="w-4 h-4 text-emerald-400" />}
      >
        <form onSubmit={handleSave} className="space-y-4 text-xs max-h-[80vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-[11px] font-mono text-gray-300 font-medium mb-1">
              {t("admin.shelves.fieldSlug")}
            </label>
            <input
              required
              disabled={!!editing}
              value={form.slug || ""}
              onChange={(e) =>
                setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "") })
              }
              placeholder="e.g. music"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white font-mono focus:outline-none focus:border-emerald-400 disabled:opacity-50"
            />
          </div>

          <DynamicNamesEditor
            label={t("admin.shelves.colNames")}
            value={form.names}
            onChange={(names) => setForm({ ...form, names })}
            required
          />

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="font-mono text-xs font-bold text-gray-300">
              {t("admin.shelves.queryTypes")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(q.types || []).map((x) => (
                <span key={x} className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-mono flex items-center gap-1">
                  {x}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, query: { ...q, types: (q.types || []).filter((y) => y !== x) } })}
                    className="hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                list="shelf-type-options"
                value={typeInput}
                onChange={(e) => setTypeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addType(); } }}
                placeholder="e.g. music"
                className="flex-1 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-xs text-white font-mono focus:border-emerald-400 outline-none"
              />
              <datalist id="shelf-type-options">
                {typeOptions.map((x) => (<option key={x} value={x} />))}
              </datalist>
              <button type="button" onClick={addType} className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-xs">
                +
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="font-mono text-xs font-bold text-gray-300">
              {t("admin.shelves.queryFields")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(q.fields || {}).flatMap(([k, vs]) =>
                (vs || []).map((v) => (
                  <span key={`${k}=${v}`} className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 text-xs font-mono flex items-center gap-1">
                    {k}={v}
                    <button
                      type="button"
                      onClick={() => {
                        const cur = { ...(q.fields || {}) };
                        cur[k] = (cur[k] || []).filter((y) => y !== v);
                        if (cur[k].length === 0) delete cur[k];
                        setForm({ ...form, query: { ...q, fields: cur } });
                      }}
                      className="hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                )),
              )}
            </div>
            <div className="flex gap-2">
              <input
                list="shelf-field-options"
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
                placeholder="field"
                className="flex-1 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-xs text-white font-mono focus:border-emerald-400 outline-none"
              />
              <datalist id="shelf-field-options">
                {fieldOptions.map((x) => (<option key={x} value={x} />))}
              </datalist>
              <input
                value={fieldVal}
                onChange={(e) => setFieldVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFieldPair(); } }}
                placeholder="value"
                className="flex-1 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-xs text-white font-mono focus:border-emerald-400 outline-none"
              />
              <button type="button" onClick={addFieldPair} className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-xs">
                +
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="font-mono text-xs font-bold text-gray-300">
              {t("admin.shelves.queryVocabTerms")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(q.vocab_terms || {}).flatMap(([k, vs]) =>
                (vs || []).map((v) => (
                  <span key={`${k}:${v}`} className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-mono flex items-center gap-1">
                    {k}:{v}
                    <button
                      type="button"
                      onClick={() => {
                        const cur = { ...(q.vocab_terms || {}) };
                        cur[k] = (cur[k] || []).filter((y) => y !== v);
                        if (cur[k].length === 0) delete cur[k];
                        setForm({ ...form, query: { ...q, vocab_terms: cur } });
                      }}
                      className="hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                )),
              )}
            </div>
            <div className="flex gap-2">
              <input
                list="shelf-vocab-options"
                value={vocabKey}
                onChange={(e) => setVocabKey(e.target.value)}
                placeholder="vocab"
                className="flex-1 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-xs text-white font-mono focus:border-emerald-400 outline-none"
              />
              <datalist id="shelf-vocab-options">
                {vocabOptions.map((x) => (<option key={x} value={x} />))}
              </datalist>
              <input
                list={vocabKey ? `shelf-term-options-${vocabKey}` : undefined}
                value={vocabVal}
                onChange={(e) => setVocabVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVocabPair(); } }}
                placeholder="term"
                className="flex-1 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-xs text-white font-mono focus:border-emerald-400 outline-none"
              />
              {vocabKey && defs?.vocabularies?.[vocabKey] && (
                <datalist id={`shelf-term-options-${vocabKey}`}>
                  {Object.keys(defs.vocabularies[vocabKey].terms || {}).map((x) => (<option key={x} value={x} />))}
                </datalist>
              )}
              <button type="button" onClick={addVocabPair} className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-xs">
                +
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="font-mono text-xs font-bold text-gray-300">
              {t("admin.shelves.queryRelations")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(q.relations || []).map((x) => (
                <span key={x} className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 text-xs font-mono flex items-center gap-1">
                  {x}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, query: { ...q, relations: (q.relations || []).filter((y) => y !== x) } })}
                    className="hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                list="shelf-relation-options"
                value={relInput}
                onChange={(e) => setRelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRelation(); } }}
                placeholder="e.g. adaptation_of"
                className="flex-1 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-xs text-white font-mono focus:border-emerald-400 outline-none"
              />
              <datalist id="shelf-relation-options">
                {relationOptions.map((x) => (<option key={x} value={x} />))}
              </datalist>
              <button type="button" onClick={addRelation} className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-xs">
                +
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-300 font-medium mb-1">
                {t("admin.shelves.fieldSort")}
              </label>
              <select
                value={form.sort || "updated"}
                onChange={(e) => setForm({ ...form, sort: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-emerald-400"
              >
                <option value="updated">{t("admin.shelves.sortUpdated")}</option>
                <option value="created">{t("admin.shelves.sortCreated")}</option>
                <option value="title">{t("admin.shelves.sortTitle")}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-300 font-medium mb-1">
                {t("admin.shelves.fieldIcon")}
              </label>
              <input
                value={form.icon || ""}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="e.g. Disc"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-300 font-medium mb-1">
                {t("admin.shelves.fieldOrder")}
              </label>
              <input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white font-mono focus:outline-none focus:border-emerald-400"
              />
            </div>
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer pb-1 self-end">
              <input
                type="checkbox"
                checked={form.enabled ?? true}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-0"
              />
              <span className="text-xs">{t("admin.shelves.enabledOpt")}</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-emerald-400 text-black font-semibold hover:bg-emerald-300 transition-colors"
            >
              {t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
