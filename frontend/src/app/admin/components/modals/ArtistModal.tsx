"use client";

import { Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { getLocalizedEntityTypeOptions, EntityType } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function ArtistModal({
  open,
  onClose,
  editingArtist,
  artistForm,
  setArtistForm,
  artistSubmitting,
  handleSaveArtist,
}: Pick<AdminDashboard, "editingArtist" | "artistForm" | "setArtistForm" | "artistSubmitting" | "handleSaveArtist"> & {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const entityOpts = getLocalizedEntityTypeOptions(t);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingArtist ? t("admin.artistModal.editTitle") : t("admin.artistModal.createTitle")}
      icon={<Users className="w-4 h-4 text-sky-400" />}
    >
      <form onSubmit={handleSaveArtist} className="space-y-3 text-xs">
        <div>
          <label className="block text-gray-300 font-medium mb-1">{t("admin.artistModal.fieldName")}</label>
          <input
            required
            value={artistForm.name}
            onChange={(e) => setArtistForm({ ...artistForm, name: e.target.value })}
            placeholder={t("admin.artistModal.fieldNamePlaceholder")}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-gray-300 font-medium mb-1">{t("admin.artistModal.fieldOriginal")}</label>
            <input
              value={artistForm.original_name}
              onChange={(e) => setArtistForm({ ...artistForm, original_name: e.target.value })}
              placeholder={t("admin.artistModal.fieldOriginalPlaceholder")}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400"
            />
          </div>
          <div>
            <label className="block text-gray-300 font-medium mb-1">{t("admin.artistModal.fieldType")}</label>
            <select
              value={artistForm.entity_type}
              onChange={(e) => setArtistForm({ ...artistForm, entity_type: e.target.value as EntityType })}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400"
            >
              {entityOpts.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-gray-300 font-medium mb-1">{t("admin.artistModal.fieldDisambiguation")}</label>
            <input
              value={artistForm.disambiguation}
              onChange={(e) => setArtistForm({ ...artistForm, disambiguation: e.target.value })}
              placeholder={t("admin.artistModal.fieldDisambiguationPlaceholder")}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400"
            />
          </div>
          <div>
            <label className="block text-gray-300 font-medium mb-1">{t("admin.artistModal.fieldCountry")}</label>
            <input
              value={artistForm.country}
              onChange={(e) => setArtistForm({ ...artistForm, country: e.target.value })}
              placeholder={t("admin.artistModal.fieldCountryPlaceholder")}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400"
            />
          </div>
        </div>
        <div>
          <label className="block text-gray-300 font-medium mb-1">{t("admin.artistModal.fieldBio")}</label>
          <textarea
            rows={3}
            value={artistForm.biography}
            onChange={(e) => setArtistForm({ ...artistForm, biography: e.target.value })}
            placeholder={t("admin.artistModal.fieldBioPlaceholder")}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-sky-400"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <label className="block text-gray-400 text-[10px] mb-0.5">MusicBrainz ID</label>
            <input
              value={artistForm.mb_id}
              onChange={(e) => setArtistForm({ ...artistForm, mb_id: e.target.value })}
              placeholder="UUID"
              className="w-full px-2 py-1.5 rounded bg-white/[0.04] border border-white/10 text-white font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-gray-400 text-[10px] mb-0.5">Bangumi ID</label>
            <input
              value={artistForm.bangumi_id}
              onChange={(e) => setArtistForm({ ...artistForm, bangumi_id: e.target.value })}
              placeholder={t("admin.artistModal.digitalPlaceholder")}
              className="w-full px-2 py-1.5 rounded bg-white/[0.04] border border-white/10 text-white font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-gray-400 text-[10px] mb-0.5">IMDb ID</label>
            <input
              value={artistForm.imdb_id}
              onChange={(e) => setArtistForm({ ...artistForm, imdb_id: e.target.value })}
              placeholder="nm0000000"
              className="w-full px-2 py-1.5 rounded bg-white/[0.04] border border-white/10 text-white font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-gray-400 text-[10px] mb-0.5">TMDB ID</label>
            <input
              value={artistForm.tmdb_id}
              onChange={(e) => setArtistForm({ ...artistForm, tmdb_id: e.target.value })}
              placeholder={t("admin.artistModal.digitalPlaceholder")}
              className="w-full px-2 py-1.5 rounded bg-white/[0.04] border border-white/10 text-white font-mono text-xs"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white">
            {t("admin.artistModal.cancel")}
          </button>
          <button type="submit" disabled={artistSubmitting} className="px-4 py-2 rounded-lg bg-sky-400 text-black font-semibold hover:bg-sky-300">
            {artistSubmitting ? t("admin.artistModal.saving") : t("admin.artistModal.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
