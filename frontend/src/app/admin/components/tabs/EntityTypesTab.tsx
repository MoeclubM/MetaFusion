"use client";

import React, { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Check, X, ShieldAlert, Sparkles, Tag } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export interface EntityTypeItem {
  code: string;
  name_zh: string;
  name_en: string;
  desc_zh?: string;
  desc_en?: string;
  color: string;
  bg_color: string;
  border_color: string;
  sort_order: number;
  is_system: boolean;
  is_enabled: boolean;
}

export function EntityTypesTab() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<EntityTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<Partial<EntityTypeItem>>({
    code: "",
    name_zh: "",
    name_en: "",
    desc_zh: "",
    desc_en: "",
    color: "text-amber-400",
    bg_color: "bg-amber-500/10",
    border_color: "border-amber-500/30",
    sort_order: 10,
    is_enabled: true,
  });
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApi<{ items: EntityTypeItem[] }>("/admin/entity-types");
      setItems(res.items || []);
    } catch (err: any) {
      setError(err.message || t("admin.entityTypes.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await fetchApi("/admin/entity-types", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setIsCreating(false);
      setForm({
        code: "",
        name_zh: "",
        name_en: "",
        desc_zh: "",
        desc_en: "",
        color: "text-amber-400",
        bg_color: "bg-amber-500/10",
        border_color: "border-amber-500/30",
        sort_order: (items.length + 1) * 10,
        is_enabled: true,
      });
      loadData();
    } catch (err: any) {
      setError(err.message || t("admin.entityTypes.createFailed"));
    }
  };

  const handleUpdate = async (code: string, updates: Partial<EntityTypeItem>) => {
    setError(null);
    try {
      await fetchApi(`/admin/entity-types/${code}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      setEditingCode(null);
      loadData();
    } catch (err: any) {
      setError(err.message || t("admin.entityTypes.updateFailed"));
    }
  };

  const handleDelete = async (code: string) => {
    if (!window.confirm(t("admin.entityTypes.confirmDelete", { code }))) return;
    setError(null);
    try {
      await fetchApi(`/admin/entity-types/${code}`, {
        method: "DELETE",
      });
      loadData();
    } catch (err: any) {
      setError(err.message || t("admin.entityTypes.deleteFailed"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Tag className="w-4 h-4 text-amber-400" />
            <span>{t("admin.entityTypes.title")}</span>
          </h2>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            {t("admin.entityTypes.subtitle")}
          </p>
        </div>
        <button
          onClick={() => {
            setIsCreating(!isCreating);
            setEditingCode(null);
          }}
          className="px-3 py-1.5 rounded-lg bg-amber-400 text-black text-xs font-semibold hover:bg-amber-300 transition-colors flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isCreating ? t("common.cancel") : t("admin.entityTypes.new")}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-xs font-mono flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 创建表单 */}
      {isCreating && (
        <form onSubmit={handleCreate} className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-4">
          <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t("admin.entityTypes.createTitle")}</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.codeLabel")}</label>
              <input
                type="text"
                required
                placeholder={t("admin.entityTypes.codePlaceholder")}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.nameZhLabel")}</label>
              <input
                type="text"
                required
                placeholder={t("admin.entityTypes.nameZhPlaceholder")}
                value={form.name_zh}
                onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.nameEnLabel")}</label>
              <input
                type="text"
                required
                placeholder={t("admin.entityTypes.nameEnPlaceholder")}
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.descZhLabel")}</label>
              <input
                type="text"
                placeholder={t("admin.entityTypes.descZhPlaceholder")}
                value={form.desc_zh}
                onChange={(e) => setForm({ ...form, desc_zh: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.descEnLabel")}</label>
              <input
                type="text"
                placeholder={t("admin.entityTypes.descEnPlaceholder")}
                value={form.desc_en}
                onChange={(e) => setForm({ ...form, desc_en: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.sortOrderLabel")}</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.colorLabel")}</label>
              <input
                type="text"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.bgColorLabel")}</label>
              <input
                type="text"
                value={form.bg_color}
                onChange={(e) => setForm({ ...form, bg_color: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">{t("admin.entityTypes.borderColorLabel")}</label>
              <input
                type="text"
                value={form.border_color}
                onChange={(e) => setForm({ ...form, border_color: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-mono"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded bg-amber-400 text-black text-xs font-bold font-mono hover:bg-amber-300 transition-colors"
            >
              {t("admin.entityTypes.save")}
            </button>
          </div>
        </form>
      )}

      {/* 列表渲染 */}
      <div className="border border-white/10 rounded-xl overflow-hidden bg-surface/30">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-white/[0.03] border-b border-white/10 text-gray-400 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="px-4 py-3">{t("admin.entityTypes.colCode")}</th>
              <th className="px-4 py-3">{t("admin.entityTypes.colName")}</th>
              <th className="px-4 py-3">{t("admin.entityTypes.colDesc")}</th>
              <th className="px-4 py-3 text-center">{t("admin.entityTypes.colSort")}</th>
              <th className="px-4 py-3 text-center">{t("admin.entityTypes.colSystem")}</th>
              <th className="px-4 py-3 text-center">{t("admin.entityTypes.colEnabled")}</th>
              <th className="px-4 py-3 text-right">{t("admin.entityTypes.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-gray-300">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {t("admin.entityTypes.noData")}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.code} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 font-semibold text-white">
                    <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-amber-300 text-[11px]">
                      {item.code}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-sans font-medium text-white">{item.name_zh}</div>
                    <div className="text-[10px] text-gray-400">{item.name_en}</div>
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-[11px] text-gray-400 font-sans">
                    {locale === "en-US" ? item.desc_en || item.desc_zh : item.desc_zh || item.desc_en}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400">{item.sort_order}</td>
                  <td className="px-4 py-3 text-center">
                    {item.is_system ? (
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 text-[10px] border border-sky-500/20">
                        {t("admin.entityTypes.system")}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[10px] border border-purple-500/20">
                        {t("admin.entityTypes.custom")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleUpdate(item.code, { is_enabled: !item.is_enabled })}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.is_enabled
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-gray-500/10 text-gray-500 border border-gray-500/20"
                      }`}
                    >
                      {item.is_enabled ? t("admin.entityTypes.enabled") : t("admin.entityTypes.disabled")}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {!item.is_system && (
                        <button
                          onClick={() => handleDelete(item.code)}
                          className="p-1 rounded hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                          title={t("admin.entityTypes.delete")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
