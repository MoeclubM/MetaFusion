"use client";

import React, { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Globe, Power } from "lucide-react";
import {
  fetchAdminExternalDatabases,
  createExternalDatabase,
  updateExternalDatabase,
  deleteExternalDatabase,
  ExternalDatabaseDefinition,
} from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicNamesEditor, MultilingualBadges } from "@/components/common/DynamicNamesEditor";
import { Modal } from "@/components/ui/Modal";

export function ExternalDatabasesTab() {
  const { t } = useI18n();
  const [items, setItems] = useState<ExternalDatabaseDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<ExternalDatabaseDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<Partial<ExternalDatabaseDefinition>>({
    code: "",
    name_zh: "",
    name_en: "",
    names: { "zh-CN": "", "zh-TW": "", "ja-JP": "", "en-US": "" },
    category: "all",
    url_pattern: "",
    icon: "Globe",
    icon_url: "",
    validation_regex: "",
    description: "",
    sort_order: 10,
  });
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminExternalDatabases();
      setItems(res.items || []);
    } catch (err: any) {
      setError(err.message || t("admin.extdb.loadFailed"));
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
      names: { "zh-CN": "", "zh-TW": "", "ja-JP": "", "en-US": "" },
      category: "all",
      url_pattern: "",
      icon: "Globe",
      icon_url: "",
      validation_regex: "",
      description: "",
      sort_order: (items.length + 1) * 10,
    });
    setIsCreating(true);
  };

  const handleOpenEdit = (item: ExternalDatabaseDefinition) => {
    const initialNames: Record<string, string> = { ...(item.names || {}) };
    for (const k of ["zh-CN", "zh-TW", "ja-JP", "en-US"]) {
      if (!(k in initialNames)) initialNames[k] = "";
    }
    if (!initialNames["zh-CN"] && item.name_zh) initialNames["zh-CN"] = item.name_zh;
    if (!initialNames["en-US"] && item.name_en) initialNames["en-US"] = item.name_en;

    setEditingItem(item);
    setForm({
      code: item.code,
      name_zh: item.name_zh,
      name_en: item.name_en,
      names: initialNames,
      category: item.category,
      url_pattern: item.url_pattern,
      icon: item.icon || "Globe",
      icon_url: item.icon_url || "",
      validation_regex: item.validation_regex || "",
      description: item.description || "",
      sort_order: item.sort_order ?? 0,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // names map 全语言回写：zh-CN/en-US 必填，zh-TW/ja-JP 选填；legacy 双列仅作回退。
    const names = { ...(form.names || {}) };
    const nameZh = (names["zh-CN"] || "").trim();
    const nameEn = (names["en-US"] || "").trim();
    if (!nameZh || !nameEn) {
      setError(t("admin.shelves.required"));
      return;
    }

    const payload = {
      ...form,
      name_zh: nameZh,
      name_en: nameEn,
      names,
    };

    try {
      if (editingItem) {
        await updateExternalDatabase(editingItem.code, payload);
        setEditingItem(null);
      } else {
        await createExternalDatabase(payload);
        setIsCreating(false);
      }
      loadData();
    } catch (err: any) {
      setError(err.message || (editingItem ? t("admin.extdb.updateFailed") : t("admin.extdb.createFailed")));
    }
  };

  const handleDelete = async (code: string) => {
    if (!confirm(t("admin.extdb.deleteConfirm", { code }))) return;
    setError(null);
    try {
      await deleteExternalDatabase(code);
      loadData();
    } catch (err: any) {
      setError(err.message || t("admin.alert.deleteFailed"));
    }
  };

  // 系统预设只能停用不能删除：走更新接口翻转 is_enabled。
  const handleToggleEnabled = async (item: ExternalDatabaseDefinition) => {
    setError(null);
    try {
      const names = { ...(item.names || {}) };
      await updateExternalDatabase(item.code, {
        ...item,
        names,
        is_enabled: !item.is_enabled,
      });
      loadData();
    } catch (err: any) {
      setError(err.message || t("admin.extdb.updateFailed"));
    }
  };

  return (
    <div className="space-y-6">
      {/* 标题说明 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-sky-400" />
            <span>{t("admin.extdb.title")}</span>
          </h2>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            {t("admin.extdb.desc")}
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs transition-colors shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("admin.extdb.new")}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-xs font-mono">
          {error}
        </div>
      )}

      {/* 列表表格 */}
      <div className="rounded-xl border border-white/10 bg-[#0e0e12] overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02] font-mono text-[11px] text-gray-400 uppercase tracking-wider">
              <th className="py-3 px-4">{t("admin.extdb.colDb")}</th>
              <th className="py-3 px-4">{t("admin.extdb.colNames")}</th>
              <th className="py-3 px-4">{t("admin.extdb.colScope")}</th>
              <th className="py-3 px-4">{t("admin.extdb.colUrl")}</th>
              <th className="py-3 px-4">{t("admin.extdb.colRegex")}</th>
              <th className="py-3 px-4 text-center">{t("admin.extdb.colSort")}</th>
              <th className="py-3 px-4 text-right">{t("admin.extdb.colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-500 font-mono">
                  {t("admin.extdb.noData")}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.code} className="hover:bg-white/[0.02] transition-colors">
                  {/* 名称与图标 */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      {item.icon_url ? (
                        <img src={item.icon_url} alt="" className="w-4 h-4 object-contain" />
                      ) : (
                        <Globe className="w-4 h-4 text-sky-400 opacity-80" />
                      )}
                      <div>
                        <div className="font-mono font-bold text-white text-[11px]">{item.code}</div>
                        {item.description && (
                          <div className="text-[10px] text-gray-500 line-clamp-1 max-w-[150px]">{item.description}</div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* 多语言胶囊展示 */}
                  <td className="py-3 px-4">
                    <MultilingualBadges
                      names={item.names}
                      fallbackZh={item.name_zh}
                      fallbackEn={item.name_en}
                    />
                  </td>

                  {/* 范畴 */}
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-white/[0.05] border border-white/10 text-gray-300">
                      {item.category.toUpperCase()}
                    </span>
                  </td>

                  {/* URL 模板 */}
                  <td className="py-3 px-4">
                    <div className="font-mono text-[11px] text-gray-300 truncate max-w-xs" title={item.url_pattern}>
                      {item.url_pattern}
                    </div>
                  </td>

                  {/* 校验正则 */}
                  <td className="py-3 px-4">
                    <div className="font-mono text-[10px] text-gray-400 truncate max-w-[120px]" title={item.validation_regex}>
                      {item.validation_regex || "--"}
                    </div>
                  </td>

                  {/* 排序 */}
                  <td className="py-3 px-4 text-center font-mono text-gray-400">
                    {item.sort_order}
                  </td>

                  {/* 操作 */}
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenEdit(item)}
                        title={t("common.edit")}
                        className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleEnabled(item)}
                        title={item.is_enabled ? t("admin.extdb.disable") : t("admin.extdb.enable")}
                        className={`p-1.5 rounded-md transition-colors ${
                          item.is_enabled
                            ? "hover:bg-amber-500/10 text-gray-400 hover:text-amber-400"
                            : "hover:bg-emerald-500/10 text-gray-500 hover:text-emerald-400"
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      {!item.is_system && (
                        <button
                          onClick={() => handleDelete(item.code)}
                          title={t("common.delete")}
                          className="p-1.5 rounded-md hover:bg-rose-500/10 text-gray-400 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {item.is_system && (
                      <div className="text-[10px] text-gray-500 font-mono mt-1">
                        {t("admin.extdb.systemProtected")}
                      </div>
                    )}
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
        title={editingItem ? t("common.edit") : t("admin.extdb.newPreset")}
        icon={<Globe className="w-4 h-4 text-sky-400" />}
      >
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                {t("admin.extdb.fieldCode")}
              </label>
              <input
                type="text"
                required
                disabled={!!editingItem}
                placeholder={t("admin.extdb.codePlaceholder")}
                value={form.code || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                  })
                }
                className="w-full bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                {t("admin.extdb.fieldCategory")}
              </label>
              <select
                value={form.category || "all"}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
              >
                <option value="all">{t("admin.extdb.catAll")}</option>
                <option value="work">{t("admin.extdb.catWork")}</option>
                <option value="artist">{t("admin.extdb.catArtist")}</option>
                <option value="release">{t("admin.extdb.catRelease")}</option>
                <option value="franchise">{t("admin.extdb.catFranchise")}</option>
                <option value="canonical_entry">{t("admin.extdb.catCanonical")}</option>
              </select>
            </div>
          </div>

          <DynamicNamesEditor
            label={t("admin.extdb.fieldNames")}
            value={form.names}
            onChange={(names) => setForm({ ...form, names })}
            required
          />

          <div>
            <label className="block text-gray-400 font-mono text-[11px] mb-1">
              {t("admin.extdb.fieldUrl")}
            </label>
            <input
              type="text"
              required
              placeholder={t("admin.extdb.urlPlaceholder")}
              value={form.url_pattern || ""}
              onChange={(e) => setForm({ ...form, url_pattern: e.target.value })}
              className="w-full bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
            />
            <p className="text-[10px] text-gray-500 mt-1 font-mono">
              {t("admin.extdb.urlHint")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                {t("admin.extdb.fieldRegex")}
              </label>
              <input
                type="text"
                placeholder={t("admin.extdb.regexPlaceholder")}
                value={form.validation_regex || ""}
                onChange={(e) => setForm({ ...form, validation_regex: e.target.value })}
                className="w-full bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                {t("admin.extdb.fieldIcon")}
              </label>
              <input
                type="text"
                placeholder="https://..."
                value={form.icon_url || ""}
                onChange={(e) => setForm({ ...form, icon_url: e.target.value })}
                className="w-full bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                {t("admin.extdb.fieldDesc")}
              </label>
              <input
                type="text"
                placeholder={t("admin.extdb.descPlaceholder")}
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground focus:border-sky-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                {t("admin.extdb.fieldSort")}
              </label>
              <input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) =>
                  setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
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
              className="px-4 py-1.5 rounded bg-sky-500 text-black text-xs font-bold font-mono hover:bg-sky-400 transition-colors"
            >
              {t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
