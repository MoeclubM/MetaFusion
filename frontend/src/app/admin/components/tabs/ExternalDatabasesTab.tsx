"use client";

import React, { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Check, X, Globe, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import {
  fetchAdminExternalDatabases,
  createExternalDatabase,
  updateExternalDatabase,
  deleteExternalDatabase,
  ExternalDatabaseDefinition,
} from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export function ExternalDatabasesTab() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ExternalDatabaseDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<Partial<ExternalDatabaseDefinition>>({
    code: "",
    name_zh: "",
    name_en: "",
    category: "all",
    url_pattern: "",
    icon: "Globe",
    icon_url: "",
    validation_regex: "",
    description: "",
    sort_order: 10,
    is_enabled: true,
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createExternalDatabase(form);
      setIsCreating(false);
      setForm({
        code: "",
        name_zh: "",
        name_en: "",
        category: "all",
        url_pattern: "",
        icon: "Globe",
        icon_url: "",
        validation_regex: "",
        description: "",
        sort_order: (items.length + 1) * 10,
        is_enabled: true,
      });
      loadData();
    } catch (err: any) {
      setError(err.message || "创建外部数据库配置失败");
    }
  };

  const handleUpdate = async (code: string, updates: Partial<ExternalDatabaseDefinition>) => {
    setError(null);
    try {
      await updateExternalDatabase(code, updates);
      setEditingCode(null);
      loadData();
    } catch (err: any) {
      setError(err.message || "更新外部数据库配置失败");
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
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Globe className="w-5 h-5 text-sky-400" />
            <span>外部数据库关联与预设管理 (External Authority Databases)</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            动态定义与维护全站支持的权威外部数据库与外部标识符（如 MusicBrainz, Bangumi, IMDb, TMDB, VNDB 等）。实体关联外链与编辑校验完全由本表驱动，无需硬编码。
          </p>
        </div>

        <button
          onClick={() => {
            setIsCreating(!isCreating);
            setEditingCode(null);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs transition-colors shadow-xs"
        >
          {isCreating ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          <span>{isCreating ? "取消添加" : "添加外部数据库"}</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* 新增表单 */}
      {isCreating && (
        <form onSubmit={handleCreate} className="p-5 rounded-xl border border-sky-500/30 bg-sky-500/[0.03] space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-400 font-mono">
            <Sparkles className="w-4 h-4" />
            <span>新增外部权威数据库定义</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">数据库代码 (Code / ID) *</label>
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
                placeholder="如: musicbrainz, vndb, steam"
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">中文名称 (Name ZH) *</label>
              <input
                type="text"
                required
                value={form.name_zh}
                onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                placeholder="如: MusicBrainz"
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">英文名称 (Name EN) *</label>
              <input
                type="text"
                required
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                placeholder="如: MusicBrainz"
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">适用实体范畴 (Category)</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-sky-400"
              >
                <option value="all">通用 (All Entities)</option>
                <option value="work">作品 (Work)</option>
                <option value="artist">创作者/声优 (Artist / Person)</option>
                <option value="release">发行版 (Release)</option>
                <option value="franchise">系列 (Franchise)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">
                外链 URL 模板 (URL Pattern) * (使用 {"{id}"} 占位符)
              </label>
              <input
                type="text"
                required
                value={form.url_pattern}
                onChange={(e) => setForm({ ...form, url_pattern: e.target.value })}
                placeholder="如: https://musicbrainz.org/release-group/{id}"
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">ID 校验正则 (Validation Regex)</label>
              <input
                type="text"
                value={form.validation_regex}
                onChange={(e) => setForm({ ...form, validation_regex: e.target.value })}
                placeholder="如: ^[0-9a-f]{8}-[0-9a-f]{4}... 或 ^tt\d+$"
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">图标 URL / Logo (可选)</label>
              <input
                type="text"
                value={form.icon_url}
                onChange={(e) => setForm({ ...form, icon_url: e.target.value })}
                placeholder="https://.../logo.png"
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">描述与说明 (Description)</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="简要说明其用途与格式要求"
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-gray-400 mb-1">排序权重 (Sort Order)</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-4 py-1.5 rounded-lg border border-white/10 text-xs text-gray-300 hover:bg-white/5 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs transition-colors"
            >
              创建定义
            </button>
          </div>
        </form>
      )}

      {/* 列表表格 */}
      <div className="rounded-xl border border-white/10 bg-[#0e0e12] overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02] font-mono text-[11px] text-gray-400 uppercase tracking-wider">
              <th className="py-3 px-4">数据库 / 代码</th>
              <th className="py-3 px-4">适用范围</th>
              <th className="py-3 px-4">外链 URL 模板</th>
              <th className="py-3 px-4">校验正则</th>
              <th className="py-3 px-4 text-center">排序</th>
              <th className="py-3 px-4 text-center">状态</th>
              <th className="py-3 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-500 font-mono">
                  加载外部数据库配置中...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-500 font-mono">
                  暂无外部数据库配置项
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isEditing = editingCode === item.code;
                return (
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
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            <span>{locale === "zh-CN" ? item.name_zh : item.name_en}</span>
                            {item.is_system && (
                              <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-mono bg-sky-500/10 text-sky-300 border border-sky-500/20">
                                系统内置
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-gray-400">{item.code}</div>
                        </div>
                      </div>
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

                    {/* 启用状态 */}
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => handleUpdate(item.code, { is_enabled: !item.is_enabled })}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                          item.is_enabled
                            ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                            : "bg-rose-500/10 border border-rose-500/30 text-rose-400"
                        }`}
                      >
                        {item.is_enabled ? "已启用" : "已禁用"}
                      </button>
                    </td>

                    {/* 操作 */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!item.is_system && (
                          <button
                            onClick={() => handleDelete(item.code)}
                            title="删除此规则"
                            className="p-1.5 rounded-md hover:bg-rose-500/10 text-gray-400 hover:text-rose-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
