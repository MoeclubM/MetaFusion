"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Disc3 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Release, Work } from "@/lib/api";

export interface ReleaseFormData {
  work_id: string;
  edition_name: string;
  publisher: string;
  catalog_number: string;
  barcode: string;
  packaging: string;
  notes: string;
}

interface ReleaseModalProps {
  open: boolean;
  onClose: () => void;
  editingRelease: Release | null;
  releaseForm: ReleaseFormData;
  setReleaseForm: React.Dispatch<React.SetStateAction<ReleaseFormData>>;
  worksList: Work[];
  submitting: boolean;
  handleSaveRelease: (e: React.FormEvent) => Promise<void>;
}

export function ReleaseModal({
  open,
  onClose,
  editingRelease,
  releaseForm,
  setReleaseForm,
  worksList,
  submitting,
  handleSaveRelease,
}: ReleaseModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingRelease ? t("admin.releases.editTitle") : t("admin.releases.createTitle")}
      icon={<Disc3 className="w-4 h-4 text-sky-400" />}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSaveRelease} className="space-y-4 text-xs">
        <div>
          <label className="block text-gray-300 font-medium mb-1">
            {t("admin.releases.fieldWork")} <span className="text-rose-400">*</span>
          </label>
          {editingRelease ? (
            <input
              disabled
              value={releaseForm.work_id}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-gray-500 font-mono cursor-not-allowed"
            />
          ) : (
            <div className="space-y-1.5">
              <select
                required
                value={releaseForm.work_id}
                onChange={(e) => setReleaseForm((prev) => ({ ...prev, work_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white font-mono focus:outline-none focus:border-sky-400 text-xs"
              >
                <option value="">— 请选择所属 FRBR 作品 (Work) —</option>
                {worksList.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title} ({w.media_type}) [{w.id.slice(0, 8)}]
                  </option>
                ))}
              </select>
              <input
                value={releaseForm.work_id}
                onChange={(e) => setReleaseForm((prev) => ({ ...prev, work_id: e.target.value.trim() }))}
                placeholder="或直接输入 Work UUID: a1b2c3d4-..."
                className="w-full px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/5 text-gray-400 font-mono text-[11px] focus:outline-none focus:border-sky-400"
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-gray-300 font-medium mb-1">
            {t("admin.releases.fieldEdition")} <span className="text-rose-400">*</span>
          </label>
          <input
            required
            value={releaseForm.edition_name}
            onChange={(e) => setReleaseForm((prev) => ({ ...prev, edition_name: e.target.value }))}
            placeholder="e.g. 初回限定盘 (2CD+Blu-ray) / 4K UHD 收藏版"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-gray-300 font-medium mb-1">
              {t("admin.releases.fieldPublisher")}
            </label>
            <input
              value={releaseForm.publisher}
              onChange={(e) => setReleaseForm((prev) => ({ ...prev, publisher: e.target.value }))}
              placeholder="e.g. Sony Music / WaterTower"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400"
            />
          </div>
          <div>
            <label className="block text-gray-300 font-medium mb-1">
              {t("admin.releases.fieldPackaging")}
            </label>
            <select
              value={releaseForm.packaging || "box_set"}
              onChange={(e) => setReleaseForm((prev) => ({ ...prev, packaging: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400 font-mono"
            >
              <option value="box_set">Box Set (精装盒装)</option>
              <option value="jewel_case">Jewel Case (标准胶盒)</option>
              <option value="digipak">Digipak (折叠纸套盒)</option>
              <option value="vinyl">Vinyl (黑胶封套)</option>
              <option value="digital">Digital (数字流媒体发布)</option>
              <option value="blu_ray">Blu-ray Case (蓝光盒)</option>
              <option value="paperback">Paperback (平装书)</option>
              <option value="hardcover">Hardcover (精装书)</option>
              <option value="other">Other (其他包装)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-gray-300 font-medium mb-1">
              {t("admin.releases.fieldCatalogNumber")}
            </label>
            <input
              value={releaseForm.catalog_number}
              onChange={(e) => setReleaseForm((prev) => ({ ...prev, catalog_number: e.target.value }))}
              placeholder="e.g. WTM-39589 / VICL-60001"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white font-mono focus:outline-none focus:border-sky-400"
            />
          </div>
          <div>
            <label className="block text-gray-300 font-medium mb-1">
              {t("admin.releases.fieldBarcode")}
            </label>
            <input
              value={releaseForm.barcode}
              onChange={(e) => setReleaseForm((prev) => ({ ...prev, barcode: e.target.value }))}
              placeholder="e.g. 794043182926"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white font-mono focus:outline-none focus:border-sky-400"
            />
          </div>
        </div>

        <div>
          <label className="block text-gray-300 font-medium mb-1">
            {t("admin.releases.fieldNotes")}
          </label>
          <textarea
            rows={3}
            value={releaseForm.notes}
            onChange={(e) => setReleaseForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="音轨规格说明、限定特典、压制源或特殊封套材质..."
            className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400 leading-relaxed"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-sky-400 text-black font-semibold hover:bg-sky-300 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {submitting && <span className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
            <span>{editingRelease ? t("common.save") : t("common.create")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
