"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchApi, VirtualShelf, UserCustomShelf } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import {
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
  Plus,
  Globe,
  Lock,
  X,
  Save,
  RotateCcw,
  Sparkles,
} from "lucide-react";

type ShelfItem = {
  key: string; // system slug or "custom:<id>"
  labelZh: string;
  labelEn: string;
  icon?: string;
  isCustom: boolean;
  raw: VirtualShelf | UserCustomShelf;
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
  systemShelves,
  customShelves,
  hiddenSlugs,
  orderKeys,
  onSaveLayout,
  onCreateCustom,
  onUpdateCustom,
  onDeleteCustom,
  onRefreshCustom,
}: {
  open: boolean;
  onClose: () => void;
  systemShelves: VirtualShelf[];
  customShelves: UserCustomShelf[];
  hiddenSlugs: string[];
  orderKeys: string[];
  onSaveLayout: (hidden: string[], order: string[]) => Promise<void>;
  onCreateCustom: (payload: Partial<UserCustomShelf> & { slug: string; name_zh: string }) => Promise<void>;
  onUpdateCustom: (id: string, payload: Partial<UserCustomShelf>) => Promise<void>;
  onDeleteCustom: (id: string) => Promise<void>;
  onRefreshCustom: () => Promise<void>;
}) {
  const { t, locale } = useI18n();

  const [localHidden, setLocalHidden] = useState<string[]>(hiddenSlugs);
  const [localOrder, setLocalOrder] = useState<string[]>(orderKeys);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // create form
  const [showCreate, setShowCreate] = useState(false);
  const [formSlug, setFormSlug] = useState("");
  const [formZh, setFormZh] = useState("");
  const [formEn, setFormEn] = useState("");
  const [formMedia, setFormMedia] = useState("all");
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formTagInput, setFormTagInput] = useState("");
  const [formRequireAll, setFormRequireAll] = useState(false);
  const [formPublic, setFormPublic] = useState(false);
  const [availableTags, setAvailableTags] = useState<{ name: string }[]>([]);
  const [publicGallery, setPublicGallery] = useState<UserCustomShelf[]>([]);
  const [galleryQ, setGalleryQ] = useState("");

  useEffect(() => {
    setLocalHidden(hiddenSlugs);
    setLocalOrder(orderKeys);
  }, [hiddenSlugs, orderKeys]);

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
    // load public gallery
    fetchApi<{ items: UserCustomShelf[] }>("/catalog/shelves/custom?scope=public&page_size=20")
      .then((r) => setPublicGallery(r.items || []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open || galleryQ.trim() === "") return;
    const id = setTimeout(() => {
      fetchApi<{ items: UserCustomShelf[] }>(`/catalog/shelves/custom?scope=public&q=${encodeURIComponent(galleryQ.trim())}&page_size=20`)
        .then((r) => setPublicGallery(r.items || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [galleryQ, open]);

  const systemMap = new Map(systemShelves.map((s) => [s.slug, s]));
  const customMap = new Map(customShelves.map((c) => [`custom:${c.id}`, c]));

  // build display order: localOrder filtered + append missing
  const allKeys = (() => {
    const keys = [...localOrder];
    const seen = new Set(keys);
    systemShelves.forEach((s) => {
      if (!seen.has(s.slug)) {
        keys.push(s.slug);
        seen.add(s.slug);
      }
    });
    customShelves.forEach((c) => {
      const k = `custom:${c.id}`;
      if (!seen.has(k)) {
        keys.push(k);
        seen.add(k);
      }
    });
    return keys;
  })();

  const toggleHidden = (slug: string) => {
    setLocalHidden((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveLayout(localHidden, allKeys);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setLocalHidden([]);
    const defaultOrder = [...systemShelves.map((s) => s.slug), ...customShelves.map((c) => `custom:${c.id}`)];
    setLocalOrder(defaultOrder);
    setSaving(true);
    try {
      await onSaveLayout([], defaultOrder);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = formSlug.toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!slug || !formZh.trim()) return;
    await onCreateCustom({
      slug,
      name_zh: formZh.trim(),
      name_en: formEn.trim(),
      media_type: formMedia,
      query_tags: formTags,
      require_all_tags: formRequireAll,
      is_public: formPublic,
    });
    setFormSlug("");
    setFormZh("");
    setFormEn("");
    setFormTags([]);
    setFormTagInput("");
    setShowCreate(false);
    await onRefreshCustom();
  };

  const addToMyHome = async (item: UserCustomShelf) => {
    const key = `custom:${item.id}`;
    if (!allKeys.includes(key)) {
      const nextOrder = [...allKeys, key];
      setLocalOrder(nextOrder);
      setSaving(true);
      try {
        await onSaveLayout(localHidden, nextOrder);
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("shelf.configTitle")} maxWidth="max-w-2xl">
      <div className="space-y-5 text-xs">
        {/* System shelves */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-white text-xs">{t("home.shelves.presetTitle")}</h4>
            <span className="font-mono text-[11px] text-gray-500">{t("home.shelves.items", { count: allKeys.length })}</span>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/[0.06] max-h-[32vh] overflow-auto">
            {allKeys.map((key, idx) => {
              const isCustom = key.startsWith("custom:");
              const sys = !isCustom ? systemMap.get(key) : null;
              const custom = isCustom ? customMap.get(key) : null;
              if (!sys && !custom) return null;
              const label = isCustom
                ? locale === "en-US" && custom?.name_en
                  ? custom!.name_en
                  : custom!.name_zh
                : locale === "en-US" && sys?.name_en
                  ? sys!.name_en
                  : sys!.name_zh;
              const hidden = !isCustom && localHidden.includes(key);
              return (
                <div
                  key={key}
                  draggable
                  onDragStart={() => setDragFrom(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragFrom === null || dragFrom === idx) return;
                    const next = arrayMove(allKeys, dragFrom, idx);
                    setLocalOrder(next);
                    setDragFrom(null);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 ${hidden ? "opacity-50" : ""} hover:bg-white/[0.03]`}
                >
                  <span className="cursor-grab text-gray-500 hover:text-white">
                    <GripVertical className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 truncate text-white font-medium">{label}</span>
                  <span className="font-mono text-[10px] text-gray-500 truncate hidden sm:inline">
                    {isCustom ? (custom as UserCustomShelf)?.query_tags?.join(", ") : (sys?.query_tags || []).join(", ")}
                  </span>
                  {!isCustom ? (
                    <button
                      type="button"
                      onClick={() => toggleHidden(key)}
                      className={`p-1 rounded hover:bg-white/10 ${hidden ? "text-amber-400" : "text-gray-400"}`}
                      title={hidden ? t("home.shelves.hiddenShow") : t("home.shelves.hiddenHide")}
                    >
                      {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono text-[10px]">
                      自建
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="font-mono text-[11px] text-gray-500">{t("home.shelves.dragHint")}</p>
        </div>

        {/* My custom shelves */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-white text-xs flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" /> {t("home.shelves.myTitle")}
            </h4>
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-white text-[11px] font-semibold hover:opacity-90"
            >
              <Plus className="w-3 h-3" /> {t("home.shelves.newGroup")}
            </button>
          </div>

          {showCreate && (
            <form onSubmit={handleCreate} className="p-3 rounded-xl border border-white/10 bg-white/[0.02] space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-gray-400 text-[11px] mb-1">{t("home.shelves.slugLabel")}</label>
                  <input
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))}
                    placeholder={t("home.shelves.slugPlaceholder")}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-primary/50"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-[11px] mb-1">{t("home.shelves.mediaTypeLabel")}</label>
                  <select
                    value={formMedia}
                    onChange={(e) => setFormMedia(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs"
                  >
                    <option value="all">{t("home.shelves.mediaAll")}</option>
                    <option value="video">{t("home.shelves.mediaVideo")}</option>
                    <option value="audio">{t("home.shelves.mediaAudio")}</option>
                    <option value="text">{t("home.shelves.mediaText")}</option>
                    <option value="graphic">{t("home.shelves.mediaGraphic")}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-gray-400 text-[11px] mb-1">{t("home.shelves.nameZhLabel")}</label>
                  <input value={formZh} onChange={(e) => setFormZh(e.target.value)} placeholder={t("home.shelves.nameZhLabel")} className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs focus:outline-none focus:border-primary/50" required />
                </div>
                <div>
                  <label className="block text-gray-400 text-[11px] mb-1">{t("home.shelves.nameEnLabel")}</label>
                  <input value={formEn} onChange={(e) => setFormEn(e.target.value)} placeholder={t("home.shelves.nameEnLabel")} className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs" />
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-[11px] mb-1">{t("home.shelves.tagsLabel")}</label>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-white/[0.04] border border-white/10 min-h-[36px]">
                  {formTags.map((tag, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/20 text-xs font-mono flex items-center gap-1">
                      #{tag}
                      <button type="button" onClick={() => setFormTags(formTags.filter((_, i) => i !== idx))} className="hover:text-red-400">
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
                    className="bg-transparent text-xs text-white placeholder:text-gray-500 focus:outline-none flex-1 min-w-[100px]"
                  />
                </div>
                <div className="flex flex-wrap gap-1 pt-1.5">
                  {availableTags.slice(0, 12).map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => {
                        if (!formTags.includes(t.name)) setFormTags([...formTags, t.name]);
                      }}
                      className="px-1.5 py-0.5 rounded bg-white/[0.04] text-[10px] font-mono text-gray-400 hover:text-white"
                    >
                      + #{t.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={formRequireAll} onChange={(e) => setFormRequireAll(e.target.checked)} className="rounded" />
                  <span className="text-[11px]">{t("home.shelves.requireAll")}</span>
                </label>
                <label className="flex items-center gap-1.5 text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={formPublic} onChange={(e) => setFormPublic(e.target.checked)} className="rounded" />
                  <span className="text-[11px]">{t("home.shelves.publicShare")}</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-gray-300 text-xs">
                  取消
                </button>
                <button type="submit" className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold">
                  创建
                </button>
              </div>
            </form>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/[0.06] max-h-[28vh] overflow-auto">
            {customShelves.length === 0 ? (
              <div className="p-6 text-center text-gray-500 font-mono text-xs">{t("home.shelves.emptyCustom")}</div>
            ) : (
              customShelves.map((c) => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-medium truncate">
                      {locale === "en-US" && c.name_en ? c.name_en : c.name_zh}{" "}
                      <span className="font-mono text-[10px] text-gray-500">/{c.slug}</span>
                    </div>
                    <div className="font-mono text-[11px] text-gray-500 truncate">{(c.query_tags || []).join(", ") || t("home.shelves.allWorks")}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await onUpdateCustom(c.id, { is_public: !c.is_public });
                      await onRefreshCustom();
                    }}
                    className={`p-1.5 rounded hover:bg-white/10 ${c.is_public ? "text-emerald-400" : "text-gray-400"}`}
                    title={c.is_public ? "公开中，点击设为私有" : "私有，点击公开"}
                  >
                    {c.is_public ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(t("home.shelves.deleteConfirm", { name: c.name_zh }))) return;
                      await onDeleteCustom(c.id);
                      await onRefreshCustom();
                    }}
                    className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-white/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Public gallery */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold text-white text-xs flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-sky-400" /> {t("home.shelves.publicGallery")}
            </h4>
            <input
              value={galleryQ}
              onChange={(e) => setGalleryQ(e.target.value)}
              placeholder={t("home.shelves.searchPublic")}
              className="flex-1 max-w-[160px] px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/40"
            />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/[0.06] max-h-[24vh] overflow-auto">
            {publicGallery.length === 0 ? (
              <div className="p-4 text-center text-gray-500 font-mono text-xs">{t("home.shelves.emptyPublic")}</div>
            ) : (
              publicGallery.map((g) => (
                <div key={g.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-medium truncate">{locale === "en-US" && g.name_en ? g.name_en : g.name_zh}</div>
                    <div className="font-mono text-[11px] text-gray-500 truncate">{(g.query_tags || []).join(", ")}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addToMyHome(g)}
                    className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-white text-[11px] hover:bg-primary hover:text-white hover:border-primary"
                  >
                    {t("home.shelves.addToHome")}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
          <button type="button" onClick={handleReset} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-gray-300 text-xs hover:text-white disabled:opacity-50">
            <RotateCcw className="w-3.5 h-3.5" /> {t("shelf.resetDefault")}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-gray-300 text-xs">
              {t("common.cancel")}
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {saving ? t("home.shelves.saving") : t("home.shelves.saveLayout")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
