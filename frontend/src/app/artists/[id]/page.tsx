"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { fetchApi, ArtistDetailResponse, Category, categoryDisplayName, ConnectedEntityItem, catalogEntityHref, pickLocalized } from "@/lib/api";
import {
  User, Building, Film, Globe, ExternalLink, Layers, Eye, ArrowUpRight,
  Handshake, FileSignature, Briefcase, Network, Sparkles, Building2, CheckCircle2,
  Edit3, History, GitMerge
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";
import { RevisionHistoryModal } from "@/components/editor/RevisionHistoryModal";
import { EntityMergeModal } from "@/components/editor/EntityMergeModal";
import { TemporalBadge } from "@/components/entity/TemporalBadge";
import { ExternalAuthorityLinks } from "@/components/entity/ExternalAuthorityLinks";
import { EntityActionToolbar } from "@/components/entity/EntityActionToolbar";
import FavoriteButton from "@/components/FavoriteButton";
import { EntityCover } from "@/components/common/EntityCover";

export default function ArtistDetailPage() {
  const params = useParams();
  const artistId = params.id as string;
  const { t, locale } = useI18n();
  const { entityTypeLabel } = useTaxonomy();

  const [data, setData] = useState<ArtistDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"works" | "releases" | "affiliations">("works");

  // Edit, Revision History, and Merge Modals
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMergeOpen, setIsMergeOpen] = useState(false);

  useEffect(() => {
    if (!artistId) return;
    setLoading(true);
    fetchApi<ArtistDetailResponse>(`/catalog/artists/${artistId}`)
      .then((res) => {
        setData(res);
        if (res.releases?.length && !res.works?.length) {
          setActiveTab("releases");
        } else if (!res.works?.length && !res.releases?.length && res.connected_entities?.length) {
          setActiveTab("affiliations");
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [artistId]);

  if (loading) return <div className="min-h-screen bg-background grid place-items-center font-mono text-xs text-gray-500">{t("artist.detail.loading")}</div>;
  if (!data || !data.artist) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 py-20 text-center font-mono text-xs text-gray-500">{t("common.notFoundEntity")}</div>
      </div>
    );
  }

  const artist = data.artist;
  const localized = pickLocalized(locale, artist.translations, artist.name, artist.biography);
  const works = data.works || [];
  const releases = data.releases || [];
  const connectedEntities: ConnectedEntityItem[] = data.connected_entities || [];
  const extIds = artist.external_ids || {};

  const getEntityTypeLabel = (type: string) => entityTypeLabel(type);

  const getEntityIcon = () => {
    return <User className="w-8 h-8 text-amber-400" strokeWidth={1.4} />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-5 w-full space-y-4 sm:space-y-5 flex-1">
        <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 space-y-4 shadow-soft">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="w-16 h-16 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 grid place-items-center shrink-0 shadow-xs">
              {getEntityIcon()}
            </div>
            <div className="flex-1 space-y-2.5 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-wide">
                <span className="px-2 py-0.5 rounded-sm bg-primary text-white font-bold">{getEntityTypeLabel(artist.entity_type)}</span>
                {artist.country && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
                    <Globe className="w-3 h-3 text-gray-400" strokeWidth={1.5} /> {artist.country}
                  </span>
                )}

                {/* Artist Lifespan / Active Era */}
                <TemporalBadge
                  beginDate={artist.begin_date}
                  endDate={artist.end_date}
                  ended={artist.ended}
                  endedLabel={t("entity.temporal.endedArtist")}
                  activeLabel={t("entity.temporal.activeArtist")}
                />

                {/* Quick affiliation pills */}
                {connectedEntities.filter((e) => e.is_current !== false).slice(0, 3).map((ent) => (
                  <Link
                    key={ent.entity_id + ent.relationship_type}
                    href={catalogEntityHref(ent.entity_type, ent.entity_id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                  >
                    <span className="text-gray-500">{ent.label}:</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{ent.entity_name}</span>
                  </Link>
                ))}
              </div>
              <div>
                <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{localized.title}</h1>
                {artist.original_name && artist.original_name !== localized.title && <p className="font-mono text-xs text-gray-500 dark:text-gray-400 mt-0.5">{artist.original_name}</p>}
                {artist.disambiguation && <p className="font-mono text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{artist.disambiguation}</p>}
              </div>
              {localized.body && <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400 max-w-3xl line-clamp-3">{localized.body}</p>}
              
              {/* External Authority Links */}
              <ExternalAuthorityLinks externalIds={extIds} className="pt-2.5 border-t border-black/5 dark:border-white/[0.06]" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-black/5 dark:border-white/[0.06] pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setActiveTab("works")}
                className={`px-3 h-7 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${activeTab === "works" ? "bg-primary text-white keep-white border-primary shadow-xs" : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
              >
                <Film className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span>{t("artist.detail.worksAndCreation", { count: works.length })}</span>
              </button>
              {releases.length > 0 && (
                <button
                  onClick={() => setActiveTab("releases")}
                  className={`px-3 h-7 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${activeTab === "releases" ? "bg-primary text-white keep-white border-primary shadow-xs" : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
                >
                  <Layers className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span>{t("artist.detail.published", { count: releases.length })}</span>
                </button>
              )}
              {connectedEntities.length > 0 && (
                <button
                  onClick={() => setActiveTab("affiliations")}
                  className={`px-3 h-7 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${activeTab === "affiliations" ? "bg-primary text-white keep-white border-primary shadow-xs" : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"}`}
                >
                  <Handshake className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span>{t("artist.detail.affiliations", { count: connectedEntities.length })}</span>
                </button>
              )}
            </div>

            {/* Action Toolbar */}
            <EntityActionToolbar
              onEdit={() => setIsEditorOpen(true)}
              onHistory={() => setIsHistoryOpen(true)}
              onMerge={() => setIsMergeOpen(true)}
              entityTypeLabel={t("entity.toolbar.artist")}
            >
              <FavoriteButton targetType="artist" targetId={artist.id} />
            </EntityActionToolbar>
          </div>
        </div>

        {activeTab === "works" && (
          <div className="space-y-3">
            {works.length === 0 ? (
              <div className="rounded-lg border border-black/10 dark:border-white/10 bg-surface p-8 text-center font-mono text-xs text-gray-500">{t("artist.detail.noWorks")}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {works.map((item: any) => {
                  const w = item.work || item;
                  const role = item.role || w.role;
                  if (!w || !w.id) return null;
                  return (
                    <Link key={w.id} href={`/works/${w.id}`} className="group relative overflow-hidden rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface flex flex-col shadow-2xs hover:shadow-elevated hover:border-primary/40 transition-all">
                      <div className="relative aspect-[3/4] bg-black/40 overflow-hidden">
                        <EntityCover
                          src={w.cover_image_url}
                          alt={w.title}
                          title={w.title}
                          originalTitle={w.original_title}
                          mediaType={w.media_type}
                          id={w.id}
                          imgClassName="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-60 pointer-events-none" />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.2 rounded-sm bg-black/70 backdrop-blur border border-white/10 font-mono text-[9px] text-white keep-white">{w.category ? categoryDisplayName(w.category as Category, locale) : w.media_type}</span>
                        {role && <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.2 rounded-sm bg-primary text-white font-mono text-[9px] font-bold">{role}</span>}
                      </div>
                      <div className="p-2.5 flex-1 flex flex-col justify-between gap-1">
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white text-xs leading-tight line-clamp-1 group-hover:text-primary transition-colors">{w.title}</h3>
                          {w.original_title && <p className="font-mono text-[10px] text-gray-500 truncate">{w.original_title}</p>}
                        </div>
                        <div className="pt-1.5 border-t border-black/5 dark:border-white/[0.06] flex items-center justify-between font-mono text-[10px] text-gray-500">
                          <span>{w.release_date ? new Date(w.release_date).getFullYear() : "—"}</span>
                          <span className="inline-flex items-center gap-0.5 tabular-nums">
                            <Eye className="w-3 h-3 text-gray-400" strokeWidth={1.5} /> {w.view_count || 0}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "releases" && (
          <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft">
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/5 dark:border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="py-2.5 px-3.5 font-medium">{t("artist.detail.tableReleaseTitle")}</th>
                    <th className="py-2.5 px-3.5 font-medium">{t("artist.detail.tableCatalogNo")}</th>
                    <th className="py-2.5 px-3.5 font-medium">{t("artist.detail.tableBarcode")}</th>
                    <th className="py-2.5 px-3.5 text-right font-medium">{t("artist.detail.tableYear")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                  {releases.map((rel) => (
                    <tr key={rel.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3.5 font-medium text-gray-900 dark:text-white">
                        <Link href={`/releases/${rel.id}`} className="hover:text-primary inline-flex items-center gap-1">
                          {rel.edition_name} <ArrowUpRight className="w-3 h-3 text-gray-400" strokeWidth={1.5} />
                        </Link>
                      </td>
                      <td className="py-2.5 px-3.5 font-mono text-gray-500">{rel.catalog_number || "—"}</td>
                      <td className="py-2.5 px-3.5 font-mono text-gray-500">{rel.barcode || "—"}</td>
                      <td className="py-2.5 px-3.5 font-mono text-gray-500 text-right">{rel.edition_date ? new Date(rel.edition_date).getFullYear() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y divide-black/5 dark:divide-white/[0.06]">
              {releases.map((rel) => (
                <a key={rel.id} href={`/releases/${rel.id}`} className="block px-3.5 py-3 active:bg-black/[0.02] dark:active:bg-white/[0.04]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-medium text-gray-900 dark:text-white text-xs line-clamp-2 inline-flex items-center gap-1">{rel.edition_name} <ArrowUpRight className="w-3 h-3 text-gray-400 shrink-0" strokeWidth={1.5} /></div>
                      <div className="font-mono text-[10px] text-gray-500 truncate">{rel.catalog_number || "—"}{rel.barcode ? " · " + rel.barcode : ""}</div>
                      <div className="font-mono text-[10px] text-gray-400">{rel.edition_date ? new Date(rel.edition_date).getFullYear() : "—"}</div>
                    </div>
                    <span className={`shrink-0 px-1.5 py-0.2 rounded-sm text-[10px] font-mono border ${rel.is_master_verified ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-300" : "bg-black/[0.04] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-500"}`}>{rel.is_master_verified ? t("work.detail.verified") : t("work.detail.pending")}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {activeTab === "affiliations" && (
          <div className="space-y-4">
            {connectedEntities.length === 0 ? (
              <div className="rounded-lg border border-black/10 dark:border-white/10 bg-surface p-8 text-center font-mono text-xs text-gray-500">
                {t("artist.detail.noAffiliations")}
              </div>
            ) : (
              <>
                {/* 当前活跃/有效签约与所属 */}
                {connectedEntities.filter((e) => e.is_current !== false).length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <h3 className="font-mono text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        {t("artist.detail.affiliationsCurrent", { count: connectedEntities.filter((e) => e.is_current !== false).length })}
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {connectedEntities
                        .filter((e) => e.is_current !== false)
                        .map((ent) => (
                          <Link
                            key={ent.entity_id + ent.relationship_type}
                            href={catalogEntityHref(ent.entity_type, ent.entity_id)}
                            className="p-3.5 rounded-lg border border-emerald-500/20 bg-surface hover:border-emerald-500/40 transition-all flex flex-col justify-between gap-3 shadow-2xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-emerald-500/30 grid place-items-center shrink-0">
                                  {ent.entity_type === "studio" || ent.entity_type === "publisher" || ent.entity_type === "label" ? (
                                    <Building className="w-4 h-4 text-emerald-500" />
                                  ) : (
                                    <User className="w-4 h-4 text-emerald-500" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <h3 className="font-semibold text-gray-900 dark:text-white text-xs hover:underline flex items-center gap-1 truncate">
                                    {ent.entity_name}
                                    <ArrowUpRight className="w-3 h-3 text-gray-400 shrink-0" />
                                  </h3>
                                  <span className="font-mono text-[10px] text-gray-500">
                                    {getEntityTypeLabel(ent.entity_type)} {ent.country ? `· ${ent.country}` : ""}
                                  </span>
                                </div>
                              </div>

                              <span className="px-2 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-semibold shrink-0">
                                {ent.label}
                              </span>
                            </div>

                            <div className="pt-2 border-t border-black/5 dark:border-white/[0.06] font-mono text-[10px] text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                              {ent.date_span && (
                                <div className="text-emerald-600 dark:text-emerald-300 font-medium">
                                  <span className="text-gray-400">{t("artist.detail.period")} </span>
                                  {ent.date_span}
                                </div>
                              )}
                              {ent.attributes?.contract_type && (
                                <div>
                                  <span className="text-gray-400">{t("artist.detail.contract")} </span>
                                  <span>{ent.attributes.contract_type}</span>
                                </div>
                              )}
                              {ent.attributes?.position && (
                                <div>
                                  <span className="text-gray-400">{t("artist.detail.role")} </span>
                                  <span>{ent.attributes.position}</span>
                                </div>
                              )}
                            </div>
                          </Link>
                        ))}
                    </div>
                  </div>
                )}

                {/* 历史沿革与过往合作 */}
                {connectedEntities.filter((e) => e.is_current === false).length > 0 && (
                  <div className="space-y-2.5 pt-3 border-t border-black/5 dark:border-white/[0.06]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      <h3 className="font-mono text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        {t("artist.detail.affiliationsHistory", { count: connectedEntities.filter((e) => e.is_current === false).length })}
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-80 hover:opacity-100 transition-opacity">
                      {connectedEntities
                        .filter((e) => e.is_current === false)
                        .map((ent) => (
                          <Link
                            key={ent.entity_id + ent.relationship_type}
                            href={catalogEntityHref(ent.entity_type, ent.entity_id)}
                            className="p-3.5 rounded-lg border border-black/10 dark:border-white/10 bg-surface/60 hover:bg-surface transition-all flex flex-col justify-between gap-3 shadow-2xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 grid place-items-center shrink-0">
                                  {ent.entity_type === "studio" || ent.entity_type === "publisher" || ent.entity_type === "label" ? (
                                    <Building className="w-4 h-4 text-gray-400" />
                                  ) : (
                                    <User className="w-4 h-4 text-gray-400" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-xs hover:underline flex items-center gap-1 truncate">
                                    {ent.entity_name}
                                    <ArrowUpRight className="w-3 h-3 text-gray-400 shrink-0" />
                                  </h3>
                                  <span className="font-mono text-[10px] text-gray-500">
                                    {getEntityTypeLabel(ent.entity_type)} {ent.country ? `· ${ent.country}` : ""}
                                  </span>
                                </div>
                              </div>

                              <span className="px-1.5 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] text-gray-500 border border-black/10 dark:border-white/10 text-[10px] font-mono shrink-0">
                                {ent.label} {t("entity.temporal.historicalTag")}
                              </span>
                            </div>

                            <div className="pt-2 border-t border-black/5 dark:border-white/[0.06] font-mono text-[10px] text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                              {ent.date_span && (
                                <div>
                                  <span className="text-gray-400">{t("artist.detail.period")} </span>
                                  <span>{ent.date_span}</span>
                                </div>
                              )}
                              {ent.attributes?.contract_type && (
                                <div>
                                  <span className="text-gray-400">{t("artist.detail.contract")} </span>
                                  <span>{ent.attributes.contract_type}</span>
                                </div>
                              )}
                            </div>
                          </Link>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Universal Entity Editor (Edit Mode) */}
      <UniversalEntityEditor
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        targetType="artist"
        mode="edit"
        initialData={artist}
        onSuccess={() => {
          setLoading(true);
          fetchApi<ArtistDetailResponse>(`/catalog/artists/${artistId}`)
            .then((res) => setData(res))
            .finally(() => setLoading(false));
        }}
      />

      {/* Revision History & Diff Modal */}
      <RevisionHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        targetType="artist"
        targetId={artist.id}
        entityTitle={localized.title}
      />

      {/* Entity Merge Modal */}
      <EntityMergeModal
        isOpen={isMergeOpen}
        onClose={() => setIsMergeOpen(false)}
        targetType="artist"
        sourceEntity={{ id: artist.id, title: artist.name }}
      />
    </div>
  );
}
