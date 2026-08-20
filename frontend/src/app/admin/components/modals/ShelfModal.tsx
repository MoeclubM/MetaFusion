"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { Layers, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function ShelfModal({
  open,
  onClose,
  editingShelf,
  shelfForm,
  setShelfForm,
  shelfTagInput,
  setShelfTagInput,
  handleSaveShelf,
}: Pick<AdminDashboard, "editingShelf" | "shelfForm" | "setShelfForm" | "shelfTagInput" | "setShelfTagInput" | "handleSaveShelf"> & {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingShelf ? t("admin.shelfModal.editTitle") : t("admin.shelfModal.createTitle")}
      icon={<Layers className="w-4 h-4 text-emerald-400" />}
    >
      <form onSubmit={handleSaveShelf} className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-gray-300 font-medium mb-1">{t("admin.shelfModal.fieldSlug")}</label>
            <input
              required
              disabled={!!editingShelf}
              value={shelfForm.slug || ""}
              onChange={(e) => setShelfForm({ ...shelfForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "") })}
              placeholder={t("admin.shelfModal.fieldSlugPlaceholder")}
              className={`w-full px-3 py-2 rounded-lg border font-mono text-white focus:outline-none ${
                editingShelf
                  ? "bg-white/[0.02] border-white/5 text-gray-500 cursor-not-allowed"
                  : "bg-white/[0.04] border-white/10 focus:border-emerald-400"
              }`}
            />
          </div>
          <div>
            <label className="block text-gray-300 font-medium mb-1">{t("admin.shelfModal.fieldNameZh")}</label>
            <input
              required
              value={shelfForm.name_zh || ""}
              onChange={(e) => setShelfForm({ ...shelfForm, name_zh: e.target.value })}
              placeholder={t("admin.shelfModal.fieldNameZhPlaceholder")}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-gray-300 font-medium mb-1">{t("admin.shelfModal.fieldNameEn")}</label>
            <input
              value={shelfForm.name_en || ""}
              onChange={(e) => setShelfForm({ ...shelfForm, name_en: e.target.value })}
              placeholder={t("admin.shelfModal.fieldNameEnPlaceholder")}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-emerald-400"
            />
          </div>
          <div>
            <label className="block text-gray-300 font-medium mb-1">{t("admin.shelfModal.fieldMediaType")}</label>
            <select
              value={shelfForm.media_type || "all"}
              onChange={(e) => setShelfForm({ ...shelfForm, media_type: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-emerald-400 font-mono"
            >
              <option value="all">{t("admin.shelfModal.mediaAll")}</option>
              <option value="video">{t("admin.shelfModal.mediaVideo")}</option>
              <option value="music">{t("admin.shelfModal.mediaMusic")}</option>
              <option value="book">{t("admin.shelfModal.mediaBook")}</option>
              <option value="comic">{t("admin.shelfModal.mediaComic")}</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-gray-300 font-medium mb-1">{t("admin.shelfModal.fieldQuery")}</label>
          <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-white/[0.04] border border-white/10 min-h-[36px]">
            {(shelfForm.query_tags || []).map((tag, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-mono flex items-center gap-1"
              >
                <span>#{tag}</span>
                <button
                  type="button"
                  onClick={() =>
                    setShelfForm({
                      ...shelfForm,
                      query_tags: (shelfForm.query_tags || []).filter((_, i) => i !== idx),
                    })
                  }
                  className="hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              placeholder={t("admin.shelfModal.queryPlaceholder")}
              value={shelfTagInput}
              onChange={(e) => setShelfTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const val = shelfTagInput.trim().replace(/^#/, "");
                  if (val && !(shelfForm.query_tags || []).includes(val)) {
                    setShelfForm({ ...shelfForm, query_tags: [...(shelfForm.query_tags || []), val] });
                  }
                  setShelfTagInput("");
                }
              }}
              className="bg-transparent text-xs text-white placeholder:text-gray-500 focus:outline-none font-mono flex-1 min-w-[120px]"
            />
          </div>
          <div className="flex flex-wrap gap-1 pt-1.5">
            {([
              { key: "movie", labelKey: "admin.shelfModal.preset.movie" },
              { key: "anime", labelKey: "admin.shelfModal.preset.anime" },
              { key: "series", labelKey: "admin.shelfModal.preset.series" },
              { key: "soundtrack", labelKey: "admin.shelfModal.preset.soundtrack" },
              { key: "classical", labelKey: "admin.shelfModal.preset.classical" },
              { key: "scifi", labelKey: "admin.shelfModal.preset.scifi" },
              { key: "ghibli", labelKey: "admin.shelfModal.preset.ghibli" },
              { key: "4K_UHD", labelKey: "admin.shelfModal.preset.4K_UHD" },
              { key: "Hi-Res", labelKey: "admin.shelfModal.preset.hiRes" },
            ] as const).map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  if (!(shelfForm.query_tags || []).includes(preset.key)) {
                    setShelfForm({ ...shelfForm, query_tags: [...(shelfForm.query_tags || []), preset.key] });
                  }
                }}
                className="px-1.5 py-0.2 rounded bg-white/[0.04] text-[10px] font-mono text-gray-400 hover:text-white"
              >
                + #{t(preset.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/5">
            <input
              type="checkbox"
              id="require_all"
              checked={shelfForm.require_all_tags ?? false}
              onChange={(e) => setShelfForm({ ...shelfForm, require_all_tags: e.target.checked })}
              className="rounded border-white/20 text-emerald-500"
            />
            <label htmlFor="require_all" className="text-gray-300 text-[11px] select-none cursor-pointer">
              {t("admin.shelfModal.requireAll")}
            </label>
          </div>
          <div>
            <label className="block text-gray-400 text-[10px] mb-0.5">{t("admin.shelfModal.fieldOrder")}</label>
            <input
              type="number"
              value={shelfForm.sort_order ?? 0}
              onChange={(e) => setShelfForm({ ...shelfForm, sort_order: parseInt(e.target.value) || 0 })}
              className="w-full px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-white font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-white/[0.06]">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white">
            {t("admin.shelfModal.cancel")}
          </button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-400 text-black font-semibold hover:bg-emerald-300">
            {t("admin.shelfModal.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
