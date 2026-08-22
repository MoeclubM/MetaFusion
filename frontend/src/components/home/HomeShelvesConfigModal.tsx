"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchApi, UserCustomShelf } from "@/lib/api";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { Modal } from "@/components/ui/Modal";
import {
  GripVertical,
  Trash2,
  Plus,
  Globe,
  Lock,
  X,
  Save,
  RotateCcw,
  Sparkles,
  Pencil,
  Film,
  Tv,
  Music,
  BookOpen,
  Image as ImageIcon,
} from "lucide-react";

const SHELF_ICONS: Record<string, React.ElementType> = {
  video: Film,
  movies: Film,
  "anime-movies": Film,
  "feature-films": Film,
  series: Tv,
  "anime-series": Tv,
  "anime-hub": Film,
  music: Music,
  soundtracks: Music,
  classical: Music,
  audiobooks: Music,
  book: BookOpen,
  books: BookOpen,
  comic: ImageIcon,
  comics: ImageIcon,
  special: Sparkles,
};

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function HomeShelvesConfigModal({
  open,
  onClose,
  customShelves,
  orderKeys,
  onSaveLayout,
  onCreateCustom,
  onUpdateCustom,
  onDeleteCustom,
  onRefreshCustom,
  onResetDefaults,
  editShelfId,
}: {
  open: boolean;
  onClose: () => void;
  customShelves: UserCustomShelf[];
  orderKeys: string[];
  onSaveLayout: (hidden: string[], order: string[]) => Promise<void>;
  onCreateCustom: (payload: Partial<UserCustomShelf> & { slug: string; name_zh: string }) => Promise<void>;
  onUpdateCustom: (id: string, payload: Partial<UserCustomShelf>) => Promise<void>;
  onDeleteCustom: (id: string) => Promise<void>;
  onRefreshCustom: () => Promise<void>;
  onResetDefaults?: () => Promise<void>;
  editShelfId?: string | null;
}) {
  const { t, locale } = useI18n();
  const { taxonomy } = useTaxonomy();

  const [localOrder, setLocalOrder] = useState<string[]>(orderKeys);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Form state (for both Create & Edit)
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formSlug, setFormSlug] = useState("");
  const [formZh, setFormZh] = useState("");
  const [formEn, setFormEn] = useState("");
  const [formMedia, setFormMedia] = useState("all");
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formTagInput, setFormTagInput] = useState("");
  const [formRequireAll, setFormRequireAll] = useState(false);
  const [formPublic, setFormPublic] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [availableTags, setAvailableTags] = useState<{ name: string }[]>([]);

  useEffect(() => {
    setLocalOrder(orderKeys);
  }, [orderKeys]);

  // 外部指定要编辑的频道（如首页频道标题旁的铅笔入口），打开时直接进入编辑表单
  useEffect(() => {
    if (!open || !editShelfId) return;
    const target = customShelves.find((c) => c.id === editShelfId);
    if (target) openEditForm(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editShelfId]);

  useEffect(() => {
    if (!open) return;
    fetchApi<{ tag_groups?: Record<string, { name: string }[]>; tags?: { name: string }[] }>("/catalog/taxonomy")
      .then((data) => {
        if (data.tags) setAvailableTags(data.tags.map((t) => ({ name: t.name })));
        else if (data.tag_groups) {
          const all: { name: string }[] = [];
          Object.values(data.tag_groups).forEach((arr) => all.push(...arr));
          setAvailableTags(all);
        }
      })
      .catch(() => {});
  }, [open]);

  const customMap = new Map(customShelves.map((c) => [`custom:${c.id}`, c]));

  // Build ordered list of custom shelves
  const currentOrderedShelves = (() => {
    const list: UserCustomShelf[] = [];
    const seen = new Set<string>();

    localOrder.forEach((k) => {
      if (k.startsWith("custom:")) {
        const item = customMap.get(k);
        if (item && !seen.has(item.id)) {
          list.push(item);
          seen.add(item.id);
        }
      }
    });

    // append any custom shelves not in localOrder
    customShelves.forEach((c) => {
      if (!seen.has(c.id)) {
        list.push(c);
        seen.add(c.id);
      }
    });

    return list;
  })();

  const openCreateForm = () => {
    setEditingId(null);
    setFormSlug("");
    setFormZh("");
    setFormEn("");
    setFormMedia("all");
    setFormTags([]);
    setFormTagInput("");
    setFormRequireAll(false);
    setFormPublic(false);
    setFormOpen(true);
  };

  const openEditForm = (item: UserCustomShelf) => {
    setEditingId(item.id);
    setFormSlug(item.slug || "");
    setFormZh(item.name_zh || "");
    setFormEn(item.name_en || "");
    setFormMedia(item.media_type || "all");
    setFormTags(item.query_tags || []);
    setFormTagInput("");
    setFormRequireAll(!!item.require_all_tags);
    setFormPublic(!!item.is_public);
    setFormOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = formSlug.toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!slug || !formZh.trim()) return;

    setFormSubmitting(true);
    try {
      if (editingId) {
        // Update existing
        await onUpdateCustom(editingId, {
          slug,
          name_zh: formZh.trim(),
          name_en: formEn.trim(),
          media_type: formMedia,
          query_tags: formTags,
          require_all_tags: formRequireAll,
          is_public: formPublic,
        });
      } else {
        // Create new
        await onCreateCustom({
          slug,
          name_zh: formZh.trim(),
          name_en: formEn.trim(),
          media_type: formMedia,
          query_tags: formTags,
          require_all_tags: formRequireAll,
          is_public: formPublic,
        });
      }
      setFormOpen(false);
      await onRefreshCustom();
    } catch (err) {
      console.error("Form submit failed", err);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!confirm(t("home.shelves.syncPresetsConfirm"))) return;
    setResetting(true);
    try {
      if (onResetDefaults) {
        await onResetDefaults();
      } else {
        await fetchApi("/catalog/shelves/custom/reset-defaults", { method: "POST" });
        await onRefreshCustom();
      }
    } catch (e) {
      console.error("Reset defaults failed", e);
    } finally {
      setResetting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const finalOrder = currentOrderedShelves.map((c) => `custom:${c.id}`);
      await onSaveLayout([], finalOrder);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("shelf.configTitle")} maxWidth="max-w-2xl">
      <div className="space-y-4 text-xs">
        {/* Top Actions & Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("home.shelves.newGroup")}</span>
            </button>
            <span className="font-mono text-[11px] text-gray-500">
              {t("home.shelves.items", { count: currentOrderedShelves.length })}
            </span>
          </div>

          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={resetting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-xs font-medium transition-colors disabled:opacity-50"
            title={t("home.shelves.resetAllTip")}
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resetting ? "animate-spin" : ""}`} />
            <span>{t("shelf.resetDefault")}</span>
          </button>
        </div>

        {/* Modal / Inline Pop-up Form for Create/Edit */}
        {formOpen && (
          <form onSubmit={handleFormSubmit} className="p-4 rounded-xl border border-primary/30 bg-primary/[0.03] dark:bg-primary/[0.05] space-y-3 shadow-sm">
            <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-2">
              <h4 className="font-semibold text-gray-900 dark:text-white text-xs flex items-center gap-1.5">
                {editingId ? <Pencil className="w-3.5 h-3.5 text-primary" /> : <Plus className="w-3.5 h-3.5 text-primary" />}
                <span>{editingId ? t("home.shelves.editTitle") : t("home.shelves.newGroup")}</span>
              </h4>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-gray-600 dark:text-gray-400 text-[11px] mb-1">{t("home.shelves.nameZhLabel")}</label>
                <input
                  value={formZh}
                  onChange={(e) => setFormZh(e.target.value)}
                  placeholder={t("home.shelves.nameZhLabel")}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white text-xs focus:outline-none focus:border-primary/50"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-600 dark:text-gray-400 text-[11px] mb-1">{t("home.shelves.nameEnLabel")}</label>
                <input
                  value={formEn}
                  onChange={(e) => setFormEn(e.target.value)}
                  placeholder={t("home.shelves.nameEnLabel")}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white text-xs focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-gray-600 dark:text-gray-400 text-[11px] mb-1">{t("home.shelves.slugLabel")}</label>
                <input
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))}
                  placeholder={t("home.shelves.slugPlaceholder")}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-mono text-xs focus:outline-none focus:border-primary/50"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-600 dark:text-gray-400 text-[11px] mb-1">{t("home.shelves.mediaTypeLabel")}</label>
                <select
                  value={formMedia}
                  onChange={(e) => setFormMedia(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white text-xs focus:outline-none focus:border-primary/50 font-mono"
                >
                  <option value="all">{t("home.shelves.mediaAll")}</option>
                  {taxonomy?.media_types && taxonomy.media_types.length > 0
                    ? taxonomy.media_types.map((mt: any) => {
                        const label = mt.name || (locale === "en-US" ? mt.name_en : mt.name_zh) || mt.id;
                        return (
                          <option key={mt.id} value={mt.id}>
                            {label} ({mt.id})
                          </option>
                        );
                      })
                    : (
                      formMedia && formMedia !== "all" && (
                        <option value={formMedia}>{formMedia}</option>
                      )
                    )}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-gray-600 dark:text-gray-400 text-[11px] mb-1">{t("home.shelves.tagsLabel")}</label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 min-h-[36px]">
                {formTags.map((tag, idx) => (
                  <span key={idx} className="px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/20 text-xs font-mono flex items-center gap-1">
                    #{tag}
                    <button type="button" onClick={() => setFormTags(formTags.filter((_, i) => i !== idx))} className="hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={formTagInput}
                  onChange={(e) => setFormTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      const v = formTagInput.trim().replace(/^#/, "");
                      if (v && !formTags.includes(v)) setFormTags([...formTags, v]);
                      setFormTagInput("");
                    }
                  }}
                  placeholder={t("home.shelves.tagInputPlaceholder")}
                  className="bg-transparent text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none flex-1 min-w-[100px]"
                />
              </div>
              <div className="flex flex-wrap gap-1 pt-1.5">
                {availableTags.slice(0, 14).map((tItem) => (
                  <button
                    key={tItem.name}
                    type="button"
                    onClick={() => {
                      if (!formTags.includes(tItem.name)) setFormTags([...formTags, tItem.name]);
                    }}
                    className="px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.04] text-[10px] font-mono text-gray-500 hover:text-primary transition-colors"
                  >
                    + #{tItem.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={formRequireAll} onChange={(e) => setFormRequireAll(e.target.checked)} className="rounded" />
                  <span className="text-[11px]">{t("home.shelves.requireAll")}</span>
                </label>
                <label className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={formPublic} onChange={(e) => setFormPublic(e.target.checked)} className="rounded" />
                  <span className="text-[11px]">{t("home.shelves.publicShare")}</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 text-xs"
                >
                  {t("home.shelves.editCancel")}
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-3.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50"
                >
                  {formSubmitting ? t("home.shelves.saving") : editingId ? t("home.shelves.editSave") : t("admin.shelfModal.save")}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Single Unified Channel List */}
        <div className="space-y-1.5">
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] divide-y divide-black/5 dark:divide-white/[0.06] max-h-[44vh] overflow-auto">
            {currentOrderedShelves.length === 0 ? (
              <div className="p-8 text-center text-gray-500 font-mono text-xs space-y-2">
                <p>{t("home.shelves.emptyCustom")}</p>
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t("home.shelves.restorePresets")}</span>
                </button>
              </div>
            ) : (
              currentOrderedShelves.map((shelf, idx) => {
                const label = locale === "en-US" && shelf.name_en ? shelf.name_en : shelf.name_zh;
                const Icon = SHELF_ICONS[shelf.slug] || SHELF_ICONS[shelf.media_type] || Sparkles;

                return (
                  <div
                    key={shelf.id}
                    draggable
                    onDragStart={() => setDragFrom(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom === null || dragFrom === idx) return;
                      const next = arrayMove(currentOrderedShelves, dragFrom, idx);
                      setLocalOrder(next.map((s) => `custom:${s.id}`));
                      setDragFrom(null);
                    }}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="cursor-grab text-gray-400 hover:text-gray-700 dark:hover:text-white" title={t("home.shelves.dragOrderTip")}>
                      <GripVertical className="w-3.5 h-3.5" />
                    </span>

                    <div className="w-6 h-6 rounded bg-primary/10 border border-primary/20 grid place-items-center shrink-0">
                      <Icon className="w-3.5 h-3.5 text-primary" strokeWidth={1.8} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-gray-900 dark:text-white font-medium text-xs">{label}</span>
                        <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">/{shelf.slug}</span>
                        {shelf.media_type && shelf.media_type !== "all" && (
                          <span className="px-1.5 py-0.2 rounded bg-black/[0.04] dark:bg-white/[0.06] text-[10px] font-mono text-gray-500">
                            {shelf.media_type}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate pt-0.5">
                        {shelf.query_tags && shelf.query_tags.length > 0
                          ? shelf.query_tags.map((t) => `#${t}`).join(" ")
                          : t("home.shelves.allWorks")}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditForm(shelf)}
                        className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-primary transition-colors"
                        title={t("home.shelves.editShelf")}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          await onUpdateCustom(shelf.id, { is_public: !shelf.is_public });
                          await onRefreshCustom();
                        }}
                        className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 ${shelf.is_public ? "text-emerald-500" : "text-gray-400"}`}
                        title={shelf.is_public ? t("home.shelves.publicToggleToPrivate") : t("home.shelves.privateToggleToPublic")}
                      >
                        {shelf.is_public ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm(t("home.shelves.deleteConfirm", { name: shelf.name_zh }))) return;
                          await onDeleteCustom(shelf.id);
                          await onRefreshCustom();
                        }}
                        className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        title={t("home.shelves.deleteChannel")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <p className="font-mono text-[11px] text-gray-400 dark:text-gray-500 text-center">
            {t("home.shelves.dragHint")}
          </p>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t border-black/5 dark:border-white/[0.06]">
          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={resetting}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 text-xs hover:text-gray-900 dark:hover:text-white disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> {t("shelf.resetDefault")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 text-xs"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50 shadow-xs"
            >
              <Save className="w-3.5 h-3.5" /> {saving ? t("home.shelves.saving") : t("home.shelves.saveLayout")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
