"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Entity, fetchAllPages, mapLimit, title as entityTitle } from "@/components/catalog/api";
import { fetchApi } from "@/lib/api";
import { useDefinitions, getTermName } from "@/lib/definitions";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, ArrowRight, FileText, HardDrive, Layers } from "lucide-react";

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

type TrackRow = {
  track: Entity;
  duration: number;
  contents: { id: string; title: string }[];
};

// 载体详情页：统一 DTO 数据源（/catalog/entities）。面包屑 作品 → 发行版 → 载体，
// 曲目按 medium_id 列出，其收录内容（表达）逐条解析出标题。
export default function MediumDetailPage() {
  const params = useParams();
  const mediumId = params.id as string;
  const { t, locale } = useI18n();
  const { definitions: defs } = useDefinitions();
  const [medium, setMedium] = useState<Entity | null>(null);
  const [release, setRelease] = useState<Entity | null>(null);
  const [work, setWork] = useState<Entity | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!mediumId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const m = await fetchApi<Entity>(`/catalog/entities/${mediumId}`);
        if (cancelled) return;
        setMedium(m);
        if (m.release_id) {
          const rel = await fetchApi<Entity>(`/catalog/entities/${m.release_id}`);
          if (cancelled) return;
          setRelease(rel);
          const workId = rel.subjects?.[0]?.work_id;
          if (workId) {
            const w = await fetchApi<Entity>(`/catalog/entities/${workId}`);
            if (!cancelled) setWork(w);
          }
        }
        const trackEntities = await fetchAllPages<Entity>(`/catalog/entities?kind=track&medium_id=${encodeURIComponent(mediumId)}`);
        // 曲目的收录（表达）标题解析：先收集唯一表达 id，再受控并发逐条取。
        const exprIds = Array.from(new Set(trackEntities.flatMap((tr) => (tr.contents || []).map((c) => c.expression_id)).filter(Boolean) as string[]));
        const exprTitles = new Map<string, string>();
        await mapLimit(exprIds, 8, async (id) => {
          try {
            const e = await fetchApi<Entity>(`/catalog/entities/${id}`);
            exprTitles.set(id, entityTitle(e, locale) || e.title || "");
          } catch { /* 缺失的表达跳过 */ }
        });
        if (cancelled) return;
        setTracks(trackEntities
          .slice()
          .sort((a, b) => (a.position || 0) - (b.position || 0))
          .map((tr) => ({
            track: tr,
            duration: Number(tr.attributes?.duration) || 0,
            contents: (tr.contents || [])
              .map((c) => ({ id: c.expression_id, title: exprTitles.get(c.expression_id) || "" }))
              .filter((c) => c.id && c.title),
          })));
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediumId, locale]);

  const mediumTitle = useMemo(() => (medium ? entityTitle(medium, locale) || medium.title || mediumId : ""), [medium, locale]);
  const formatCode = String(medium?.attributes?.format || "");
  const formatLabel = formatCode ? getTermName(defs, "format", formatCode, locale) : "";
  const roleCode = String(medium?.attributes?.role || "");
  const roleLabel = roleCode ? getTermName(defs, "role", roleCode, locale) : "";

  if (loading) {
    return <div className="min-h-screen bg-background grid place-items-center font-mono text-xs text-gray-500">{t("medium.detail.loading")}</div>;
  }

  if (notFound || !medium) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <Navbar />
        <main className="relative z-10 max-w-7xl mx-auto px-4 py-20 text-center font-mono text-xs text-gray-500">
          {t("medium.detail.notFound")}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-violet-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="relative z-10 flex-1">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-5 w-full space-y-5 pb-10">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500 flex-wrap">
            {work && work.id && (
              <>
                <Link href={`/works/${work.id}`} className="hover:text-primary transition-colors inline-flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" />
                  {entityTitle(work, locale) || work.title}
                </Link>
                <span>/</span>
              </>
            )}
            {release && release.id && (
              <>
                <Link href={`/releases/${release.id}`} className="hover:text-primary transition-colors truncate max-w-[18rem]">
                  {entityTitle(release, locale) || release.title}
                </Link>
                <span>/</span>
              </>
            )}
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
                  {roleLabel && <span className="text-xs font-mono text-gray-500">{roleLabel}</span>}
                </div>
                <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-gray-900 dark:text-white break-words">{mediumTitle}</h1>
                {work && (
                  <p className="text-sm text-gray-500 mt-1">
                    {entityTitle(work, locale) || work.title}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.format")}</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{formatLabel || formatCode || "—"}</p>
              </div>
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.position")}</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{medium.number || `#${medium.position ?? 0}`}</p>
              </div>
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.trackCount")}</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{tracks.length}</p>
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
                {tracks.map(({ track, duration, contents }) => {
                  const trackTitle = entityTitle(track, locale) || track.title || t("medium.detail.untitledTrack");
                  return (
                    <div key={track.id} className="p-4 flex items-start gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                      <span className="w-8 shrink-0 text-right font-mono text-xs text-gray-500 pt-0.5">{track.number || track.position}</span>
                      <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{trackTitle}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 font-mono text-[11px] text-gray-500">
                          {duration > 0 && <span>{formatDuration(duration)}</span>}
                        </div>
                        {contents.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {contents.map((entry) => (
                              <Link key={entry.id} href={`/catalog/${entry.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 text-[11px] hover:bg-primary/15">
                                {entry.title}
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
