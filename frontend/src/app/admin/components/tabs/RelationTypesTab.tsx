"use client";

import React, { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Network, Sparkles, ArrowRight, ArrowLeftRight, Check, X, ShieldAlert } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicNamesEditor, MultilingualBadges } from "@/components/common/DynamicNamesEditor";
import { Modal } from "@/components/ui/Modal";

export interface RelationTypeItem {
  code: string;
  domain: string;
  name_zh: string;
  name_en: string;
  names?: Record<string, string>;
  description?: string;
  forward_label_zh: string;
  reverse_label_zh: string;
  forward_label_en: string;
  reverse_label_en: string;
  allowed_source_types?: string[];
  allowed_target_types?: string[];
  is_symmetric: boolean;
  is_hierarchical: boolean;
  color?: string;
  icon?: string;
  sort_order: number;
  is_system?: boolean;
  is_enabled: boolean;
}

const DOMAIN_OPTIONS = [
  { value: "work_work", label: "作品 ↔ 作品 (Work-Work)" },
  { value: "work_franchise", label: "作品 ↔ 企划宇宙 (Work-Franchise)" },
  { value: "work_artist", label: "作品 ↔ 创作者/机构 (Work-Artist)" },
  { value: "artist_artist", label: "创作者 ↔ 创作者 (Artist-Artist)" },
  { value: "character_work", label: "角色 ↔ 作品 (Character-Work)" },
];

