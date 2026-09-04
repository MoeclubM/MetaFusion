"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import {
  fetchApi,
  CanonicalEntryDetailResponse,
  ConnectedEntityItem,
  pickLocalized,
  fetchEntityGraph,
  catalogEntityHref,
  GraphNode,
  GraphLink,
} from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import {
  Disc,
  ArrowLeft,
  ExternalLink,
  User,
  Building2,
  Clock,
  Layers,
  Network,
  List,
  Calendar,
  Barcode,
  Hash,
  Sparkles,
} from "lucide-react";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";
import { RevisionHistoryModal } from "@/components/editor/RevisionHistoryModal";
import { EntityActionToolbar } from "@/components/entity/EntityActionToolbar";
import FavoriteButton from "@/components/FavoriteButton";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { ExternalAuthorityLinks } from "@/components/entity/ExternalAuthorityLinks";
import { DynamicAttributeViewer } from "@/components/attributes/DynamicAttributeViewer";
import dynamic from "next/dynamic";
const InteractiveRelationGraph = dynamic(() => import("@/components/graph/InteractiveRelationGraph").then(m => m.InteractiveRelationGraph), { ssr: false });
import { GroupedRelations } from "@/components/entity/RelationsList";
import { isDistinctOriginalTitle } from "@/lib/titles";

