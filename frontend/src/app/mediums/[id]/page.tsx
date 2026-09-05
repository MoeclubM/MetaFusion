"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { fetchApi, Medium, Release, Track, Work, pickLocalized } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { ArrowLeft, ArrowRight, FileText, HardDrive, Layers } from "lucide-react";

type MediumDetailResponse = {
  medium: Medium;
  release: Release;
};

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function MediumDetailPage() {
  const params = useParams();
  const mediumId = params.id as string;
  const { t, locale } = useI18n();
  const { mediumFormatLabel, mediaCategoryLabel } = useTaxonomy();
  const [data, setData] = useState<MediumDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mediumId) return;
    setLoading(true);
    fetchApi<MediumDetailResponse>(`/catalog/mediums/${mediumId}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [mediumId]);

  if (loading) {
    return <div className="min-h-screen bg-background grid place-items-center font-mono text-xs text-gray-500">{t("medium.detail.loading")}</div>;
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <Navbar />
        <main className="relative z-10 max-w-7xl mx-auto px-4 py-20 text-center font-mono text-xs text-gray-500">
          {t("medium.detail.notFound")}
        </main>
      </div>
    );
  }

  const medium = data.medium;
  const release = data.release;
  const work = release.work;
  const workLoc = work ? pickLocalized(locale, work.translations, work.title, work.summary) : null;
  const mediumTitle = medium.localized_name || medium.name;
  const tracks = medium.tracks || [];

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-violet-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="relative z-10 flex-1">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-5 w-full space-y-5 pb-10">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500 flex-wrap">
            {work && workLoc && (
              <>
                <Link href={`/works/${work.id}`} className="hover:text-primary transition-colors inline-flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" />
                  {workLoc.title}
                </Link>
                <span>/</span>
              </>
            )}
            <Link href={`/releases/${release.id}`} className="hover:text-primary transition-colors truncate max-w-[18rem]">
              {release.localized_edition_name || release.edition_name}
            </Link>
            <span>/</span>
            <span className="text-gray-900 dark:text-white truncate">{mediumTitle}</span>
          </div>

          <section className="p-5 sm:p-7 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-500 grid place-items-center shrink-0">
                <HardDrive className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="px-2 py-0.5 rounded-sm bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-300 font-mono text-[10px] tracking-wider">
                    {t("medium.detail.badge")}
                  </span>
                  <span className="text-xs font-mono text-gray-500">{t(`explore.mediumRole.${medium.role || "primary"}`)}</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-gray-900 dark:text-white break-words">{mediumTitle}</h1>
                {workLoc && <p className="text-sm text-gray-500 mt-1">{workLoc.title}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.format")}</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{mediumFormatLabel(medium.format) || medium.format}</p>
              </div>
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.category")}</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{mediaCategoryLabel(medium.media_category) || medium.media_category}</p>
              </div>
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.position")}</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{medium.number || `#${medium.position}`}</p>
              </div>
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.trackCount")}</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{medium.track_count || tracks.length}</p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <h2 className="font-display font-bold text-gray-900 dark:text-white">{t("medium.detail.tracksTitle")}</h2>
              </div>
              <span className="font-mono text-xs text-gray-500">{tracks.length}</span>
            </div>
            {tracks.length === 0 ? (
              <div className="p-8 text-center font-mono text-xs text-gray-500">{t("medium.detail.noTracks")}</div>
            ) : (
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                {tracks.map((track: Track) => {
                  const trackTitle = track.localized_title || track.title || track.canonical_entry?.localized_title || track.canonical_entry?.title || t("medium.detail.untitledTrack");
                  const contentLinks = (track.contents || []).map((content) => content.canonical_entry).filter(Boolean);
                  const legacyContent = track.canonical_entry ? [track.canonical_entry] : [];
                  const linkedContents = [...legacyContent, ...contentLinks].filter((entry, index, all) => entry && all.findIndex((item) => item?.id === entry.id) === index);
                  return (
                    <div key={track.id} className="p-4 flex items-start gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                      <span className="w-8 shrink-0 text-right font-mono text-xs text-gray-500 pt-0.5">{track.number || track.position}</span>
                      <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{trackTitle}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 font-mono text-[11px] text-gray-500">
                          {track.duration_seconds && <span>{formatDuration(track.duration_seconds)}</span>}
                          {track.artist_credit && <span className="truncate max-w-[20rem]">{track.artist_credit}</span>}
                        </div>
                        {linkedContents.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {linkedContents.map((entry) => (
                              <Link key={entry!.id} href={`/canonical-entries/${entry!.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 text-[11px] hover:bg-primary/15">
                                {entry!.localized_title || entry!.title}
                                <ArrowRight className="w-2.5 h-2.5" />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