export function RelationTypesTab() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<RelationTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<RelationTypeItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [form, setForm] = useState<Partial<RelationTypeItem>>({
    code: "",
    domain: "work_work",
    name_zh: "",
    name_en: "",
    names: { "zh-CN": "", "en-US": "" },
    description: "",
    forward_label_zh: "",
    reverse_label_zh: "",
    forward_label_en: "",
    reverse_label_en: "",
    allowed_source_types: ["work"],
    allowed_target_types: ["work"],
    is_symmetric: false,
    is_hierarchical: true,
    color: "sky",
    icon: "Link",
    sort_order: 10,
    is_enabled: true,
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApi<{ items: RelationTypeItem[] }>("/admin/relation-types");
      setItems(res.items || []);
    } catch (err: any) {
      setError(err.message || t("admin.relationTypes.loadFailed"));
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
      domain: "work_work",
      name_zh: "",
      name_en: "",
      names: { "zh-CN": "", "en-US": "" },
      description: "",
      forward_label_zh: "",
      reverse_label_zh: "",
      forward_label_en: "",
      reverse_label_en: "",
      allowed_source_types: ["work"],
      allowed_target_types: ["work"],
      is_symmetric: false,
      is_hierarchical: true,
      color: "sky",
      icon: "Link",
      sort_order: (items.length + 1) * 10,
      is_enabled: true,
    });
    setIsCreating(true);
  };

  const handleOpenEdit = (item: RelationTypeItem) => {
    setEditingItem(item);
    setForm({
      ...item,
      names: item.names || { "zh-CN": item.name_zh, "en-US": item.name_en },
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        ...form,
        name_zh: form.names?.["zh-CN"] || form.name_zh,
        name_en: form.names?.["en-US"] || form.name_en,
      };

      if (isCreating) {
        await fetchApi("/admin/relation-types", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (editingItem) {
        await fetchApi(`/admin/relation-types/${editingItem.code}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }

      setIsCreating(false);
      setEditingItem(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || t("admin.relationTypes.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (code: string) => {
    if (!confirm(t("admin.relationTypes.confirmDelete", { code }))) return;
    try {
      await fetchApi(`/admin/relation-types/${code}`, { method: "DELETE" });
      await loadData();
    } catch (err: any) {
      alert(err.message || t("admin.relationTypes.deleteFailed"));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/[0.02] p-5 rounded-2xl border border-white/[0.06]">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Network className="w-5 h-5 text-amber-400" />
            <span>{t("admin.relationTypes.title")}</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {t("admin.relationTypes.desc")}
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-400 text-black font-semibold text-xs hover:bg-amber-300 transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>{t("admin.relationTypes.new")}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* List / Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500 text-xs font-mono">
          {t("common.loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-xs font-mono">
          {t("admin.relationTypes.noData")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => {
            const displayName =
              (locale === "en-US" ? it.name_en : it.name_zh) || it.name_zh || it.name_en || it.code;
            const forwardLabel = (locale === "en-US" ? it.forward_label_en : it.forward_label_zh) || it.forward_label_zh;
            const reverseLabel = (locale === "en-US" ? it.reverse_label_en : it.reverse_label_zh) || it.reverse_label_zh;

            return (
              <div
                key={it.code}
                className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/10 transition-all flex flex-col justify-between space-y-4 group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-amber-400/10 text-amber-300 border border-amber-400/20 font-bold truncate">
                        {it.code}
                      </span>
                      {it.is_system && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-white/5 text-gray-400 border border-white/10">
                          {t("admin.relationTypes.systemBadge")}
                        </span>
                      )}
                    </div>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        it.is_enabled ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-gray-600"
                      }`}
                    />
                  </div>

                  <h3 className="font-bold text-sm text-white mb-1.5 flex items-center justify-between">
                    <span>{displayName}</span>
                    <span className="text-[10px] font-mono font-normal text-gray-500">{it.domain}</span>
                  </h3>

                  <p className="text-xs text-gray-400 line-clamp-2 mb-3 min-h-[32px]">
                    {it.description || t("admin.relationTypes.noDesc")}
                  </p>

                  <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between text-gray-400">
                      <span className="flex items-center gap-1.5 text-sky-400">
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>{forwardLabel || "-"}</span>
                      </span>
                      <span className="text-gray-600">|</span>
                      <span className="flex items-center gap-1.5 text-indigo-400">
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>{reverseLabel || "-"}</span>
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1 border-t border-white/5">
                      <span>{it.is_hierarchical ? t("admin.relationTypes.hierarchical") : t("admin.relationTypes.flat")}</span>
                      <span>{it.is_symmetric ? t("admin.relationTypes.symmetric") : t("admin.relationTypes.directional")}</span>
                    </div>
                  </div>

                  <div className="mt-3">
                    <MultilingualBadges names={it.names} />
                  </div>
                </div>

                <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
                  <span className="font-mono text-[10px] text-gray-500">
                    Order: #{it.sort_order}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEdit(it)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-white/[0.06] transition-colors"
                      title={t("common.edit")}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {!it.is_system && (
                      <button
                        onClick={() => handleDelete(it.code)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/[0.06] transition-colors"
                        title={t("common.delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {(isCreating || editingItem) && (
        <Modal
          open={true}
          onClose={() => {
            setIsCreating(false);
            setEditingItem(null);
          }}
          title={isCreating ? t("admin.relationTypes.modalNewTitle") : t("admin.relationTypes.modalEditTitle")}
        >
          <form onSubmit={handleSave} className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-gray-300 font-semibold mb-1.5">
                  {t("admin.relationTypes.fieldCode")} <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={!isCreating}
                  value={form.code || ""}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                  placeholder="e.g. prequel_of"
                  className="w-full h-10 px-3 rounded-xl bg-surface border border-theme text-xs font-mono text-foreground focus:outline-none focus:border-amber-400/50 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-gray-300 font-semibold mb-1.5">
                  {t("admin.relationTypes.fieldDomain")} <span className="text-amber-400">*</span>
                </label>
                <select
                  value={form.domain || "work_work"}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-surface border border-theme text-xs font-mono text-foreground focus:outline-none focus:border-amber-400/50"
                >
                  {DOMAIN_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value} className="bg-surface text-foreground">
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Multilingual Names */}
            <DynamicNamesEditor
              value={form.names}
              onChange={(nextNames) => {
                setForm({
                  ...form,
                  names: nextNames,
                  name_zh: nextNames["zh-CN"] || form.name_zh || "",
                  name_en: nextNames["en-US"] || form.name_en || "",
                });
              }}
              label={t("admin.relationTypes.fieldNameZh")}
            />

            {/* Forward / Reverse Labels */}
            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-3">
              <div className="font-mono text-xs font-bold text-gray-300 flex items-center gap-2">
                <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />
                <span>{t("admin.relationTypes.directionLabels")}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">
                    {t("admin.relationTypes.forwardLabelZh")} (A → B) <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.forward_label_zh || ""}
                    onChange={(e) => setForm({ ...form, forward_label_zh: e.target.value })}
                    placeholder="例如: 改编自"
                    className="w-full h-9 px-3 rounded-lg bg-surface border border-theme text-xs text-foreground focus:outline-none focus:border-amber-400/50"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">
                    {t("admin.relationTypes.reverseLabelZh")} (B → A) <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.reverse_label_zh || ""}
                    onChange={(e) => setForm({ ...form, reverse_label_zh: e.target.value })}
                    placeholder="例如: 被改编为"
                    className="w-full h-9 px-3 rounded-lg bg-surface border border-theme text-xs text-foreground focus:outline-none focus:border-amber-400/50"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">
                    {t("admin.relationTypes.forwardLabelEn")} (A → B) <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.forward_label_en || ""}
                    onChange={(e) => setForm({ ...form, forward_label_en: e.target.value })}
                    placeholder="e.g. Adaptation of"
                    className="w-full h-9 px-3 rounded-lg bg-surface border border-theme text-xs text-foreground focus:outline-none focus:border-amber-400/50"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-gray-400 mb-1">
                    {t("admin.relationTypes.reverseLabelEn")} (B → A) <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.reverse_label_en || ""}
                    onChange={(e) => setForm({ ...form, reverse_label_en: e.target.value })}
                    placeholder="e.g. Adapted as"
                    className="w-full h-9 px-3 rounded-lg bg-surface border border-theme text-xs text-foreground focus:outline-none focus:border-amber-400/50"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-gray-300 font-semibold mb-1.5">
                {t("admin.relationTypes.fieldDesc")}
              </label>
              <textarea
                rows={2}
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t("admin.relationTypes.fieldDescPlaceholder")}
                className="w-full p-3 rounded-xl bg-surface border border-theme text-xs text-foreground focus:outline-none focus:border-amber-400/50"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <label className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_hierarchical ?? true}
                  onChange={(e) => setForm({ ...form, is_hierarchical: e.target.checked })}
                  className="rounded text-amber-400 focus:ring-amber-400 h-4 w-4"
                />
                <span className="text-xs text-gray-300 font-mono">{t("admin.relationTypes.hierarchicalOpt")}</span>
              </label>

              <label className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_symmetric ?? false}
                  onChange={(e) => setForm({ ...form, is_symmetric: e.target.checked })}
                  className="rounded text-amber-400 focus:ring-amber-400 h-4 w-4"
                />
                <span className="text-xs text-gray-300 font-mono">{t("admin.relationTypes.symmetricOpt")}</span>
              </label>

              <label className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_enabled ?? true}
                  onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
                  className="rounded text-amber-400 focus:ring-amber-400 h-4 w-4"
                />
                <span className="text-xs text-gray-300 font-mono">{t("admin.relationTypes.enabledOpt")}</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setEditingItem(null);
                }}
                className="px-4 py-2 rounded-xl bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] text-xs font-mono transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-amber-400 text-black font-semibold text-xs hover:bg-amber-300 transition-colors disabled:opacity-50"
              >
                {submitting ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
