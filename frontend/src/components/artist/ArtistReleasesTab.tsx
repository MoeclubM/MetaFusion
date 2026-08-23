"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Release,
  pickLocalized,
} from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { isDistinctOriginalTitle } from "@/lib/titles";
import {
  LayoutGrid,
  List,
  FolderKanban,
  Search,
  ArrowUpRight,
  Calendar,
  Hash,
  Barcode,
  Disc,
  Layers,
  BookOpen,
  Eye,
  Sparkles,
  Filter,
  ExternalLink,
} from "lucide-react";

interface ArtistReleasesTabProps {
  releases: Release[];
  artistName: string;
}

type ViewMode = "list" | "grid" | "grouped";
type SortOption = "date_desc" | "date_asc" | "title_asc" | "catalog_no";

export function ArtistReleasesTab({ releases, artistName }: ArtistReleasesTabProps) {
  const { t, locale } = useI18n();
  const { packagingLabel, mediumFormatLabel } = useTaxonomy();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("date_desc");

  // Extract unique format options from releases
  const availableFormats = useMemo(() => {
    const formats = new Set<string>();
    releases.forEach((r) => {
      if (r.packaging) formats.add(r.packaging);
      r.mediums?.forEach((m) => {
        if (m.format) formats.add(m.format);
      });
    });
    return Array.from(formats);
  }, [releases]);

  // Filter and sort releases
  const filteredReleases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return releases
      .filter((rel) => {
        // Search filter
        if (q) {
          const workTitle = rel.work?.title?.toLowerCase() || "";
          const workOrigTitle = rel.work?.original_title?.toLowerCase() || "";
          const editionName = rel.edition_name?.toLowerCase() || "";
          const catNo = rel.catalog_number?.toLowerCase() || "";
          const barcode = rel.barcode?.toLowerCase() || "";
          const creatorNames =
            rel.work?.artist_relations
              ?.map((ar) => ar.artist?.name?.toLowerCase() || "")
              .join(" ") || "";

          const matched =
            workTitle.includes(q) ||
            workOrigTitle.includes(q) ||
            editionName.includes(q) ||
            catNo.includes(q) ||
            barcode.includes(q) ||
            creatorNames.includes(q);

          if (!matched) return false;
        }

        // Format filter
        if (formatFilter !== "all") {
          const matchPackaging = rel.packaging === formatFilter;
          const matchMedium = rel.mediums?.some((m) => m.format === formatFilter);
          if (!matchPackaging && !matchMedium) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "date_desc") {
          const dateA = a.edition_date ? new Date(a.edition_date).getTime() : 0;
          const dateB = b.edition_date ? new Date(b.edition_date).getTime() : 0;
          return dateB - dateA;
        }
        if (sortBy === "date_asc") {
          const dateA = a.edition_date ? new Date(a.edition_date).getTime() : Infinity;
          const dateB = b.edition_date ? new Date(b.edition_date).getTime() : Infinity;
          return dateA - dateB;
        }
        if (sortBy === "title_asc") {
          const titleA = a.work?.title || a.edition_name || "";
          const titleB = b.work?.title || b.edition_name || "";
          return titleA.localeCompare(titleB, "zh-CN");
        }
        if (sortBy === "catalog_no") {
          const catA = a.catalog_number || "";
          const catB = b.catalog_number || "";
          return catA.localeCompare(catB);
        }
        return 0;
      });
  }, [releases, searchQuery, formatFilter, sortBy]);

  // Grouped by parent work
  const groupedByWork = useMemo(() => {
    const map = new Map<string, { work: Release["work"]; releases: Release[] }>();

    filteredReleases.forEach((rel) => {
      const key = rel.work_id || rel.work?.id || `unknown-${rel.id}`;
      if (!map.has(key)) {
        map.set(key, {
          work: rel.work,
          releases: [],
        });
      }
      map.get(key)!.releases.push(rel);
    });

    return Array.from(map.entries()).map(([key, data]) => ({
      key,
      work: data.work,
      releases: data.releases,
    }));
  }, [filteredReleases]);

  const getWorkDisplay = (rel: Release) => {
    const w = rel.work;
    if (!w) {
      return {
        title: rel.edition_name || "—",
        originalTitle: undefined,
        workId: rel.work_id,
        coverUrl: undefined,
        coverAspect: undefined,
        tags: [],
        creators: [],
      };
    }

    const localized = pickLocalized(locale, w.translations, w.title, "");
    const title = localized.title || w.title || rel.edition_name;
    const originalTitle = isDistinctOriginalTitle(w.original_title, title) ? w.original_title : undefined;

    const creators = (w.artist_relations || [])
      .filter((ar) => ar.artist?.name && ar.artist.name !== artistName)
      .map((ar) => {
        const arLoc = pickLocalized(locale, ar.artist?.translations, ar.artist?.name || "", "");
        return {
          id: ar.artist_id,
          name: arLoc.title || ar.artist?.name,
          role: ar.role,
        };
      });

    return {
      title,
      originalTitle,
      workId: w.id || rel.work_id,
      coverUrl: w.cover_image_url,
      coverAspect: w.cover_aspect,
      tags: (w.tags || []).map((t: any) => (t?.name ? t.name : typeof t === "string" ? t : "")),
      creators,
    };
  };

  const formatReleaseDate = (dateStr?: string) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.slice(0, 10);
    return d.toISOString().slice(0, 10);
  };

  const getMediumsSummary = (rel: Release) => {
    if (!rel.mediums || rel.mediums.length === 0) return null;
    const totalTracks = rel.mediums.reduce((sum, m) => sum + (m.track_count || m.tracks?.length || 0), 0);
    const formats = Array.from(new Set(rel.mediums.map((m) => mediumFormatLabel(m.format) || m.format))).filter(Boolean);

    return {
      mediumCount: rel.mediums.length,
      trackCount: totalTracks,
      formatLabels: formats.join(" / "),
    };
  };

  if (releases.length === 0) {
    return (
      <div className="rounded-lg border border-black/10 dark:border-white/10 bg-surface p-12 text-center space-y-2">
        <Disc className="w-8 h-8 mx-auto text-gray-400 opacity-60" strokeWidth={1.5} />
        <p className="font-mono text-xs text-gray-500">{t("artist.detail.noReleases")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Control Bar: Search, Filters, View Modes */}
      <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-3 sm:p-3.5 space-y-3 shadow-2xs">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("artist.detail.searchReleasesPlaceholder")}
              className="w-full h-8 pl-8 pr-3 text-xs rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-all font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 font-mono"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Format Filter */}
            {availableFormats.length > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <select
                  value={formatFilter}
                  onChange={(e) => setFormatFilter(e.target.value)}
                  className="h-8 px-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-primary/60"
                >
                  <option value="all">{t("artist.detail.filterAllFormats")}</option>
                  {availableFormats.map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {packagingLabel(fmt) || mediumFormatLabel(fmt) || fmt}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sort Select */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="h-8 px-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-primary/60"
            >
              <option value="date_desc">{t("artist.detail.sortDateDesc")}</option>
              <option value="date_asc">{t("artist.detail.sortDateAsc")}</option>
              <option value="title_asc">{t("artist.detail.sortWorkTitle")}</option>
              <option value="catalog_no">{t("artist.detail.sortCatalogNo")}</option>
            </select>

            {/* View Mode Switcher */}
            <div className="flex items-center p-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.05] border border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title={t("artist.detail.viewList")}
                className={`p-1.5 rounded text-xs transition-colors ${viewMode === "list" ? "bg-white dark:bg-white/15 text-primary dark:text-white shadow-2xs font-semibold" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title={t("artist.detail.viewGrid")}
                className={`p-1.5 rounded text-xs transition-colors ${viewMode === "grid" ? "bg-white dark:bg-white/15 text-primary dark:text-white shadow-2xs font-semibold" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grouped")}
                title={t("artist.detail.viewGrouped")}
                className={`p-1.5 rounded text-xs transition-colors ${viewMode === "grouped" ? "bg-white dark:bg-white/15 text-primary dark:text-white shadow-2xs font-semibold" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}
              >
                <FolderKanban className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Count summary bar */}
        <div className="flex items-center justify-between text-[11px] font-mono text-gray-500 pt-1 border-t border-black/5 dark:border-white/[0.04]">
          <span>
            {searchQuery || formatFilter !== "all"
              ? `${t("artist.detail.versionsCount", { count: filteredReleases.length })} (${t("explore.filterResultReleases", { count: releases.length })})`
              : t("artist.detail.versionsCount", { count: filteredReleases.length })}
          </span>
          {viewMode === "grouped" && (
            <span>{t("work.releases.releaseCount", { count: groupedByWork.length })}</span>
          )}
        </div>
      </div>

      {/* Empty Filter Result */}
      {filteredReleases.length === 0 && (
        <div className="rounded-lg border border-dashed border-black/15 dark:border-white/15 bg-surface/50 p-10 text-center space-y-2">
          <p className="font-mono text-xs text-gray-500">{t("artist.detail.noMatchingReleases")}</p>
          <button
            onClick={() => {
              setSearchQuery("");
              setFormatFilter("all");
            }}
            className="text-xs text-primary hover:underline font-mono"
          >
            {t("artist.detail.filterAll")}
          </button>
        </div>
      )}

      {/* VIEW 1: Rich List Mode */}
      {viewMode === "list" && filteredReleases.length > 0 && (
        <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-2xs divide-y divide-black/5 dark:divide-white/[0.06]">
          {filteredReleases.map((rel) => {
            const workDisplay = getWorkDisplay(rel);
            const dateStr = formatReleaseDate(rel.edition_date);
            const mediumsSummary = getMediumsSummary(rel);

            return (
              <div
                key={rel.id}
                className="p-3 sm:p-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 group"
              >
                <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                  {/* Left: Mother Work Cover Thumbnail */}
                  <Link
                    href={`/works/${workDisplay.workId}`}
                    className="relative w-14 sm:w-16 shrink-0 overflow-hidden rounded-md border border-black/10 dark:border-white/10 bg-black/5 dark:bg-black/30 group/cover hover:ring-2 hover:ring-primary/50 transition-all"
                  >
                    <AdaptiveCover
                      src={workDisplay.coverUrl}
                      alt={workDisplay.title}
                      title={workDisplay.title}
                      originalTitle={workDisplay.originalTitle}
                      id={workDisplay.workId}
                      tags={workDisplay.tags}
                      aspect={workDisplay.coverAspect}
                      className="group-hover/cover:scale-105 transition-transform duration-300"
                    />
                  </Link>

                  {/* Middle: Content Hierarchy */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {/* Primary: Mother Work Title & Original Title */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Link
                        href={`/works/${workDisplay.workId}`}
                        className="font-bold text-sm sm:text-base text-gray-900 dark:text-white hover:text-primary transition-colors line-clamp-1 inline-flex items-center gap-1"
                      >
                        <span>《{workDisplay.title}》</span>
                      </Link>
                      {workDisplay.originalTitle && (
                        <span className="font-mono text-xs text-gray-400 truncate max-w-xs">
                          {workDisplay.originalTitle}
                        </span>
                      )}
                    </div>

                    {/* Secondary: Release Edition Badge & Creators */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {/* Edition Badge */}
                      <Link
                        href={`/releases/${rel.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold text-xs bg-primary/10 dark:bg-primary/20 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
                      >
                        <Layers className="w-3 h-3" />
                        <span className="line-clamp-1">{rel.edition_name}</span>
                        <ArrowUpRight className="w-2.5 h-2.5 opacity-70" />
                      </Link>

                      {/* Packaging Badge */}
                      {rel.packaging && (
                        <span className="px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/5 text-[11px] font-mono text-gray-600 dark:text-gray-300">
                          {packagingLabel(rel.packaging) || rel.packaging}
                        </span>
                      )}

                      {/* Mediums / Tracks info */}
                      {mediumsSummary && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20 text-[11px] font-mono">
                          {mediumsSummary.formatLabels || t("artist.detail.discCount", { count: mediumsSummary.mediumCount })}
                          {mediumsSummary.trackCount > 0 ? t("artist.detail.trackCount", { count: mediumsSummary.trackCount }) : ""}
                        </span>
                      )}

                      {/* Creators Credit */}
                      {workDisplay.creators.length > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-gray-500 truncate">
                          <span className="text-gray-400">·</span>
                          <span className="truncate">
                            {workDisplay.creators
                              .slice(0, 2)
                              .map((c) => `${c.role ? c.role + ": " : ""}${c.name}`)
                              .join(" / ")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Tertiary: Catalog Number, Barcode, Date Meta */}
                    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono text-[11px] text-gray-500 dark:text-gray-400 pt-0.5">
                      {rel.catalog_number && (
                        <span className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-300 font-medium">
                          <Hash className="w-3 h-3 text-gray-400" />
                          <span>{rel.catalog_number}</span>
                        </span>
                      )}
                      {rel.barcode && (
                        <span className="inline-flex items-center gap-1 text-gray-500">
                          <Barcode className="w-3.5 h-3.5 text-gray-400" />
                          <span>{rel.barcode}</span>
                        </span>
                      )}
                      {dateStr && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <span>{dateStr}</span>
                        </span>
                      )}
                      {rel.country && (
                        <span className="text-gray-400">
                          {rel.country}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Quick Action Link */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <Link
                    href={`/releases/${rel.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:text-primary hover:border-primary/40 transition-colors shadow-2xs"
                  >
                    <span>{t("artist.detail.viewRelease")}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-gray-400" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: Grid Cards Mode */}
      {viewMode === "grid" && filteredReleases.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {filteredReleases.map((rel) => {
            const workDisplay = getWorkDisplay(rel);
            const dateStr = formatReleaseDate(rel.edition_date);
            const yearStr = rel.edition_date ? new Date(rel.edition_date).getFullYear() : null;

            return (
              <div
                key={rel.id}
                className="group relative overflow-hidden rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface flex flex-col justify-between shadow-2xs hover:shadow-elevated hover:border-primary/40 transition-all"
              >
                {/* Card Top: Cover with Badges */}
                <div className="relative">
                  <Link href={`/works/${workDisplay.workId}`} className="block overflow-hidden bg-black/5 dark:bg-black/40">
                    <AdaptiveCover
                      src={workDisplay.coverUrl}
                      alt={workDisplay.title}
                      title={workDisplay.title}
                      originalTitle={workDisplay.originalTitle}
                      id={workDisplay.workId}
                      tags={workDisplay.tags}
                      aspect={workDisplay.coverAspect}
                      className="group-hover:scale-105 transition-transform duration-300 origin-center"
                    />
                  </Link>

                  {/* Top-right packaging badge */}
                  {rel.packaging && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded-sm bg-black/75 text-white backdrop-blur-xs font-mono text-[10px] font-semibold tracking-wide">
                      {packagingLabel(rel.packaging) || rel.packaging}
                    </span>
                  )}

                  {/* Bottom-left year badge */}
                  {yearStr && (
                    <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-sm bg-primary/90 text-white backdrop-blur-xs font-mono text-[10px] font-bold">
                      {yearStr}
                    </span>
                  )}
                </div>

                {/* Card Body */}
                <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
                  <div className="space-y-1.5">
                    {/* Mother Work Title */}
                    <Link
                      href={`/works/${workDisplay.workId}`}
                      className="font-bold text-gray-900 dark:text-white text-sm leading-snug line-clamp-1 group-hover:text-primary transition-colors block"
                    >
                      《{workDisplay.title}》
                    </Link>

                    {/* Release Edition Name */}
                    <Link
                      href={`/releases/${rel.id}`}
                      className="block p-1.5 rounded bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-1 text-xs">
                        <span className="font-semibold text-primary line-clamp-1">{rel.edition_name}</span>
                        <ArrowUpRight className="w-3 h-3 text-primary shrink-0 opacity-70" />
                      </div>
                    </Link>

                    {/* Creator Credits */}
                    {workDisplay.creators.length > 0 && (
                      <p className="font-mono text-[11px] text-gray-500 truncate">
                        {workDisplay.creators.map((c) => c.name).join(" / ")}
                      </p>
                    )}
                  </div>

                  {/* Card Footer: Catalog & Barcode */}
                  <div className="pt-2 border-t border-black/5 dark:border-white/[0.06] flex items-center justify-between font-mono text-[10px] text-gray-500">
                    <span className="truncate">{rel.catalog_number || "—"}</span>
                    {dateStr && <span>{dateStr}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 3: Grouped by Mother Work Mode */}
      {viewMode === "grouped" && groupedByWork.length > 0 && (
        <div className="space-y-4">
          {groupedByWork.map((group) => {
            const firstRel = group.releases[0];
            const workDisplay = getWorkDisplay(firstRel);

            return (
              <div
                key={group.key}
                className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-2xs"
              >
                {/* Work Header Section */}
                <div className="p-3.5 sm:p-4 bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/5 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Link
                      href={`/works/${workDisplay.workId}`}
                      className="w-12 h-16 shrink-0 rounded overflow-hidden border border-black/10 dark:border-white/10 bg-black/5 hover:ring-2 hover:ring-primary/40 transition-all"
                    >
                      <AdaptiveCover
                        src={workDisplay.coverUrl}
                        alt={workDisplay.title}
                        title={workDisplay.title}
                        originalTitle={workDisplay.originalTitle}
                        id={workDisplay.workId}
                        tags={workDisplay.tags}
                        aspect={workDisplay.coverAspect}
                      />
                    </Link>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/works/${workDisplay.workId}`}
                          className="font-bold text-base text-gray-900 dark:text-white hover:text-primary transition-colors truncate"
                        >
                          《{workDisplay.title}》
                        </Link>
                        <span className="px-2 py-0.2 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-mono font-semibold shrink-0">
                          {t("work.releases.releaseCount", { count: group.releases.length })}
                        </span>
                      </div>
                      {workDisplay.originalTitle && (
                        <p className="font-mono text-xs text-gray-400 truncate">{workDisplay.originalTitle}</p>
                      )}
                      {workDisplay.creators.length > 0 && (
                        <p className="text-xs text-gray-500 truncate">
                          {workDisplay.creators.map((c) => `${c.role ? c.role + ": " : ""}${c.name}`).join(" / ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <Link
                    href={`/works/${workDisplay.workId}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shrink-0 self-start sm:self-center shadow-2xs"
                  >
                    <span>{t("artist.detail.viewWork")}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {/* Sub-table of Release Editions for this Work */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-black/[0.01] dark:bg-white/[0.01] border-b border-black/5 dark:border-white/5 font-mono text-[10px] uppercase tracking-wider text-gray-400">
                      <tr>
                        <th className="py-2.5 px-4 font-medium">{t("artist.detail.tableReleaseTitle")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("artist.detail.tableFormat")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("artist.detail.tableCatalogNo")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("artist.detail.tableBarcode")}</th>
                        <th className="py-2.5 px-4 text-right font-medium">{t("artist.detail.tableYear")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/[0.04]">
                      {group.releases.map((rel) => {
                        const dateStr = formatReleaseDate(rel.edition_date);
                        return (
                          <tr key={rel.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                            <td className="py-2.5 px-4 font-medium text-gray-900 dark:text-white">
                              <Link
                                href={`/releases/${rel.id}`}
                                className="font-semibold text-primary hover:underline inline-flex items-center gap-1"
                              >
                                {rel.edition_name}
                                <ArrowUpRight className="w-3 h-3 opacity-60" strokeWidth={1.5} />
                              </Link>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-gray-500">
                              {rel.packaging ? (
                                <span className="px-1.5 py-0.5 rounded bg-black/[0.03] dark:bg-white/[0.05] border border-black/5 dark:border-white/5 text-[10px]">
                                  {packagingLabel(rel.packaging) || rel.packaging}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-gray-700 dark:text-gray-300 font-medium">
                              {rel.catalog_number || "—"}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-gray-500">
                              {rel.barcode || "—"}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-gray-500 text-right">
                              {dateStr || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
