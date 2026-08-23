"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import {
  fetchApi,
  Work,
  Artist,
  Release,
  Franchise,
  dictTermLabel,
  workFacetTagGroups,
  pickLocalized,
} from "@/lib/api";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useI18n } from "@/i18n/I18nProvider";
import { EntityCover } from "@/components/common/EntityCover";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { isDistinctOriginalTitle } from "@/lib/titles";
import { Select } from "@/components/ui/Select";
import {
 SlidersHorizontal,
 LayoutGrid,
 List,
 Search,
 Disc3,
 X,
 ArrowRight,
 Tag as TagIcon,
 Check,
 Plus,
 Layers,
 Users,
 Disc,
 Network,
} from "lucide-react";

type ExploreType = "works" | "artists" | "releases" | "franchises";

function ExploreContent() {
  const { t, locale } = useI18n();
  const { taxonomy, entityTypeLabel, packagingLabel } = useTaxonomy();
 const searchParams = useSearchParams();
 const router = useRouter();

 const typeParam = (searchParams.get("type") as ExploreType) || "works";
 const activeType: ExploreType =
 typeParam === "artists" || typeParam === "releases" || typeParam === "franchises" ? typeParam : "works";
 const queryParam = searchParams.get("q") || "";
 const tagsParam = searchParams.get("tags") || "";
 const tagMatchParam = searchParams.get("tag_match") === "all" ? "all" : "any";
 const shelfParam = searchParams.get("shelf") || "";
 const entityTypeParam = searchParams.get("entity_type") || "";
  const [works, setWorks] = useState<Work[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const tagGroups = taxonomy?.tag_groups || {};
  const dynamicEntityTypes = taxonomy?.entity_types || [];
  const [selectedTags, setSelectedTags] = useState<string[]>(
    tagsParam ? tagsParam.split(",").filter(Boolean) : []
  );
  const [searchInput, setSearchInput] = useState<string>(queryParam);
  const [selectedEntityType, setSelectedEntityType] = useState<string>(entityTypeParam);
  const [sortBy, setSortBy] = useState<"created_at" | "release_date" | "title">("created_at");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showTagFilterPanel, setShowTagFilterPanel] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);

 useEffect(() => {
 setSearchInput(queryParam);
 }, [queryParam]);

 useEffect(() => {
 setSelectedTags(tagsParam ? tagsParam.split(",").filter(Boolean) : []);
 }, [tagsParam]);

 useEffect(() => {
 setSelectedEntityType(entityTypeParam);
 }, [entityTypeParam]);

 const updateUrl = (next: {
 type?: ExploreType;
 q?: string;
 tags?: string[];
 entity_type?: string;
 }) => {
 const params = new URLSearchParams();
 const nt = next.type ?? activeType;
 if (nt !== "works") params.set("type", nt);
 const nq = next.q !== undefined ? next.q : queryParam;
 if (nq) params.set("q", nq);
 const nTags = next.tags !== undefined ? next.tags : selectedTags;
 if (nt === "works" && shelfParam) params.set("shelf", shelfParam);
 if (nt === "works" && nTags.length > 0) {
 params.set("tags", nTags.join(","));
 if (tagMatchParam === "all") params.set("tag_match", "all");
 else if (tagMatchParam === "any") params.set("tag_match", "any");
 }
 const nEntity = next.entity_type !== undefined ? next.entity_type : selectedEntityType;
 if (nt === "artists" && nEntity) params.set("entity_type", nEntity);
 const qs = params.toString();
 router.push(qs ? `/explore?${qs}` : "/explore");
 };

 const handleSwitchType = (nt: ExploreType) => {
 router.push(
 (() => {
 const p = new URLSearchParams();
 if (nt !== "works") p.set("type", nt);
 if (queryParam) p.set("q", queryParam);
 if (nt === "works" && shelfParam) p.set("shelf", shelfParam);
 if (nt === "works" && selectedTags.length > 0) {
 p.set("tags", selectedTags.join(","));
 if (tagMatchParam === "all") p.set("tag_match", "all");
 else if (tagMatchParam === "any") p.set("tag_match", "any");
 }
 if (nt === "artists" && selectedEntityType) p.set("entity_type", selectedEntityType);
 const qs = p.toString();
 return qs ? `/explore?${qs}` : "/explore";
 })()
 );
 };

 const loadWorks = async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 if (shelfParam) params.append("shelf", shelfParam);
 if (selectedTags.length > 0) params.append("tags", selectedTags.join(","));
 if (selectedTags.length > 0) params.append("tag_match", tagMatchParam);
 if (queryParam) params.append("q", queryParam);
 const res = await fetchApi<{ items: Work[]; total: number }>(`/catalog/works?${params.toString()}`);
 let items = res.items || [];
 if (sortBy === "release_date") {
 items = [...items].sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""));
 } else if (sortBy === "title") {
 items = [...items].sort((a, b) => a.title.localeCompare(b.title));
 }
 setWorks(items);
 setTotal(res.total ?? items.length);
 } catch {
 setWorks([]);
 setTotal(0);
 } finally {
 setLoading(false);
 }
 };

 const loadArtists = async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 if (queryParam) params.append("q", queryParam);
 if (selectedEntityType) params.append("entity_type", selectedEntityType);
 params.append("page_size", "24");
 const res = await fetchApi<{ items: Artist[]; total: number }>(`/catalog/artists?${params.toString()}`);
 setArtists(res.items || []);
 setTotal(res.total ?? (res.items || []).length);
 } catch {
 setArtists([]);
 setTotal(0);
 } finally {
 setLoading(false);
 }
 };

 const loadReleases = async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 if (queryParam) params.append("q", queryParam);
 params.append("page_size", "24");
 const res = await fetchApi<{ items: Release[]; total: number }>(`/catalog/releases?${params.toString()}`);
 setReleases(res.items || []);
 setTotal(res.total ?? (res.items || []).length);
 } catch {
 setReleases([]);
 setTotal(0);
 } finally {
 setLoading(false);
 }
 };

 const loadFranchises = async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 if (queryParam) params.append("q", queryParam);
 params.append("page_size", "24");
 const res = await fetchApi<{ items: Franchise[]; total: number }>(`/catalog/franchises?${params.toString()}`);
 setFranchises(res.items || []);
 setTotal(res.total ?? (res.items || []).length);
 } catch {
 setFranchises([]);
 setTotal(0);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 if (activeType === "works") loadWorks();
 else if (activeType === "artists") loadArtists();
 else if (activeType === "franchises") loadFranchises();
 else loadReleases();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeType, selectedTags, queryParam, selectedEntityType, sortBy, tagsParam, tagMatchParam, shelfParam]);

 const handleToggleTag = (tagName: string) => {
 const nextTags = selectedTags.includes(tagName)
 ? selectedTags.filter((t) => t !== tagName)
 : [...selectedTags, tagName];
 setSelectedTags(nextTags);
 updateUrl({ tags: nextTags, q: queryParam });
 };

 const handleRemoveTag = (tagName: string) => {
 const nextTags = selectedTags.filter((t) => t !== tagName);
 setSelectedTags(nextTags);
 updateUrl({ tags: nextTags, q: queryParam });
 };

 const handleSearchSubmit = (e: React.FormEvent) => {
 e.preventDefault();
 updateUrl({ q: searchInput.trim() });
 };

 const clearAllFilters = () => {
 setSearchInput("");
 setSelectedTags([]);
 setSelectedEntityType("");
 router.push(activeType === "works" ? "/explore" : `/explore?type=${activeType}`);
 };

 const tagGroupLabels: Record<string, string> = {
 format: t("explore.tagGroup.format"),
 medium: t("explore.tagGroup.medium"),
 genre: t("explore.tagGroup.genre"),
 theme: t("explore.tagGroup.theme"),
 general: t("explore.tagGroup.general"),
 };
 const workTagGroups = workFacetTagGroups(tagGroups);

 const placeholderByType =
 activeType === "artists"
 ? t("explore.searchPlaceholderArtist")
 : activeType === "releases"
 ? t("explore.searchPlaceholderRelease")
 : activeType === "franchises"
 ? t("explore.searchPlaceholderFranchise")
 : t("explore.searchPlaceholder");

    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <Navbar />

        {/* Explore Two-Column Layout */}
        <div className="relative z-10 max-w-[1440px] mx-auto w-full flex-1 flex flex-col md:flex-row items-stretch">
          {/* ===================== Left Sidebar Filter ===================== */}
          <aside className="w-full md:w-64 lg:w-72 shrink-0 border-b md:border-b-0 md:border-r border-black/10 dark:border-white/[0.08] bg-surface/50 backdrop-blur-md p-4 sm:p-5 space-y-6 md:sticky md:top-12 md:h-[calc(100vh-3rem)] md:overflow-y-auto">
            {/* Entity Type Navigation (作品 / 创作者 / 发行版) */}
            <div className="space-y-2">
              <h2 className="text-xs font-mono font-bold tracking-widest text-gray-500 uppercase">
                {t("explore.title")}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-1 gap-1">
                <button
                  onClick={() => handleSwitchType("works")}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors text-left ${
                    activeType === "works"
                      ? "bg-primary text-white shadow-xs"
                      : "text-gray-700 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  }`}
                >
                  <Layers className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t("explore.typeWorks")}</span>
                </button>
                <button
                  onClick={() => handleSwitchType("artists")}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors text-left ${
                    activeType === "artists"
                      ? "bg-primary text-white shadow-xs"
                      : "text-gray-700 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  }`}
                >
                  <Users className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t("explore.typeArtists")}</span>
                </button>
                <button
                  onClick={() => handleSwitchType("releases")}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors text-left ${
                    activeType === "releases"
                      ? "bg-primary text-white shadow-xs"
                      : "text-gray-700 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  }`}
                >
                  <Disc className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t("explore.typeReleases")}</span>
                </button>
                <button
                  onClick={() => handleSwitchType("franchises")}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors text-left ${
                    activeType === "franchises"
                      ? "bg-primary text-white shadow-xs"
                      : "text-gray-700 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  }`}
                >
                  <Network className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t("explore.typeFranchises")}</span>
                </button>
              </div>
            </div>

            {/* Sub-Filters: Works Tags */}
            {activeType === "works" && (
              <div className="space-y-4 pt-4 border-t border-black/5 dark:border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono font-bold tracking-widest text-gray-500 uppercase flex items-center gap-1.5">
                    <TagIcon className="w-3.5 h-3.5" />
                    <span>{t("explore.tagFilter")}</span>
                  </h3>
                  {selectedTags.length > 0 && (
                    <button
                      onClick={() => {
                        setSelectedTags([]);
                        updateUrl({ tags: [], q: queryParam });
                      }}
                      className="text-xs text-primary hover:underline font-mono"
                    >
                      {t("explore.clearTags")}
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  {workTagGroups.map(([groupKey, tagsInGroup]) => (
                    <div key={groupKey} className="space-y-1.5">
                      <div className="font-mono text-[11px] uppercase text-gray-400 font-bold tracking-wider">
                        {tagGroupLabels[groupKey] || groupKey}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {tagsInGroup.map((tg) => {
                          const isChecked = selectedTags.includes(tg.name);
                          return (
                            <button
                              key={tg.id}
                              onClick={() => handleToggleTag(tg.name)}
                              className={`px-2 py-0.5 rounded text-xs font-mono transition-all flex items-center gap-1 border ${
                                isChecked
                                  ? "bg-primary text-white border-primary font-semibold shadow-2xs"
                                  : "bg-black/[0.02] dark:bg-white/[0.03] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-primary/40"
                              }`}
                            >
                              <span>#{tg.name}</span>
                              {isChecked && <Check className="w-2.5 h-2.5" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sub-Filters: Artists Entity Types（词表动态，不写死 code） */}
            {activeType === "artists" && (
              <div className="space-y-2 pt-4 border-t border-black/5 dark:border-white/[0.06]">
                <h3 className="text-xs font-mono font-bold tracking-widest text-gray-500 uppercase">
                  {t("explore.artistFilterTitle")}
                </h3>
                <p className="text-[11px] font-mono text-gray-500 leading-relaxed">
                  {t("explore.artistHint")}
                </p>
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setSelectedEntityType("");
                      updateUrl({ entity_type: "" });
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors text-left ${
                      selectedEntityType === ""
                        ? "bg-primary/10 text-primary font-semibold border border-primary/20"
                        : "text-gray-600 dark:text-gray-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <span>{t("common.all")}</span>
                    {selectedEntityType === "" && <span>✓</span>}
                  </button>
                  {dynamicEntityTypes.map((opt) => {
                    const isSelected = selectedEntityType === opt.id;
                    return (
                      <button
                        key={opt.id}
                        title={opt.desc || undefined}
                        onClick={() => {
                          const next = isSelected ? "" : opt.id;
                          setSelectedEntityType(next);
                          updateUrl({ entity_type: next });
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors text-left ${
                          isSelected
                            ? "bg-primary/10 text-primary font-semibold border border-primary/20"
                            : "text-gray-600 dark:text-gray-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                        }`}
                      >
                        <span className="truncate">{dictTermLabel(opt.id, dynamicEntityTypes)}</span>
                        {isSelected && <span>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sub-Filters: Releases Hint */}
            {activeType === "releases" && (
              <div className="pt-4 border-t border-black/5 dark:border-white/[0.06]">
                <p className="text-xs text-gray-500 font-mono leading-relaxed">
                  {t("explore.releaseHint")}
                </p>
              </div>
            )}
            {activeType === "franchises" && (
              <div className="pt-4 border-t border-black/5 dark:border-white/[0.06]">
                <p className="text-xs text-gray-500 font-mono leading-relaxed">
                  {t("explore.franchiseHint")}
                </p>
              </div>
            )}
          </aside>

          {/* ===================== Right Main Content ===================== */}
          <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-4">
            {/* Top Compact Search & Sorting Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface/80 border border-black/10 dark:border-white/[0.08] p-3 rounded-lg backdrop-blur-md">
              <form onSubmit={handleSearchSubmit} className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder={placeholderByType}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-9 pr-16 h-10 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary font-mono transition-all"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInput("");
                        updateUrl({ q: "" });
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-white"
                      title={t("explore.clearAll")}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-xs font-mono text-gray-700 dark:text-gray-300 transition-colors"
                  >
                    {t("common.search")}
                  </button>
                </div>
              </form>

              <div className="flex items-center gap-2 shrink-0">
                {activeType === "works" && (
                  <>
                    <Select
                      value={sortBy}
                      onChange={(val) => setSortBy(val as typeof sortBy)}
                      fullWidth={false}
                      className="h-10 px-3 text-xs font-mono text-gray-700 dark:text-gray-300 min-w-[9.5rem]"
                      options={[
                        { value: "created_at", label: t("explore.latestAdded") },
                        { value: "release_date", label: t("explore.byYear") },
                        { value: "title", label: t("explore.byName") },
                      ]}
                    />

                    <div className="flex items-center gap-0.5 rounded-md border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-0.5">
                      <button
                        onClick={() => setViewMode("grid")}
                        className={`w-9 h-9 grid place-items-center rounded transition-colors ${
                          viewMode === "grid" ? "bg-surface text-primary shadow-xs" : "text-gray-400 hover:text-gray-700 dark:hover:text-white"
                        }`}
                        title={t("explore.gridView")}
                      >
                        <LayoutGrid className="w-4 h-4" strokeWidth={1.7} />
                      </button>
                      <button
                        onClick={() => setViewMode("list")}
                        className={`w-9 h-9 grid place-items-center rounded transition-colors ${
                          viewMode === "list" ? "bg-surface text-primary shadow-xs" : "text-gray-400 hover:text-gray-700 dark:hover:text-white"
                        }`}
                        title={t("explore.listView")}
                      >
                        <List className="w-4 h-4" strokeWidth={1.7} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Active Filters Summary */}
            {(queryParam || selectedTags.length > 0 || selectedEntityType || shelfParam) && (
              <div className="flex items-center justify-between font-mono text-xs text-gray-500 px-1 flex-wrap gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">
                    {activeType === "works"
                      ? t("explore.filterResult", { count: total })
                      : activeType === "artists"
                      ? t("explore.filterResultArtists", { count: total })
                      : activeType === "franchises"
                      ? t("explore.filterResultFranchises", { count: total })
                      : t("explore.filterResultReleases", { count: total })}
                  </span>
                  {shelfParam && (
                    <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-500 border border-sky-500/20 font-mono text-xs">
                      /{shelfParam}
                    </span>
                  )}
                  {selectedTags.map((tagName) => (
                    <span
                      key={tagName}
                      className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-1.5 font-mono text-xs"
                    >
                      <span>#{tagName}</span>
                      <button onClick={() => handleRemoveTag(tagName)}>
                        <X className="w-3 h-3 hover:text-red-500" />
                      </button>
                    </span>
                  ))}
                  {selectedEntityType && (
                    <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-500 border border-sky-500/20 flex items-center gap-1.5 font-mono text-xs">
                      <span>
                        {entityTypeLabel(selectedEntityType)}
                      </span>
                      <button
                        onClick={() => {
                          setSelectedEntityType("");
                          updateUrl({ entity_type: "" });
                        }}
                      >
                        <X className="w-3 h-3 hover:text-red-500" />
                      </button>
                    </span>
                  )}
                  {queryParam && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono text-xs">
                      {t("explore.keywordLabel")} &ldquo;{queryParam}&rdquo;
                    </span>
                  )}
                </div>
                <button onClick={clearAllFilters} className="text-primary hover:underline shrink-0 font-mono text-xs">
                  {t("explore.clearAll")}
                </button>
              </div>
            )}

            {/* List / Grid Content */}
            {activeType === "works" ? (
              loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-[3/4] rounded-lg bg-black/[0.03] dark:bg-white/[0.03] animate-pulse border border-black/5 dark:border-white/5"
                    />
                  ))}
                </div>
              ) : works.length === 0 ? (
                <div className="p-8 sm:p-10 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-3">
                  <div className="w-10 h-10 rounded-sm bg-primary/10 border border-primary/20 text-primary grid place-items-center mx-auto">
                    <Disc3 className="w-5 h-5 animate-spin-slow" />
                  </div>
                  <div className="space-y-0.5">
                    <h3 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("explore.noMatchTitle")}</h3>
                    <p className="font-mono text-sm text-gray-500 max-w-sm mx-auto">{t("explore.noMatchHint")}</p>
                  </div>
                  <Link
                    href="/contribute"
                    className="inline-flex items-center gap-2 px-3.5 h-9 rounded-md bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t("explore.newWork")}</span>
                  </Link>
                </div>
              ) : viewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {works.map((w) => {
                    const loc = pickLocalized(locale, w.translations, w.title, w.summary);
                    return (
                    <Link
                      key={w.id}
                      href={`/works/${w.id}`}
                      className="group relative rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-sm overflow-hidden shadow-2xs hover:shadow-elevated hover:border-primary/50 transition-all flex flex-col"
                    >
                      <AdaptiveCover
                        src={w.cover_image_url}
                        alt={loc.title}
                        title={loc.title}
                        originalTitle={w.original_title}
                        id={w.id}
                        tags={(w.tags || []).map((t) => (t?.name ? t.name : typeof t === "string" ? t : ""))}
                        aspect={w.cover_aspect}
                        className="bg-black/5 dark:bg-black/40 group-hover:scale-105 transition-transform duration-300 origin-center"
                      />
                      <div className="p-3 space-y-1 flex-1 flex flex-col justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-1 group-hover:text-primary transition-colors">
                            {loc.title}
                          </h3>
                          {isDistinctOriginalTitle(w.original_title, loc.title) && (
                            <p className="font-mono text-xs text-gray-500 line-clamp-1">{w.original_title}</p>
                          )}
                        </div>
                        {w.tags && w.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {w.tags.slice(0, 2).map((tg) => (
                              <span key={tg.id} className="px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] text-[11px] font-mono text-gray-600 dark:text-gray-400">
                                #{tg.name}
                              </span>
                            ))}
                            {w.tags.length > 2 && <span className="text-[11px] font-mono text-gray-400">+{w.tags.length - 2}</span>}
                          </div>
                        )}
                        <div className="pt-1.5 flex items-center justify-between font-mono text-xs text-gray-500 border-t border-black/[0.04] dark:border-white/[0.04]">
                          <span>{w.release_date ? String(w.release_date).slice(0, 4) : "—"}</span>
                          <span className="flex items-center gap-0.5 group-hover:text-primary transition-colors">
                            {t("explore.detail")} <ArrowRight className="w-2.5 h-2.5" />
                          </span>
                        </div>
                      </div>
                    </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-black/10 dark:border-white/10 bg-surface overflow-hidden shadow-2xs divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                  {works.map((w) => {
                    const loc = pickLocalized(locale, w.translations, w.title, w.summary);
                    const showOriginal = isDistinctOriginalTitle(w.original_title, loc.title);
                    const dateLabel = w.release_date ? String(w.release_date).slice(0, 10) : "";
                    return (
                    <Link
                      key={w.id}
                      href={`/works/${w.id}`}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-12 rounded-sm bg-black/5 dark:bg-black/40 overflow-hidden shrink-0">
                          <EntityCover
                            src={w.cover_image_url}
                            alt={loc.title}
                            title={loc.title}
                            originalTitle={w.original_title}
                            id={w.id}
                            imgClassName="w-full h-full object-cover"
                          />
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate group-hover:text-primary transition-colors">
                            {loc.title}
                          </h3>
                          {(showOriginal || dateLabel) && (
                            <p className="font-mono text-xs text-gray-500 truncate">
                              {showOriginal ? w.original_title : ""}
                              {dateLabel ? `${showOriginal ? " · " : ""}${dateLabel}` : ""}
                            </p>
                          )}
                          {w.tags && w.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {w.tags.map((tg) => (
                                <span key={tg.id} className="px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] text-[11px] font-mono text-gray-500">
                                  #{tg.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-primary text-sm font-mono flex items-center gap-1.5 shrink-0">
                        <span>{t("explore.detail")}</span>
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </Link>
                    );
                  })}
                </div>
              )
            ) : activeType === "artists" ? (
              loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-24 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] animate-pulse border border-black/5 dark:border-white/5" />
                  ))}
                </div>
              ) : artists.length === 0 ? (
                <div className="p-8 sm:p-10 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-3">
                  <div className="w-10 h-10 rounded-sm bg-sky-500/10 border border-sky-500/20 text-sky-500 grid place-items-center mx-auto">
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <h3 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("explore.noArtistMatchTitle")}</h3>
                    <p className="font-mono text-sm text-gray-500 max-w-sm mx-auto">{t("explore.noArtistMatchHint")}</p>
                  </div>
                  <Link
                    href="/artists/new"
                    className="inline-flex items-center gap-2 px-3.5 h-9 rounded-md bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t("explore.newArtist")}</span>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {artists.map((a) => {
                    const loc = pickLocalized(locale, a.translations, a.name, a.biography);
                    return (
                    <Link
                      key={a.id}
                      href={`/artists/${a.id}`}
                      className="group p-4 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-sm hover:border-primary/40 hover:shadow-elevated transition-all space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate group-hover:text-primary transition-colors">
                            {loc.title}
                          </h3>
                          {isDistinctOriginalTitle(a.original_name, loc.title) && <p className="font-mono text-xs text-gray-500 truncate">{a.original_name}</p>}
                        </div>
                        <span className="shrink-0 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/5 text-[11px] font-mono text-gray-600 dark:text-gray-400">
                          {entityTypeLabel(a.entity_type)}
                        </span>
                      </div>
                      {a.disambiguation && <p className="text-xs text-gray-500 line-clamp-2">{a.disambiguation}</p>}
                      {loc.body && <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{loc.body}</p>}
                      <div className="flex items-center gap-2 font-mono text-xs text-gray-500 pt-1.5 border-t border-black/[0.04] dark:border-white/[0.04]">
                        {a.country && <span>{a.country}</span>}
                        <span className="ml-auto flex items-center gap-0.5 text-primary">
                          {t("explore.detail")} <ArrowRight className="w-2.5 h-2.5" />
                        </span>
                      </div>
                    </Link>
                    );
                  })}
                </div>
              )
            ) : activeType === "franchises" ? (
              loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-24 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] animate-pulse border border-black/5 dark:border-white/5" />
                  ))}
                </div>
              ) : franchises.length === 0 ? (
                <div className="p-8 sm:p-10 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-3">
                  <div className="w-10 h-10 rounded-sm bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 grid place-items-center mx-auto">
                    <Network className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <h3 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("explore.noFranchiseMatchTitle")}</h3>
                    <p className="font-mono text-sm text-gray-500 max-w-sm mx-auto">{t("explore.noFranchiseMatchHint")}</p>
                  </div>
                  <Link
                    href="/franchises/new"
                    className="inline-flex items-center gap-2 px-3.5 h-9 rounded-md bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t("explore.newFranchise")}</span>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {franchises.map((f) => {
                    const loc = pickLocalized(locale, f.translations, f.title, f.summary);
                    return (
                    <Link
                      key={f.id}
                      href={`/franchises/${f.id}`}
                      className="group p-4 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-sm hover:border-primary/40 hover:shadow-elevated transition-all space-y-1.5"
                    >
                      <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate group-hover:text-primary transition-colors">
                        {loc.title}
                      </h3>
                      {isDistinctOriginalTitle(f.original_title, loc.title) && (
                        <p className="font-mono text-xs text-gray-500 truncate">{f.original_title}</p>
                      )}
                      {f.disambiguation && <p className="text-xs text-gray-500 line-clamp-2">{f.disambiguation}</p>}
                      <span className="ml-auto flex items-center gap-0.5 text-primary font-mono text-xs">
                        {t("explore.detail")} <ArrowRight className="w-2.5 h-2.5" />
                      </span>
                    </Link>
                    );
                  })}
                </div>
              )
            ) : loading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] animate-pulse border border-black/5 dark:border-white/5" />
                ))}
              </div>
            ) : releases.length === 0 ? (
              <div className="p-8 sm:p-10 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-3">
                <div className="w-10 h-10 rounded-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 grid place-items-center mx-auto">
                  <Disc className="w-5 h-5" />
                </div>
                <div className="space-y-0.5">
                  <h3 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("explore.noReleaseMatchTitle")}</h3>
                  <p className="font-mono text-sm text-gray-500 max-w-sm mx-auto">{t("explore.noReleaseMatchHint")}</p>
                </div>
                <Link
                  href="/releases/new"
                  className="inline-flex items-center gap-2 px-3.5 h-9 rounded-md bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t("explore.newRelease")}</span>
                </Link>
              </div>
            ) : (
              <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-sm overflow-hidden shadow-2xs divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                {releases.map((r) => (
                  <Link
                    key={r.id}
                    href={`/releases/${r.id}`}
                    className="p-3.5 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate group-hover:text-primary transition-colors">
                        {r.edition_name}
                      </h3>
                      <p className="font-mono text-xs text-gray-500 truncate">
                        {r.work?.title ? `${r.work.title} · ` : ""}
                        {r.publisher || r.publisher_entity?.name || t("explore.unknownPublisher")}
                        {r.catalog_number ? ` · ${r.catalog_number}` : ""}
                        {r.edition_date ? ` · ${String(r.edition_date).slice(0, 10)}` : ""}
                      </p>
                      {r.packaging && (
                        <div className="flex items-center gap-2 pt-0.5">
                          <span className="px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/5 text-[11px] font-mono text-gray-600 dark:text-gray-400">
                            {packagingLabel(r.packaging)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-primary text-sm font-mono flex items-center gap-0.5 shrink-0">
                      <span>{t("explore.detail")}</span>
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    );
}

export default function ExplorePage() {
 return (
 <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center font-mono text-sm text-gray-500">Loading…</div>}>
 <ExploreContent />
 </Suspense>
 );
}
