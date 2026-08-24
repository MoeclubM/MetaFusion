"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { Modal } from "@/components/ui/Modal";
import { DynamicNamesEditor } from "@/components/common/DynamicNamesEditor";
import { Layers, X } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function ShelfModal({
  open,
  onClose,
  shelfForm,
  setShelfForm,
  shelfTagInput,
  setShelfTagInput,
  handleSaveShelf,
}: Pick<AdminDashboard, "shelfForm" | "setShelfForm" | "shelfTagInput" | "setShelfTagInput" | "handleSaveShelf"> & {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shelfForm.slug ? t("admin.shelfModal.editTitle") : t("admin.shelfModal.createTitle")}
      icon={<Layers className="w-4 h-4 text-emerald-400" />}
    >
      <form onSubmit={handleSaveShelf} className="space-y-4 text-xs">
        <div>
          <label className="block text-[11px] font-mono text-gray-300 font-medium mb-1">
            {t("admin.shelfModal.fieldSlug")}
          </label>
          <input
            required
            value={shelfForm.slug || ""}
            onChange={(e) =>
              setShelfForm({
                ...shelfForm,
                slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""),
              })
            }
            placeholder={t("admin.shelfModal.fieldSlugPlaceholder")}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white font-mono focus:outline-none focus:border-emerald-400"
          />
        </div>

        <DynamicNamesEditor
          label={t("admin.shelves.colNameZh")}
          value={shelfForm.names}
          onChange={(names) => setShelfForm({ ...shelfForm, names })}
          required
        />

        <div>
          <label className="block text-[11px] font-mono text-gray-300 font-medium mb-1">
            {t("admin.shelfModal.fieldQuery")}
          </label>
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
              { key: "电影", labelKey: "admin.shelfModal.preset.movie" },
              { key: "动画", labelKey: "admin.shelfModal.preset.anime" },
              { key: "剧集", labelKey: "admin.shelfModal.preset.series" },
              { key: "游戏", labelKey: "admin.shelfModal.preset.game" },
              { key: "专辑", labelKey: "admin.shelfModal.preset.album" },
              { key: "原声", labelKey: "admin.shelfModal.preset.soundtrack" },
              { key: "古典", labelKey: "admin.shelfModal.preset.classical" },
              { key: "科幻", labelKey: "admin.shelfModal.preset.scifi" },
              { key: "吉卜力", labelKey: "admin.shelfModal.preset.ghibli" },
            ] as const).map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  if (!(shelfForm.query_tags || []).includes(preset.key)) {
                    setShelfForm({ ...shelfForm, query_tags: [...(shelfForm.query_tags || []), preset.key] });
                  }
                }}
                className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-white border border-white/5 text-[11px] font-mono transition-colors"
              >
                +{t(preset.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label className="block text-[11px] font-mono text-gray-300 font-medium mb-1">
              {t("admin.shelfModal.fieldOrder")}
            </label>
            <input
              type="number"
              value={shelfForm.sort_order ?? 0}
              onChange={(e) => setShelfForm({ ...shelfForm, sort_order: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white font-mono focus:outline-none focus:border-emerald-400"
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={shelfForm.require_all_tags ?? false}
                onChange={(e) => setShelfForm({ ...shelfForm, require_all_tags: e.target.checked })}
                className="rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-0"
              />
              <span>{t("admin.shelfModal.requireAll")}</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white transition-colors"
          >
            {t("admin.shelfModal.cancel")}
          </button>
          <button
            type="submit"
            className="px-4 py-1.5 rounded-lg bg-emerald-400 text-black font-semibold hover:bg-emerald-300 transition-colors"
          >
            {t("admin.shelfModal.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
