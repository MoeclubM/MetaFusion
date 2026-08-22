"use client";

import { Users, Plus } from "lucide-react";
import { dictTermLabel } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function AgentsTab({
  loading,
  filteredArtists,
  artistsList,
  selectedEntityType,
  setSelectedEntityType,
  handleOpenCreateArtist,
  handleOpenEditArtist,
  handleDeleteArtist,
}: Pick<
  AdminDashboard,
  "loading" | "filteredArtists" | "artistsList" | "selectedEntityType" | "setSelectedEntityType" | "handleOpenCreateArtist" | "handleOpenEditArtist" | "handleDeleteArtist"
>) {
  const { t } = useI18n();
  const { taxonomy, entityTypeLabel } = useTaxonomy();
  const entityOpts = taxonomy?.entity_types || [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-400" />
            {t("admin.agents.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.agents.subtitle")}</p>
        </div>
        <button
          onClick={handleOpenCreateArtist}
          className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("admin.agents.new")}</span>
        </button>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setSelectedEntityType("all")}
          className={`px-3 py-1 rounded-lg border transition-colors ${
            selectedEntityType === "all"
              ? "bg-white text-black border-white font-semibold"
              : "bg-surface border-surfaceBorder text-gray-400 hover:text-white"
          }`}
        >
          {t("admin.agents.all", { count: artistsList.length })}
        </button>
        {entityOpts.map((opt) => {
          const count = artistsList.filter((a) => a.entity_type === opt.id).length;
          return (
            <button
              key={opt.id}
              onClick={() => setSelectedEntityType(opt.id)}
              className={`px-3 py-1 rounded-lg border transition-colors whitespace-nowrap ${
                selectedEntityType === opt.id
                  ? "bg-white text-black border-white font-semibold"
                  : "bg-surface border-surfaceBorder text-gray-400 hover:text-white"
              }`}
            >
              {dictTermLabel(opt.id, entityOpts)} ({count})
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.agents.colName")}</th>
              <th className="py-3 px-3">{t("admin.agents.colType")}</th>
              <th className="py-3 px-3">{t("admin.agents.colCountry")}</th>
              <th className="py-3 px-3">{t("admin.agents.colAuthority")}</th>
              <th className="py-3 px-4 text-right">{t("admin.agents.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : filteredArtists.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.agents.noData")}
                </td>
              </tr>
            ) : (
              filteredArtists.map((artist) => (
                <tr key={artist.id} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white">{artist.name}</div>
                    {artist.original_name && <div className="text-[11px] text-gray-400 mt-0.5">{artist.original_name}</div>}
                    {artist.disambiguation && <div className="text-[10px] text-amber-400 font-mono mt-0.5">({artist.disambiguation})</div>}
                  </td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-white/[0.06] border border-white/10 text-gray-300">
                      {entityTypeLabel(artist.entity_type)}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-gray-300">{artist.country || "—"}</td>
                  <td className="py-3 px-3 font-mono text-gray-400 text-[10px]">
                    {artist.external_ids && Object.keys(artist.external_ids).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(artist.external_ids).map(([k, v]) => (
                          <span key={k} className="px-1.5 py-0.2 rounded bg-white/[0.04] border border-white/[0.08]">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-3 px-4 text-right space-x-1">
                    <button
                      onClick={() => handleOpenEditArtist(artist)}
                      className="px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white text-xs"
                    >
                      {t("admin.agents.edit")}
                    </button>
                    <button
                      onClick={() => handleDeleteArtist(artist)}
                      className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-xs"
                    >
                      {t("admin.agents.delete")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
