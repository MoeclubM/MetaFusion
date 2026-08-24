"use client";

import React, { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Globe, ExternalLink, Sparkles, X } from "lucide-react";
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
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ExternalDatabaseDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<ExternalDatabaseDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<Partial<ExternalDatabaseDefinition>>({
    code: "",
    name_zh: "",
    name_en: "",
    names: { "zh-CN": "", "en-US": "" },
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
      setError(err.message || "加载外部数据库预设失败");
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
        await updateExternalDatabase(editingItem.code, payload);
        setEditingItem(null);
      } else {
        await createExternalDatabase(payload);
        setIsCreating(false);
      }
      loadData();
    } catch (err: any) {
      setError(err.message || (editingItem ? "更新配置失败" : "创建配置失败"));
    }
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`确定要删除外部数据库定义 [${code}] 吗？`)) return;
    setError(null);
    try {
      await deleteExternalDatabase(code);
      loadData();
    } catch (err: any) {
      setError(err.message || "删除失败");
    }
  };

  return (
    <div className="space-y-6">
      {/* 标题说明 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-sky-400" />
            <span>外部权威数据库预设管理 (External Authority Databases)</span>
          </h2>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            动态定义与维护全站支持的权威外部数据库与外部标识符（如 MusicBrainz, Bangumi, IMDb, TMDB, VNDB 等）。实体关联外链与编辑校验完全由本表驱动，无需硬编码。
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs transition-colors shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新建外部数据库</span>
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
              <th className="py-3 px-4">数据库 / 代码</th>
              <th className="py-3 px-4">多语言名称</th>
              <th className="py-3 px-4">适用范围</th>
              <th className="py-3 px-4">外链 URL 模板</th>
              <th className="py-3 px-4">校验正则</th>
              <th className="py-3 px-4 text-center">排序</th>
              <th className="py-3 px-4 text-right">操作</th>
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
                  暂无外部数据库配置项
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
                        title="编辑配置"
                        className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.code)}
                        title="删除此规则"
                        className="p-1.5 rounded-md hover:bg-rose-500/10 text-gray-400 hover:text-rose-400 transition-colors"
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
        title={editingItem ? t("common.edit") : "新建外部数据库预设"}
        icon={<Globe className="w-4 h-4 text-sky-400" />}
      >
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                唯一代码标识 (Code) *
              </label>
              <input
                type="text"
                required
                disabled={!!editingItem}
                placeholder="例如: musicbrainz, bangumi..."
                value={form.code || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                  })
                }
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-sky-400 outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                适用实体范畴 (Category) *
              </label>
              <select
                value={form.category || "all"}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-sky-400 outline-none"
              >
                <option value="all">全实体通用 (All)</option>
                <option value="work">作品 (Work)</option>
                <option value="artist">创作者与主体 (Artist)</option>
                <option value="release">发行版本 (Release)</option>
                <option value="franchise">企划世界观 (Franchise)</option>
                <option value="canonical_entry">典范篇目 (Canonical Entry / Expression)</option>
              </select>
            </div>
          </div>

          <DynamicNamesEditor
            label="多语言展示名 (Display Names)"
            value={form.names}
            onChange={(names) => setForm({ ...form, names })}
            required
          />

          <div>
            <label className="block text-gray-400 font-mono text-[11px] mb-1">
              外链目标 URL 格式模版 (URL Pattern) *
            </label>
            <input
              type="text"
              required
              placeholder="例如: https://musicbrainz.org/release/{id}"
              value={form.url_pattern || ""}
              onChange={(e) => setForm({ ...form, url_pattern: e.target.value })}
              className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-sky-400 outline-none"
            />
            <p className="text-[10px] text-gray-500 mt-1 font-mono">
              支持在 URL 中使用 &#123;id&#125; 作为填入 ID 的插值占位符。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                ID 校验正则表达式 (Validation Regex)
              </label>
              <input
                type="text"
                placeholder="例如: ^[0-9a-f-]{36}$"
                value={form.validation_regex || ""}
                onChange={(e) => setForm({ ...form, validation_regex: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-sky-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                图标 URL / SVG (Icon URL)
              </label>
              <input
                type="text"
                placeholder="https://..."
                value={form.icon_url || ""}
                onChange={(e) => setForm({ ...form, icon_url: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-sky-400 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                描述说明 (Description)
              </label>
              <input
                type="text"
                placeholder="简要说明"
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:border-sky-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-400 font-mono text-[11px] mb-1">
                排序权重 (Sort Order)
              </label>
              <input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) =>
                  setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })
                }
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-sky-400 outline-none"
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
