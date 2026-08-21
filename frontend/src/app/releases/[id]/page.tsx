"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { fetchApi, Release, Work, Category, categoryDisplayName, getRoleName } from "@/lib/api";
import { entryLabel, mediumLabel, entryRowHeader } from "@/lib/mediaLabels";
import { useAuth } from "@/lib/authContext";
import { usePlayer } from "@/lib/playerContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Copy, Check, HardDrive, Disc, Play, Download, ArrowLeft, ExternalLink, User, Building2, Edit3, History, Database } from "lucide-react";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";
import { RevisionHistoryModal } from "@/components/editor/RevisionHistoryModal";
import { EntityActionToolbar } from "@/components/entity/EntityActionToolbar";

type ReleaseWithWork = Release & { work?: Work };

export default function ReleaseDetailPage() {
  const params = useParams();
  const releaseId = params.id as string;
  const { user } = useAuth();
  const { playTrack } = usePlayer();
  const { t, locale } = useI18n();
  const [release, setRelease] = useState<ReleaseWithWork | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Edit and Revision History Modals
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    if (!releaseId) return;
    setLoading(true);
    fetchApi<ReleaseWithWork>(`/catalog/releases/${releaseId}`)
      .then(setRelease)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [releaseId]);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(id);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleDownload = async (assetId: string) => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setDownloadingId(assetId);
    try {
      const res = await fetchApi<{ download_url: string }>(`/storage/download/${assetId}`);
      window.open(res.download_url, "_blank");
    } catch (err: any) {
      alert(err.message || t("release.detail.downloadFailed"));
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden"><div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden /><div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden /><div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden /><div className="relative z-10 min-h-screen grid place-items-center font-mono text-xs text-gray-500">{t("release.detail.loading")}</div></div>;
  if (!release) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <Navbar />
        <div className="relative z-10 max-w-7xl mx-auto px-4 py-20 text-center font-mono text-xs text-gray-500">{t("common.notFoundRelease")}</div>
      </div>
    );
  }

  const work = release.work;
  const mediaType = work?.media_type || "music";
  const eLabel = entryLabel(mediaType, t);
  const mLabel = mediumLabel(mediaType, t);

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <Navbar />
      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full space-y-5 flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          {work && (
            <>
              <Link href={`/works/${work.id}`} className="hover:text-primary transition-colors inline-flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" strokeWidth={1.6} />
                {work.title}
              </Link>
              <span className="text-gray-400 dark:text-white/20">/</span>
            </>
          )}
          <span className="text-gray-900 dark:text-white truncate">{release.edition_name}</span>
        </div>

        <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-primary border-b border-black/5 dark:border-white/[0.06] pb-3">
            <Database className="w-3.5 h-3.5" />
            <span>RELEASE EDITION · FRBR MANIFESTATION</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-wide">
                <span className="px-2 py-0.5 rounded-sm bg-primary text-white font-semibold">{t("release.detail.badge")}</span>
                {work && <span className="px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">{work.category ? categoryDisplayName(work.category as Category, locale) : mediaType}</span>}
                {release.catalog_number && <span className="text-gray-500">{release.catalog_number}</span>}
                {release.barcode && <span className="text-gray-500">{t("release.detail.barcode", { code: release.barcode })}</span>}
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">{release.edition_name}</h1>
              {work && (
                <Link href={`/works/${work.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  {t("release.detail.belongTo", { title: work.title })} <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                </Link>
              )}
            </div>
            <div className="font-mono text-xs text-gray-500 space-y-1 sm:text-right shrink-0">
              {(release.publisher_entity || release.publisher) && (
                <div>
                  {t("release.detail.publisherLabel")}
                  {release.publisher_entity ? (
                    <Link href={`/artists/${release.publisher_entity.id}`} className="text-primary hover:underline font-semibold inline-flex items-center gap-1 ml-1">
                      <Building2 className="w-3 h-3" strokeWidth={1.5} /> {release.publisher_entity.name}
                    </Link>
                  ) : (
                    <span className="text-gray-900 dark:text-white ml-1">{release.publisher}</span>
                  )}
                </div>
              )}
              {release.edition_date && <div>{t("release.detail.dateLabel")}{new Date(release.edition_date).toLocaleDateString()}</div>}
              {release.uploader && <div>{t("release.detail.uploaderLabel")}{release.uploader.username}</div>}
            </div>
          </div>
          {release.notes && <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400 border-t border-black/5 dark:border-white/[0.06] pt-3">{release.notes}</p>}
          {work?.artist_relations && work.artist_relations.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2.5 border-t border-black/5 dark:border-white/[0.06]">
              {work.artist_relations.map((rel) => (
                <Link key={rel.id} href={`/artists/${rel.artist_id}`} className="px-2 py-0.5 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-xs text-gray-700 dark:text-gray-300 hover:text-primary inline-flex items-center gap-1 transition-colors">
                  <User className="w-3 h-3 text-primary" strokeWidth={1.5} />
                  <span className="font-mono text-[10px] text-gray-500">{getRoleName(rel.role, t)}:</span> {rel.artist?.name}
                </Link>
              ))}
            </div>
          )}

          {/* Action Toolbar */}
          <div className="pt-2.5 border-t border-black/5 dark:border-white/[0.06]">
            <EntityActionToolbar
              onEdit={() => setIsEditorOpen(true)}
              onHistory={() => setIsHistoryOpen(true)}
              entityTypeLabel={t("entity.toolbar.release")}
            />
          </div>
        </section>

        {release.mediums && release.mediums.length > 0 ? (
          <div className="space-y-4 sm:space-y-5">
            {release.mediums
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((med) => {
                const tracks = med.tracks || [];
                const files = med.asset_files || [];
                return (
                  <section key={med.id} id={`medium-${med.id}`} className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft">
                    <div className="px-3.5 sm:px-4 py-2.5 border-b border-black/5 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-black/[0.02] dark:bg-white/[0.02]">
                      <div className="flex items-center gap-2">
                        <span className="w-6.5 h-6.5 grid place-items-center rounded-md bg-sky-500/10 border border-sky-500/20">
                          <Disc className="w-3.5 h-3.5 text-sky-500" strokeWidth={1.5} />
                        </span>
                        <span className="font-display text-sm font-bold tracking-tight text-gray-900 dark:text-white">
                          {mLabel}
                          {med.position} · {med.name}
                        </span>
                        <span className="hidden sm:inline font-mono text-[11px] text-gray-500">{med.format} · {med.media_category}</span>
                      </div>
                      <a href={`#medium-${med.id}`} className="font-mono text-[10px] text-gray-400 hover:text-primary">
                        #{med.id.slice(0, 8)}
                      </a>
                    </div>

                    {tracks.length > 0 && (
                      <div className="overflow-x-auto">
                        <div className="px-3.5 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-gray-500">{entryRowHeader(mediaType, t)}</div>
                        <table className="w-full text-left text-xs">
                          <thead className="bg-black/[0.02] dark:bg-white/[0.02] border-y border-black/5 dark:border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-gray-500">
                            <tr>
                              <th className="py-2 px-3.5 w-12 font-medium">{t("release.detail.tablePosition")}</th>
                              <th className="py-2 px-3.5 font-medium">{t("release.detail.tableEntryTitle", { label: eLabel })}</th>
                              <th className="py-2 px-3.5 font-medium">{t("release.detail.tableMasterEntry")}</th>
                              <th className="py-2 px-3.5 font-medium">{t("release.detail.tableCredit")}</th>
                              <th className="py-2 px-3.5 text-right font-medium">{t("release.detail.tableDuration")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                            {tracks
                              .slice()
                              .sort((a, b) => a.position - b.position)
                              .map((tr) => {
                                const displayTitle = tr.title_override || tr.canonical_entry?.title || tr.title;
                                return (
                                  <tr key={tr.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                                    <td className="py-2 px-3.5 font-mono text-gray-500 tabular-nums">{tr.position}</td>
                                    <td className="py-2 px-3.5 font-medium text-gray-900 dark:text-white">{displayTitle}</td>
                                    <td className="py-2 px-3.5 text-gray-500 text-xs">
                                      {tr.canonical_entry ? (
                                        <span className="inline-flex items-center gap-1">
                                          {tr.canonical_entry.title}
                                          {tr.title_override && tr.title_override !== tr.canonical_entry.title && <span className="text-amber-500 text-[10px]">[{t("release.detail.overridden")}]</span>}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3.5 text-gray-500">{tr.artist_credit || tr.canonical_entry?.artist_credit || "—"}</td>
                                    <td className="py-2 px-3.5 text-right font-mono text-gray-500 tabular-nums">
                                      {(tr.duration_seconds || tr.canonical_entry?.duration || tr.canonical_entry?.duration_seconds)
                                        ? `${Math.floor(((tr.duration_seconds || tr.canonical_entry?.duration || tr.canonical_entry?.duration_seconds) as number) / 60)}:${String(((tr.duration_seconds || tr.canonical_entry?.duration || tr.canonical_entry?.duration_seconds) as number) % 60).padStart(2, "0")}`
                                        : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {(files.length > 0 || (release.asset_files && release.asset_files.length > 0)) && (
                      <div className="border-t border-black/5 dark:border-white/[0.06]">
                        <div className="px-3.5 py-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">{t("release.detail.assetFiles")}</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-black/[0.02] dark:bg-white/[0.02] border-y border-black/5 dark:border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-gray-500">
                              <tr>
                                <th className="py-2 px-3.5 font-medium">{t("release.detail.tableFileName")}</th>
                                <th className="py-2 px-3.5 font-medium">{t("release.detail.tableSize")}</th>
                                <th className="py-2 px-3.5 font-medium">{t("release.detail.tableSha256")}</th>
                                <th className="py-2 px-3.5 text-right font-medium">{t("release.detail.tableAction")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                              {(files.length > 0 ? files : release.asset_files || []).map((asset) => (
                                <tr key={asset.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                                  <td className="py-2.5 px-3.5 font-medium text-gray-900 dark:text-white inline-flex items-center gap-1.5">
                                    <HardDrive className="w-3.5 h-3.5 text-gray-400" strokeWidth={1.4} />
                                    <span className="truncate max-w-md">{asset.file_name}</span>
                                  </td>
                                  <td className="py-2.5 px-3.5 font-mono text-gray-500 tabular-nums whitespace-nowrap">{(asset.file_size / (1024 * 1024)).toFixed(2)} MB</td>
                                  <td className="py-2.5 px-3.5 font-mono text-[11px] text-gray-500">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="truncate max-w-[18ch]">{asset.sha256_hash}</span>
                                      <button onClick={() => copyText(asset.sha256_hash, asset.id)} className="w-5 h-5 grid place-items-center rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-400 hover:text-primary transition-colors">
                                        {copiedHash === asset.id ? <Check className="w-3 h-3 text-emerald-500" strokeWidth={1.7} /> : <Copy className="w-3 h-3" strokeWidth={1.5} />}
                                      </button>
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right space-x-1.5 whitespace-nowrap">
                                    {(asset.mime_type?.startsWith("audio/") || asset.technical_specs?.preview_audio_url) && (
                                      <button
                                        onClick={() => {
                                          if (!user) { window.location.href = "/login"; return; }
                                          playTrack({
                                            id: asset.id,
                                            title: asset.file_name,
                                            artist: work?.title || release.edition_name,
                                            album: release.edition_name,
                                            coverUrl: work?.cover_image_url,
                                            audioUrl: asset.technical_specs?.preview_audio_url || `/storage/preview/${asset.id}/preview.m4a`,
                                          });
                                        }}
                                        className="px-2.5 h-7 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:text-primary inline-flex items-center gap-1 text-xs"
                                      >
                                        <Play className="w-3 h-3 fill-current" strokeWidth={1.5} />
                                        <span>{t("release.detail.preview")}</span>
                                      </button>
                                    )}
                                    <button onClick={() => handleDownload(asset.id)} disabled={downloadingId === asset.id} className="px-3 h-7 rounded-md bg-primary text-white hover:opacity-90 font-semibold inline-flex items-center gap-1 text-xs transition-opacity">
                                      <Download className="w-3 h-3" strokeWidth={1.6} />
                                      <span>{downloadingId === asset.id ? t("common.generating") : t("release.detail.download")}</span>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
          </div>
        ) : (
          <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-8 text-center font-mono text-xs text-gray-500">{t("release.detail.noMedium")}</div>
        )}
      </main>

      {/* Universal Entity Editor (Edit Mode) */}
      <UniversalEntityEditor
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        targetType="release"
        mode="edit"
        initialData={release}
        onSuccess={() => {
          setLoading(true);
          fetchApi<ReleaseWithWork>(`/catalog/releases/${releaseId}`)
            .then(setRelease)
            .finally(() => setLoading(false));
        }}
      />

      {/* Revision History & Diff Modal */}
      <RevisionHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        targetType="release"
        targetId={release.id}
        entityTitle={release.edition_name}
      />
    </div>
  );
}
