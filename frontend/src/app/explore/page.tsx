"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import {
 fetchApi,
 Work,
 Tag,
 TaxonomyResponse,
 Artist,
 Release,
 ENTITY_TYPE_OPTIONS,
} from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
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
} from "lucide-react";

type ExploreType = "works" | "artists" | "releases";

function ExploreContent() {
 const { t } = useI18n();
 const searchParams = useSearchParams();
 const router = useRouter();

 const typeParam = (searchParams.get("type") as ExploreType) || "works";
 const activeType: ExploreType =
 typeParam === "artists" || typeParam === "releases" ? typeParam : "works";
 const queryParam = searchParams.get("q") || "";
 const tagsParam = searchParams.get("tags") || "";
 const entityTypeParam = searchParams.get("entity_type") || "";
 const shelfParam = searchParams.get("shelf") || "";
 const customShelfParam = searchParams.get("custom_shelf") || "";

 const [works, setWorks] = useState<Work[]>([]);
 const [artists, setArtists] = useState<Artist[]>([]);
 const [releases, setReleases] = useState<Release[]>([]);
 const [tagGroups, setTagGroups] = useState<Record<string, Tag[]>>({});
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
 fetchApi<TaxonomyResponse>("/catalog/taxonomy")
 .then((data) => {
 if (data.tag_groups) setTagGroups(data.tag_groups);
 })
 .catch(() => {});
 }, []);

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
 if (nt === "works" && nTags.length > 0) params.set("tags", nTags.join(","));
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
 if (nt === "works" && selectedTags.length > 0) p.set("tags", selectedTags.join(","));
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
 if (customShelfParam) params.append("custom_shelf", customShelfParam);
 if (selectedTags.length > 0) params.append("tags", selectedTags.join(","));
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

 useEffect(() => {
 if (activeType === "works") loadWorks();
 else if (activeType === "artists") loadArtists();
 else loadReleases();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeType, selectedTags, queryParam, selectedEntityType, sortBy, shelfParam, customShelfParam]);

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
 spec: t("explore.tagGroup.spec"),
 general: t("explore.tagGroup.general"),
 };

 const placeholderByType =
 activeType === "artists"
 ? t("explore.searchPlaceholderArtist")
 : activeType === "releases"
 ? t("explore.searchPlaceholderRelease")
 : t("explore.searchPlaceholder");

 return (
 <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
 <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
 <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <Navbar />

 <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full flex-1 space-y-5">
 {/* Header + Search — Terminal Card */}
 <div className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-black/5 dark:border-white/[0.06] pb-3">
 <div className="space-y-0.5">
 <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
 <span>{t("explore.title")}</span>
 </h1>
 </div>

 <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md">
 <div className="relative flex items-center">
 <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
 <input
 type="text"
 placeholder={placeholderByType}
 value={searchInput}
 onChange={(e) => setSearchInput(e.target.value)}
 className="w-full pl-11 pr-10 h-11 max-sm:min-h-[44px] rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono transition-all"
 />
 {searchInput && (
 <button
 type="button"
 onClick={() => {
 setSearchInput("");
 updateUrl({ q: "" });
 }}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-white"
 >
 <X className="w-4 h-4" />
 </button>
 )}
 </div>
 </form>
 </div>

 {/* Type Tabs */}
 <div className="flex items-center gap-2 pt-2.5 border-t border-black/[0.06] dark:border-white/[0.06] overflow-x-auto no-scrollbar">
 <button
 onClick={() => handleSwitchType("works")}
 className={`inline-flex items-center gap-2 px-3.5 h-10 max-sm:min-h-[44px] rounded-lg text-sm font-semibold whitespace-nowrap border transition-all ${
 activeType === "works"
 ? "bg-primary text-white keep-white border-primary shadow-xs"
 : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
 }`}
 >
 <Layers className="w-4 h-4" />
 <span>{t("explore.typeWorks")}</span>
 </button>
 <button
 onClick={() => handleSwitchType("artists")}
 className={`inline-flex items-center gap-2 px-3.5 h-10 max-sm:min-h-[44px] rounded-lg text-sm font-semibold whitespace-nowrap border transition-all ${
 activeType === "artists"
 ? "bg-primary text-white keep-white border-primary shadow-xs"
 : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
 }`}
 >
 <Users className="w-4 h-4" />
 <span>{t("explore.typeArtists")}</span>
 </button>
 <button
 onClick={() => handleSwitchType("releases")}
 className={`inline-flex items-center gap-2 px-3.5 h-10 max-sm:min-h-[44px] rounded-lg text-sm font-semibold whitespace-nowrap border transition-all ${
 activeType === "releases"
 ? "bg-primary text-white keep-white border-primary shadow-xs"
 : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
 }`}
 >
 <Disc className="w-4 h-4" />
 <span>{t("explore.typeReleases")}</span>
 </button>

 <div className="ml-auto flex items-center gap-2 shrink-0">
 {activeType === "works" && (
 <>
 <button
 onClick={() => setShowTagFilterPanel(!showTagFilterPanel)}
 className={`h-10 max-sm:min-h-[44px] px-3.5 rounded-lg border text-sm font-mono flex items-center gap-2 transition-colors ${
 showTagFilterPanel || selectedTags.length > 0
 ? "bg-primary/10 text-primary border-primary/30 font-semibold"
 : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300"
 }`}
 >
 <TagIcon className="w-4 h-4" />
 <span>{t("explore.tagFilter")}</span>
 {selectedTags.length > 0 && (
 <span className="w-4 h-4 rounded-full bg-primary text-white text-xs grid place-items-center font-bold">
 {selectedTags.length}
 </span>
 )}
 </button>
 <select
 value={sortBy}
 onChange={(e) => setSortBy(e.target.value as any)}
 className="h-10 max-sm:min-h-[44px] px-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm text-gray-700 dark:text-gray-300 font-mono focus:outline-none"
 >
 <option value="created_at">{t("explore.latestAdded")}</option>
 <option value="release_date">{t("explore.byYear")}</option>
 <option value="title">{t("explore.byName")}</option>
 </select>
 <div className="flex items-center gap-0.5 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-0.5">
 <button
 onClick={() => setViewMode("grid")}
 className={`w-9 h-9 max-sm:min-h-[44px] grid place-items-center rounded-md transition-colors ${
 viewMode === "grid" ? "bg-surface text-primary shadow-xs" : "text-gray-400 hover:text-gray-700 dark:hover:text-white"
 }`}
 title={t("explore.gridView")}
 >
 <LayoutGrid className="w-4 h-4" strokeWidth={1.7} />
 </button>
 <button
 onClick={() => setViewMode("list")}
 className={`w-9 h-9 max-sm:min-h-[44px] grid place-items-center rounded-md transition-colors ${
 viewMode === "list" ? "bg-surface text-primary shadow-xs" : "text-gray-400 hover:text-gray-700 dark:hover:text-white"
 }`}
 title={t("explore.listView")}
 >
 <List className="w-4 h-4" strokeWidth={1.7} />
 </button>
 </div>
 </>
 )}
 {activeType === "artists" && (
 <span className="font-mono text-sm text-gray-500 hidden sm:inline">
 {t("explore.artistHint")}
 </span>
 )}
 {activeType === "releases" && (
 <span className="font-mono text-sm text-gray-500 hidden sm:inline">
 {t("explore.releaseHint")}
 </span>
 )}
 </div>
 </div>

 {/* Works: Tag Filter Drawer */}
 {activeType === "works" && showTagFilterPanel && Object.keys(tagGroups).length > 0 && (
 <div className="p-4 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-2.5 pt-2.5">
 <div className="flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-300">
 <span className="flex items-center gap-2">
 <TagIcon className="w-4 h-4 text-primary" />
 {t("explore.filterByTag")}
 </span>
 {selectedTags.length > 0 && (
 <button
 onClick={() => {
 setSelectedTags([]);
 updateUrl({ tags: [], q: queryParam });
 }}
 className="text-primary hover:underline text-sm"
 >
 {t("explore.clearTags")}
 </button>
 )}
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2.5 text-sm">
 {Object.entries(tagGroups).map(([groupKey, tagsInGroup]) => (
 <div key={groupKey} className="space-y-1 p-2 rounded-md bg-surface border border-black/5 dark:border-white/5">
 <div className="font-mono text-xs uppercase text-gray-400 font-bold tracking-wider">
 {tagGroupLabels[groupKey] || groupKey} ({groupKey})
 </div>
 <div className="flex flex-wrap gap-2">
 {tagsInGroup.map((tg) => {
 const isChecked = selectedTags.includes(tg.name);
 return (
 <button
 key={tg.id}
 onClick={() => handleToggleTag(tg.name)}
 className={`px-2.5 py-1 rounded-sm text-xs font-mono transition-all flex items-center gap-2 border ${
 isChecked
 ? "bg-primary text-white keep-white border-primary font-bold shadow-xs"
 : "bg-black/[0.03] dark:bg-white/[0.04] border-black/5 dark:border-white/5 text-gray-700 dark:text-gray-300 hover:border-primary/40"
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

 {/* Artists: Entity Type Pills */}
 {activeType === "artists" && (
 <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
 <button
 onClick={() => {
 setSelectedEntityType("");
 updateUrl({ entity_type: "" });
 }}
 className={`px-3.5 h-9 max-sm:min-h-[44px] rounded-md whitespace-nowrap border text-sm transition-all ${
 selectedEntityType === ""
 ? "bg-primary/10 text-primary border-primary/30 font-semibold"
 : "bg-black/[0.02] dark:bg-white/[0.02] border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
 }`}
 >
 {t("common.all")}
 </button>
 {ENTITY_TYPE_OPTIONS.map((opt) => (
 <button
 key={opt.code}
 onClick={() => {
 const next = selectedEntityType === opt.code ? "" : opt.code;
 setSelectedEntityType(next);
 updateUrl({ entity_type: next });
 }}
 className={`px-3.5 h-9 max-sm:min-h-[44px] rounded-md whitespace-nowrap border text-sm transition-all ${
 selectedEntityType === opt.code
 ? "bg-primary/10 text-primary border-primary/30 font-semibold"
 : "bg-black/[0.02] dark:bg-white/[0.02] border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
 }`}
 >
 {t(opt.nameKey)}
 </button>
 ))}
 </div>
 )}
 </div>

 {/* Filter State Bar */}
 {(queryParam || selectedTags.length > 0 || selectedEntityType) && (
 <div className="flex items-center justify-between font-mono text-sm text-gray-500 px-1 flex-wrap gap-2">
 <div className="flex items-center gap-2 flex-wrap">
 <span>
 {activeType === "works"
 ? t("explore.filterResult", { count: total })
 : activeType === "artists"
 ? t("explore.filterResultArtists", { count: total })
 : t("explore.filterResultReleases", { count: total })}
 </span>
 {selectedTags.map((tagName) => (
 <span
 key={tagName}
 className="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-2 font-mono text-sm"
 >
 <span>#{tagName}</span>
 <button onClick={() => handleRemoveTag(tagName)}>
 <X className="w-4 h-4 hover:text-red-500" />
 </button>
 </span>
 ))}
 {selectedEntityType && (
 <span className="px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-500 border border-sky-500/20 flex items-center gap-2 font-mono text-sm">
 <span>{t(`entity.${selectedEntityType}`)}</span>
 <button
 onClick={() => {
 setSelectedEntityType("");
 updateUrl({ entity_type: "" });
 }}
 >
 <X className="w-4 h-4 hover:text-red-500" />
 </button>
 </span>
 )}
 {queryParam && (
 <span className="px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono text-sm">
 {t("explore.keywordLabel")} &ldquo;{queryParam}&rdquo;
 </span>
 )}
 </div>
 <button onClick={clearAllFilters} className="text-primary hover:underline shrink-0 font-mono text-sm">
 {t("explore.clearAll")}
 </button>
 </div>
 )}

 {/* Content */}
 {activeType === "works" ? (
 loading ? (
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
 {Array.from({ length: 10 }).map((_, i) => (
 <div
 key={i}
 className="aspect-[3/4] rounded-lg bg-black/[0.03] dark:bg-white/[0.03] animate-pulse border border-black/5 dark:border-white/5"
 />
 ))}
 </div>
 ) : works.length === 0 ? (
 <div className="p-8 sm:p-10 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-3">
 <div className="w-10 h-10 max-sm:min-h-[44px] rounded-sm bg-primary/10 border border-primary/20 text-primary grid place-items-center mx-auto">
 <Disc3 className="w-5 h-5 animate-spin-slow" />
 </div>
 <div className="space-y-0.5">
 <h3 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("explore.noMatchTitle")}</h3>
 <p className="font-mono text-sm text-gray-500 max-w-sm mx-auto">{t("explore.noMatchHint")}</p>
 </div>
 <Link
 href="/contribute"
 className="inline-flex items-center gap-2 px-3.5 h-9 max-sm:min-h-[44px] rounded-md bg-primary text-white keep-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-xs"
 >
 <Plus className="w-4 h-4" />
 <span>{t("explore.newWork")}</span>
 </Link>
 </div>
 ) : viewMode === "grid" ? (
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
 {works.map((w) => (
 <Link
 key={w.id}
 href={`/works/${w.id}`}
 className="group relative rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-sm overflow-hidden shadow-2xs hover:shadow-elevated hover:border-primary/50 transition-all flex flex-col"
 >
 <div className="aspect-[3/4] w-full bg-black/5 dark:bg-black/40 relative overflow-hidden">
 {w.cover_image_url ? (
 <img src={w.cover_image_url} alt={w.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
 ) : (
 <div className="w-full h-full grid place-items-center text-gray-400">
 <Disc3 className="w-8 h-8 opacity-30" />
 </div>
 )}
 <div className="absolute top-1.5 left-1.5 px-2.5 py-1 rounded-sm bg-black/70 backdrop-blur-md text-xs font-mono text-white keep-white">
 {w.media_type || t("home.workFallback")}
 </div>
 </div>
 <div className="p-4 space-y-1 flex-1 flex flex-col justify-between">
 <div>
 <h3 className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-1 group-hover:text-primary transition-colors">
 {w.title}
 </h3>
 {w.original_title && <p className="font-mono text-xs text-gray-500 line-clamp-1">{w.original_title}</p>}
 </div>
 {w.tags && w.tags.length > 0 && (
 <div className="flex flex-wrap gap-2 pt-0.5">
 {w.tags.slice(0, 3).map((tg) => (
 <span key={tg.id} className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] text-xs font-mono text-gray-600 dark:text-gray-400">
 #{tg.name}
 </span>
 ))}
 {w.tags.length > 3 && <span className="text-xs font-mono text-gray-400">+{w.tags.length - 3}</span>}
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
 ))}
 </div>
 ) : (
 <div className="rounded-lg border border-black/10 dark:border-white/10 bg-surface overflow-hidden shadow-2xs divide-y divide-black/[0.06] dark:divide-white/[0.06]">
 {works.map((w) => (
 <Link
 key={w.id}
 href={`/works/${w.id}`}
 className="p-4 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group"
 >
 <div className="flex items-center gap-3 min-w-0">
 <div className="w-9 h-12 rounded-sm bg-black/5 dark:bg-black/40 overflow-hidden shrink-0">
 {w.cover_image_url ? (
 <img src={w.cover_image_url} alt={w.title} className="w-full h-full object-cover" />
 ) : (
 <div className="w-full h-full grid place-items-center text-gray-400">
 <Disc3 className="w-4 h-4 opacity-30" />
 </div>
 )}
 </div>
 <div className="space-y-0.5 min-w-0">
 <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate group-hover:text-primary transition-colors">
 {w.title}
 </h3>
 <p className="font-mono text-xs text-gray-500 truncate">
 {w.original_title ? `${w.original_title} · ` : ""}
 {w.media_type || ""}
 {w.release_date ? ` · ${String(w.release_date).slice(0, 10)}` : ""}
 </p>
 {w.tags && w.tags.length > 0 && (
 <div className="flex flex-wrap gap-2 pt-0.5">
 {w.tags.map((tg) => (
 <span key={tg.id} className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] text-xs font-mono text-gray-500">
 #{tg.name}
 </span>
 ))}
 </div>
 )}
 </div>
 </div>
 <div className="text-primary text-sm font-mono flex items-center gap-2 shrink-0">
 <span>{t("explore.detail")}</span>
 <ArrowRight className="w-4 h-4" />
 </div>
 </Link>
 ))}
 </div>
 )
 ) : activeType === "artists" ? (
 loading ? (
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
 {Array.from({ length: 8 }).map((_, i) => (
 <div key={i} className="h-24 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] animate-pulse border border-black/5 dark:border-white/5" />
 ))}
 </div>
 ) : artists.length === 0 ? (
 <div className="p-8 sm:p-10 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center space-y-3">
 <div className="w-10 h-10 max-sm:min-h-[44px] rounded-sm bg-sky-500/10 border border-sky-500/20 text-sky-500 grid place-items-center mx-auto">
 <Users className="w-5 h-5" />
 </div>
 <div className="space-y-0.5">
 <h3 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("explore.noArtistMatchTitle")}</h3>
 <p className="font-mono text-sm text-gray-500 max-w-sm mx-auto">{t("explore.noArtistMatchHint")}</p>
 </div>
 <Link
 href="/artists/new"
 className="inline-flex items-center gap-2 px-3.5 h-9 max-sm:min-h-[44px] rounded-md bg-primary text-white keep-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-xs"
 >
 <Plus className="w-4 h-4" />
 <span>{t("explore.newArtist")}</span>
 </Link>
 </div>
 ) : (
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 {artists.map((a) => (
 <Link
 key={a.id}
 href={`/artists/${a.id}`}
 className="group p-4 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-sm hover:border-primary/40 hover:shadow-elevated transition-all space-y-1.5"
 >
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate group-hover:text-primary transition-colors">
 {a.name}
 </h3>
 {a.original_name && <p className="font-mono text-xs text-gray-500 truncate">{a.original_name}</p>}
 </div>
 <span className="shrink-0 px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/5 text-xs font-mono text-gray-600 dark:text-gray-400">
 {t(`entity.${a.entity_type}`) !== `entity.${a.entity_type}` ? t(`entity.${a.entity_type}`) : a.entity_type}
 </span>
 </div>
 {a.disambiguation && <p className="text-sm text-gray-500 line-clamp-2">{a.disambiguation}</p>}
 {a.biography && <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{a.biography}</p>}
 <div className="flex items-center gap-2 font-mono text-xs text-gray-500 pt-1.5 border-t border-black/[0.04] dark:border-white/[0.04]">
 {a.country && <span>{a.country}</span>}
 <span className="ml-auto flex items-center gap-0.5 text-primary">
 {t("explore.detail")} <ArrowRight className="w-2.5 h-2.5" />
 </span>
 </div>
 </Link>
 ))}
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
 <div className="w-10 h-10 max-sm:min-h-[44px] rounded-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 grid place-items-center mx-auto">
 <Disc className="w-5 h-5" />
 </div>
 <div className="space-y-0.5">
 <h3 className="font-display font-bold tracking-tight text-gray-900 dark:text-white text-sm">{t("explore.noReleaseMatchTitle")}</h3>
 <p className="font-mono text-sm text-gray-500 max-w-sm mx-auto">{t("explore.noReleaseMatchHint")}</p>
 </div>
 <Link
 href="/releases/new"
 className="inline-flex items-center gap-2 px-3.5 h-9 max-sm:min-h-[44px] rounded-md bg-primary text-white keep-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-xs"
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
 className="p-4 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group"
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
 <div className="flex items-center gap-2 pt-0.5">
 <span
 className={`px-2.5 py-1 rounded-sm text-xs font-mono border ${
 r.is_master_verified
 ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
 : "bg-amber-500/10 text-amber-600 border-amber-500/20"
 }`}
 >
 {r.is_master_verified ? t("work.detail.verified") : t("work.detail.pending")}
 </span>
 {r.packaging && <span className="text-xs font-mono text-gray-500">{r.packaging}</span>}
 </div>
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
 );
}

export default function ExplorePage() {
 return (
 <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center font-mono text-sm text-gray-500">Loading…</div>}>
 <ExploreContent />
 </Suspense>
 );
}