export default function CanonicalEntryDetailPage() {
  const params = useParams();
  const entryId = params.id as string;
  const { t, locale } = useI18n();
  const { roleLabel, mediumFormatLabel, mediaCategoryLabel } = useTaxonomy();

  const [data, setData] = useState<CanonicalEntryDetailResponse | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] } | null>(null);
  const [relationViewMode, setRelationViewMode] = useState<"graph" | "list">("graph");
  const [activeTab, setActiveTab] = useState<"releases" | "credits" | "external" | "graph">("releases");
  const [loading, setLoading] = useState(true);

  // Modals
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const loadEntry = async () => {
    if (!entryId) return;
    setLoading(true);
    try {
      const res = await fetchApi<CanonicalEntryDetailResponse>(
        `/catalog/canonical-entries/${entryId}?inc=relations,revisions`
      );
      setData(res);
    } catch (e) {
      console.error("Failed to load canonical entry detail:", e);
    } finally {
      setLoading(false);
    }

    fetchEntityGraph("canonical_entry", entryId)
      .then((g) => setGraphData(g))
      .catch((err) => console.error("Canonical entry graph fetch failed:", err));
  };

  useEffect(() => {
    loadEntry();
  }, [entryId]);

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${h}:${String(remM).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="relative z-10 min-h-screen grid place-items-center font-mono text-xs text-gray-500">
          {t("canonicalEntry.detail.loading")}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <Navbar />
        <div className="relative z-10 max-w-7xl mx-auto px-4 py-20 text-center font-mono text-xs text-gray-500">
          {t("common.notFoundCanonicalEntry")}
        </div>
      </div>
    );
  }

  const work = data.work;
  const workLocalized = work ? pickLocalized(locale, work.translations, work.title, work.summary) : null;
  const releases = data.releases || [];
  const connectedEntities: ConnectedEntityItem[] = data.connected_entities || [];
  const hasExternalLinks = Boolean(
    (data.external_links && data.external_links.length > 0) ||
    (data.external_ids && Object.keys(data.external_ids).length > 0)
  );
  const workArtistRelations = work?.artist_relations || [];
  const durationText = formatDuration(data.duration || data.duration_seconds);

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <Navbar />

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full space-y-5 flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          {work && workLocalized ? (
            <>
              <Link href={`/works/${work.id}`} className="hover:text-primary transition-colors inline-flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" strokeWidth={1.6} />
                {workLocalized.title}
              </Link>
              <span className="text-gray-400 dark:text-white/20">/</span>
            </>
          ) : (
            <>
              <Link href="/explore" className="hover:text-primary transition-colors inline-flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" strokeWidth={1.6} />
                {t("nav.explore")}
              </Link>
              <span className="text-gray-400 dark:text-white/20">/</span>
            </>
          )}
          <span className="text-gray-900 dark:text-white truncate">{data.title}</span>
        </div>

        {/* Hero Header */}
        <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
            {/* Left: Mother Work Cover */}
            <div className="w-32 sm:w-40 shrink-0">
              <AdaptiveCover
                src={work?.cover_image_url}
                alt={data.title}
                title={data.title}
                originalTitle={work?.original_title}
                id={data.id}
                aspect={work?.cover_aspect || "1:1"}
                className="rounded-md overflow-hidden border border-black/10 dark:border-white/10 bg-background shadow-xs"
              />
            </div>

            {/* Right: Expression Info */}
            <div className="flex-1 space-y-3 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] sm:text-xs tracking-wide">
                  <span className="px-2.5 py-0.5 rounded-sm bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold shadow-xs">
                    {t("canonicalEntry.detail.badge")}
                  </span>
                  {durationText && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
                      <Clock className="w-3 h-3 text-emerald-500" strokeWidth={1.5} />
                      {durationText}
                    </span>
                  )}
                  {data.isrc && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 font-mono">
                      <Hash className="w-3 h-3 text-sky-400" strokeWidth={1.5} />
                      {t("canonicalEntry.detail.isrc", { code: data.isrc })}
                    </span>
                  )}
                  {data.isbn && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 font-mono">
                      <Barcode className="w-3 h-3 text-purple-400" strokeWidth={1.5} />
                      {t("canonicalEntry.detail.isbn", { code: data.isbn })}
                    </span>
                  )}
                  {data.recording_date && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
                      <Calendar className="w-3 h-3 text-amber-400" strokeWidth={1.5} />
                      {data.recording_date}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
                  {data.title}
                </h1>
                {data.sort_title && isDistinctOriginalTitle(data.sort_title, data.title) && (
                  <p className="font-mono text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {data.sort_title}
                  </p>
                )}
                {data.artist_credit && (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">
                    <User className="w-4 h-4 text-emerald-500 shrink-0" strokeWidth={1.5} />
                    <span>{data.artist_credit}</span>
                  </div>
                )}
              </div>

              {/* Mother Work Direct Card */}
              {work && workLocalized && (
                <div className="pt-1">
                  <Link
                    href={`/works/${work.id}`}
                    className="group inline-flex items-center gap-3 p-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all max-w-xl"
                  >
                    <div className="w-10 h-10 rounded overflow-hidden bg-black/5 dark:bg-white/5 shrink-0">
                      <AdaptiveCover
                        src={work.cover_image_url}
                        alt={workLocalized.title}
                        title={workLocalized.title}
                        originalTitle={work.original_title}
                        id={work.id}
                        aspect={work.cover_aspect || "1:1"}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] text-primary uppercase tracking-wider font-semibold">
                        {t("canonicalEntry.detail.partOfWork")}
                      </div>
                      <div className="font-display text-xs sm:text-sm font-bold text-gray-900 dark:text-white group-hover:text-primary truncate">
                        {workLocalized.title}
                      </div>
                      {isDistinctOriginalTitle(work.original_title, workLocalized.title) && (
                        <div className="font-mono text-[10px] text-gray-400 truncate">
                          {work.original_title}
                        </div>
                      )}
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-gray-400 group-hover:text-primary transition-colors shrink-0" />
                  </Link>
                </div>
              )}

              {/* Tags from Work */}
              {work?.tags && work.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {work.tags.map((tag) => (
                    <Link
                      key={tag.id}
                      href={`/explore?tags=${encodeURIComponent(tag.name)}`}
                      className="px-2 py-0.5 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/10 hover:border-primary/50 hover:text-primary transition-colors font-mono text-[10px] text-gray-600 dark:text-gray-400"
                    >
                      #{tag.name}
                    </Link>
                  ))}
                </div>
              )}

              {/* Dynamic Attributes */}
              {data.attributes && Object.keys(data.attributes).length > 0 && (
                <div className="pt-1">
                  <DynamicAttributeViewer attributes={data.attributes} />
                </div>
              )}

              {/* Action Toolbar */}
              <div className="pt-2.5 border-t border-black/5 dark:border-white/[0.06]">
                <EntityActionToolbar
                  onEdit={() => setIsEditorOpen(true)}
                  onHistory={() => setIsHistoryOpen(true)}
                  entityTypeLabel={t("entity.toolbar.canonical_entry")}
                >
                  <FavoriteButton targetType="canonical_entry" targetId={data.id} />
                </EntityActionToolbar>
              </div>
            </div>
          </div>
        </section>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-black/10 dark:border-white/[0.08] pb-1 overflow-x-auto font-mono text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("releases")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "releases"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <Disc className="w-3.5 h-3.5" />
            <span>{t("canonicalEntry.detail.tabReleases")}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-[10px]">
              {releases.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("credits")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "credits"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>{t("canonicalEntry.detail.tabCredits")}</span>
            {(workArtistRelations.length > 0 || connectedEntities.length > 0) && (
              <span className="px-1.5 py-0.2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-[10px]">
                {workArtistRelations.length + connectedEntities.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("external")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "external"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t("canonicalEntry.detail.tabExternalLinks")}</span>
          </button>

          {(connectedEntities.length > 0 || (graphData && graphData.nodes.length > 1)) && (
            <button
              type="button"
              onClick={() => setActiveTab("graph")}
              className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === "graph"
                  ? "border-b-2 border-primary text-primary bg-primary/5"
                  : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>{t("canonicalEntry.detail.tabGraph")}</span>
            </button>
          )}
        </div>

        {/* Tab 1: Appears on Releases */}
        {activeTab === "releases" && (
          <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft">
            <div className="px-3.5 sm:px-4 py-3 border-b border-black/5 dark:border-white/[0.06] flex items-center justify-between bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" strokeWidth={1.5} />
                <h2 className="font-display text-sm font-bold tracking-tight text-gray-900 dark:text-white">
                  {t("canonicalEntry.detail.tabReleases")}
                </h2>
                <span className="font-mono text-xs text-gray-500">({releases.length})</span>
              </div>
            </div>

            {releases.length === 0 ? (
              <div className="p-10 text-center font-mono text-xs text-gray-500">
                {t("canonicalEntry.detail.noReleases")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/5 dark:border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="py-2.5 px-3.5 w-14 font-medium">{t("canonicalEntry.detail.tableCover")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("canonicalEntry.detail.tableReleaseName")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("canonicalEntry.detail.tablePublisher")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("canonicalEntry.detail.tableMediumTrack")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("canonicalEntry.detail.tableTrackTitle")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("canonicalEntry.detail.tableISRC")}</th>
                      <th className="py-2.5 px-3.5 text-right font-medium">{t("canonicalEntry.detail.tableDuration")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                    {releases.map((rel, idx) => {
                      const dur = formatDuration(rel.duration_seconds);
                      const fLabel = mediumFormatLabel(rel.medium_format);
                      const cLabel = mediaCategoryLabel(rel.media_category);
                      const specLabel = [fLabel, cLabel && cLabel !== fLabel ? cLabel : null].filter(Boolean).join(" · ");
                      return (
                        <tr key={`${rel.release_id}-${rel.medium_position}-${rel.track_position}-${idx}`} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 px-3.5">
                            <div className="w-10 h-10 rounded overflow-hidden bg-black/5 dark:bg-white/5 shadow-xs">
                              <AdaptiveCover
                                src={rel.cover_image_url || work?.cover_image_url}
                                alt={rel.edition_name}
                                title={rel.edition_name}
                                id={rel.release_id}
                                aspect={rel.cover_aspect || work?.cover_aspect || "1:1"}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 font-medium text-gray-900 dark:text-white max-w-[240px]">
                            <Link
                              href={`/releases/${rel.release_id}`}
                              className="hover:text-primary transition-colors line-clamp-2"
                              title={rel.edition_name}
                            >
                              {rel.edition_name}
                            </Link>
                            {rel.edition_date && (
                              <div className="font-mono text-[10px] text-gray-400 mt-0.5">
                                {new Date(rel.edition_date).toLocaleDateString()}
                                {rel.country && ` · ${rel.country}`}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-600 dark:text-gray-400">
                            {rel.publisher_entity ? (
                              <Link
                                href={`/artists/${rel.publisher_entity.id}`}
                                className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
                              >
                                <Building2 className="w-3 h-3 shrink-0" strokeWidth={1.5} />
                                <span className="truncate max-w-[160px]">{rel.publisher_entity.name}</span>
                              </Link>
                            ) : (
                              <span>{rel.publisher || "—"}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-500 font-mono text-[11px]">
                            <div>
                              {t("canonicalEntry.detail.discTrackFormat", {
                                disc: rel.medium_position || 1,
                                track: rel.track_position || 1,
                              })}
                            </div>
                            {specLabel && (
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                {rel.medium_name ? `${rel.medium_name} (${specLabel})` : specLabel}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-900 dark:text-white">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>{rel.track_title || data.title}</span>
                              {rel.track_title && rel.track_title !== data.title && (
                                <span className="px-1.5 py-0.2 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[9px] font-mono">
                                  {t("canonicalEntry.detail.overriddenTrackTitle")}
                                </span>
                              )}
                            </div>
                            {rel.artist_credit && rel.artist_credit !== data.artist_credit && (
                              <div className="font-mono text-[10px] text-gray-400 mt-0.5">
                                {rel.artist_credit}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-500 font-mono text-[11px]">
                            {rel.isrc || data.isrc || "—"}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono text-gray-500 tabular-nums">
                            {dur || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Cast & Credits */}
        {activeTab === "credits" && (
          <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 space-y-5 shadow-soft">
            {/* Work-level Creators */}
            {workArtistRelations.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-2">
                  <User className="w-4 h-4 text-emerald-500" strokeWidth={1.5} />
                  <h3 className="font-display text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                    {t("canonicalEntry.detail.workLevelCredits")}
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {workArtistRelations.map((rel) => (
                    <Link
                      key={rel.id}
                      href={`/artists/${rel.artist_id}`}
                      className="flex items-center gap-2.5 p-2.5 rounded-md border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 grid place-items-center shrink-0">
                        <User className="w-4 h-4 text-primary" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-xs text-gray-900 dark:text-white truncate">
                          {rel.artist?.name || "—"}
                        </div>
                        <div className="font-mono text-[10px] text-gray-500">
                          {roleLabel(rel.role)}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Expression-level Credits */}
            {connectedEntities.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-2">
                  <Sparkles className="w-4 h-4 text-amber-400" strokeWidth={1.5} />
                  <h3 className="font-display text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                    {t("canonicalEntry.detail.expressionLevelCredits")}
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {connectedEntities.map((ent, idx) => (
                    <Link
                      key={`${ent.entity_id}-${idx}`}
                      href={catalogEntityHref(ent.entity_type, ent.entity_id)}
                      className="flex items-center gap-2.5 p-2.5 rounded-md border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                    >
                      <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 grid place-items-center shrink-0">
                        <User className="w-4 h-4 text-amber-500" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-xs text-gray-900 dark:text-white truncate">
                          {ent.entity_name || "—"}
                        </div>
                        <div className="font-mono text-[10px] text-gray-500">
                          {ent.label || ent.relationship_name || ent.relationship_type}
                          {ent.qualifier && ` (${ent.qualifier})`}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {workArtistRelations.length === 0 && connectedEntities.length === 0 && (
              <div className="p-8 text-center font-mono text-xs text-gray-500">
                {t("canonicalEntry.detail.noCredits")}
              </div>
            )}
          </section>
        )}

        {/* Tab 3: External Links & DB IDs */}
        {activeTab === "external" && (
          <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 space-y-4 shadow-soft">
            <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-2">
              <ExternalLink className="w-4 h-4 text-primary" strokeWidth={1.5} />
              <h3 className="font-display text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                {t("canonicalEntry.detail.tabExternalLinks")}
              </h3>
            </div>

            {hasExternalLinks ? (
              <ExternalAuthorityLinks
                externalIds={data.external_ids}
                externalLinks={data.external_links}
                category="canonical_entry"
              />
            ) : (
              <div className="p-8 text-center font-mono text-xs text-gray-500">
                {t("canonicalEntry.detail.noExternalLinks")}
              </div>
            )}
          </section>
        )}

        {/* Tab 4: Relation Network */}
        {activeTab === "graph" && (
          <div>
            {relationViewMode === "graph" && graphData && graphData.nodes.length > 0 ? (
              <InteractiveRelationGraph
                centerEntityId={data.id}
                centerEntityType="canonical_entry"
                nodes={graphData.nodes}
                links={graphData.links}
                height={580}
                title={t("graph.titleCanonicalEntry")}
                headerRightExtra={
                  connectedEntities.length > 0 ? (
                    <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 border border-border/50 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setRelationViewMode("graph")}
                        className="px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all bg-background text-foreground shadow-xs"
                      >
                        <Network className="w-3 h-3" />
                        <span>{t("graph.viewGraph")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelationViewMode("list")}
                        className="px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all text-muted-foreground hover:text-foreground"
                      >
                        <List className="w-3 h-3" />
                        <span>{t("graph.viewList")}</span>
                      </button>
                    </div>
                  ) : null
                }
              />
            ) : (
              <section className="p-4 sm:p-5 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
                <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-2.5">
                  <h2 className="font-display text-sm font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
                    <Network className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    <span>{t("canonicalEntry.detail.tabGraph")}</span>
                  </h2>
                  {graphData && graphData.nodes.length > 0 && (
                    <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 border border-border/50 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setRelationViewMode("graph")}
                        className="px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all text-muted-foreground hover:text-foreground"
                      >
                        <Network className="w-3 h-3" />
                        <span>{t("graph.viewGraph")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelationViewMode("list")}
                        className="px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all bg-background text-foreground shadow-xs"
                      >
                        <List className="w-3 h-3" />
                        <span>{t("graph.viewList")}</span>
                      </button>
                    </div>
                  )}
                </div>
                <GroupedRelations items={connectedEntities} />
              </section>
            )}
          </div>
        )}
      </main>

      {/* Universal Entity Editor Modal */}
      {isEditorOpen && (
        <UniversalEntityEditor
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          targetType="canonical_entry"
          mode="edit"
          initialData={data}
          onSuccess={() => {
            setIsEditorOpen(false);
            loadEntry();
          }}
        />
      )}

      {/* Revision History Modal */}
      {isHistoryOpen && (
        <RevisionHistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          targetType="canonical_entry"
          targetId={data.id}
          entityTitle={data.title}
        />
      )}
    </div>
  );
}
