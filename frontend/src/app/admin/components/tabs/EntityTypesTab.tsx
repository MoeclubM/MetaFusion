"use client";

import React, { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, ShieldAlert, Sparkles, Tag, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicNamesEditor, MultilingualBadges } from "@/components/common/DynamicNamesEditor";
import { Modal } from "@/components/ui/Modal";

export interface EntityTypeItem {
  code: string;
  name_zh: string;
  name_en: string;
  names?: Record<string, string>;
  desc_zh?: string;
  desc_en?: string;
  color: string;
  bg_color: string;
  border_color: string;
  sort_order: number;
}

export function EntityTypesTab() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<EntityTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<EntityTypeItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<Partial<EntityTypeItem>>({
    code: "",
    name_zh: "",
    name_en: "",
    names: { "zh-CN": "", "en-US": "" },
    desc_zh: "",
    desc_en: "",
    color: "text-amber-400",
    bg_color: "bg-amber-500/10",
    border_color: "border-amber-500/30",
    sort_order: 10,
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

  const handleOpenCreate = () => {
    setForm({
      code: "",
      name_zh: "",
      name_en: "",
      names: { "zh-CN": "", "en-US": "" },
      desc_zh: "",
      desc_en: "",
      color: "text-amber-400",
      bg_color: "bg-amber-500/10",
      border_color: "border-amber-500/30",
      sort_order: (items.length + 1) * 10,
    });
    setIsCreating(true);
  };

  const handleOpenEdit = (item: EntityTypeItem) => {
    const initialNames: Record<string, string> = { ...(item.names || {}) };
    if (!initialNames["zh-CN"] && item.name_zh) initialNames["zh-CN"] = item.name_zh;
    if (!initialNames["en-US"] && item.name_en) initialNames["en-US"] = item.name_en;

    setEditingItem(item);
    setForm({
      code: item.code,
      name_zh: item.name_zh,
      name_en: item.name_en,
      names: initialNames,
      desc_zh: item.desc_zh || "",
      desc_en: item.desc_en || "",
      color: item.color || "text-amber-400",
      bg_color: item.bg_color || "bg-amber-500/10",
      border_color: item.border_color || "border-amber-500/30",
      sort_order: item.sort_order ?? 0,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const names = { ...(form.names || {}) };
    const nameZh = names["zh-CN"] || form.name_zh || Object.values(names)[0] || "";
    const nameEn = names["en-US"] || form.name_en || nameZh;

    const payload = {
      ...form,
      name_zh: nameZh,
      name_en: nameEn,
      names,
    };

    try {
      if (editingItem) {
        await fetchApi(`/admin/entity-types/${encodeURIComponent(editingItem.code)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setEditingItem(null);
      } else {
        await fetchApi("/admin/entity-types", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setIsCreating(false);
      }
      loadData();
    } catch (err: any) {
      setError(err.message || (editingItem ? t("admin.entityTypes.updateFailed") : t("admin.entityTypes.createFailed")));
    }
  };

  const handleDelete = async (code: string) => {
    if (!window.confirm(t("admin.entityTypes.confirmDelete", { code }))) return;
    setError(null);
    try {
      await fetchApi(`/admin/entity-types/${encodeURIComponent(code)}`, {
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
          onClick={handleOpenCreate}
          className="px-3 py-1.5 rounded-lg bg-amber-400 text-black text-xs font-semibold hover:bg-amber-300 transition-colors flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("admin.entityTypes.new")}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-xs font-mono flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
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
              <th className="px-4 py-3 text-right">{t("admin.entityTypes.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-gray-300">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
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
                    <MultilingualBadges
                      names={item.names}
                      fallbackZh={item.name_zh}
                      fallbackEn={item.name_en}
                    />
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-[11px] text-gray-400 font-sans">
                    {locale === "en-US" ? item.desc_en || item.desc_zh : item.desc_zh || item.desc_en}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400">{item.sort_order}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenEdit(item)}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        title={t("common.edit")}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.code)}
                        className="p-1 rounded hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                        title={t("admin.entityTypes.delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 创建 / 编辑弹窗 */}
      <Modal
        open={isCreating || !!editingItem}
        onClose={() => {
          setIsCreating(false);
          setEditingItem(null);
        }}
        title={editingItem ? t("common.edit") : t("admin.entityTypes.createTitle")}
        icon={<Sparkles className="w-4 h-4 text-amber-400" />}
      >
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div>
            <label className="block text-[11px] font-mono text-gray-400 mb-1">
              {t("admin.entityTypes.codeLabel")}
            </label>
            <input
              type="text"
              required
              disabled={!!editingItem}
              placeholder={t("admin.entityTypes.codePlaceholder")}
              value={form.code || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                })
              }
              className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none disabled:opacity-50"
            />
          </div>

          <DynamicNamesEditor
            label={t("admin.entityTypes.colName")}
            value={form.names}
            onChange={(names) => setForm({ ...form, names })}
            required
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">
                {t("admin.entityTypes.descZhLabel")}
              </label>
              <input
                type="text"
                placeholder={t("admin.entityTypes.descZhPlaceholder")}
                value={form.desc_zh || ""}
                onChange={(e) => setForm({ ...form, desc_zh: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">
                {t("admin.entityTypes.descEnLabel")}
              </label>
              <input
                type="text"
                placeholder={t("admin.entityTypes.descEnPlaceholder")}
                value={form.desc_en || ""}
                onChange={(e) => setForm({ ...form, desc_en: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">
                {t("admin.entityTypes.sortOrderLabel")}
              </label>
              <input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) =>
                  setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">
                {t("admin.entityTypes.colorLabel")}
              </label>
              <input
                type="text"
                value={form.color || ""}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">
                {t("admin.entityTypes.bgColorLabel")}
              </label>
              <input
                type="text"
                value={form.bg_color || ""}
                onChange={(e) => setForm({ ...form, bg_color: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">
                {t("admin.entityTypes.borderColorLabel")}
              </label>
              <input
                type="text"
                value={form.border_color || ""}
                onChange={(e) => setForm({ ...form, border_color: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setEditingItem(null);
              }}
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
      </Modal>
    </div>
  );
}
