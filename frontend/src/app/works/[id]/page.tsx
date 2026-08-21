"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { MultipartUploader } from "@/components/MultipartUploader";
import { fetchApi, Work, Release, DiscussionTopic, Category, categoryDisplayName, getRoleName, getMediaTypeName } from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Layers, MessageSquare, User, Search, ChevronLeft, ChevronRight, UploadCloud, ArrowRight, Eye, ArrowUpRight, Edit3, History, GitMerge } from "lucide-react";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";
import { RevisionHistoryModal } from "@/components/editor/RevisionHistoryModal";
import { EntityMergeModal } from "@/components/editor/EntityMergeModal";
import { TemporalBadge } from "@/components/entity/TemporalBadge";
import { EntityActionToolbar } from "@/components/entity/EntityActionToolbar";
import FavoriteButton from "@/components/FavoriteButton";
import { EntityCover } from "@/components/common/EntityCover";
export default function WorkDirectoryPage() {
 const params = useParams();
 const workId = params.id as string;
 const { user } = useAuth();
 const { t, locale } = useI18n();

 const [work, setWork] = useState<Work | null>(null);
 const [releases, setReleases] = useState<Release[]>([]);
 const [total, setTotal] = useState(0);
 const [page, setPage] = useState(1);
 const pageSize = 10;
 const [q, setQ] = useState("");
 const [qInput, setQInput] = useState("");
 const [topics, setTopics] = useState<DiscussionTopic[]>([]);
 const [loadingWork, setLoadingWork] = useState(true);
 const [loadingReleases, setLoadingReleases] = useState(true);
 const [isUploaderOpen, setIsUploaderOpen] = useState(false);

 // Edit, Revision History, and Merge Modals
 const [isEditorOpen, setIsEditorOpen] = useState(false);
 const [isHistoryOpen, setIsHistoryOpen] = useState(false);
 const [isMergeOpen, setIsMergeOpen] = useState(false);

 const loadWork = async () => {
 setLoadingWork(true);
 try {
 const data = await fetchApi<Work>(`/catalog/works/${workId}`);
 setWork(data);
 } catch (e) {
 console.error(e);
 } finally {
 setLoadingWork(false);
 }
 };

 const loadReleases = async (p: number, keyword: string) => {
 setLoadingReleases(true);
 const qs = new URLSearchParams();
 qs.set("work_id", workId);
 qs.set("page", String(p));
 qs.set("page_size", String(pageSize));
 if (keyword.trim()) qs.set("q", keyword.trim());
 try {
 const res = await fetchApi<{ items: Release[]; total: number }>(`/catalog/releases?${qs.toString()}`);
 setReleases(res.items || []);
 setTotal(res.total || 0);
 } catch (e) {
 console.error(e);
 } finally {
 setLoadingReleases(false);
 }
 };

 useEffect(() => {
 if (!workId) return;
 loadWork();
 fetchApi<DiscussionTopic[]>(`/catalog/works/${workId}/comments`)
 .then((t) => setTopics(t || []))
 .catch(() => {});
 }, [workId]);

 useEffect(() => {
 if (!workId) return;
 loadReleases(page, q);
 }, [workId, page, q]);

 const onSearch = (e: React.FormEvent) => {
 e.preventDefault();
 setPage(1);
 setQ(qInput);
 };

 const totalPages = Math.max(1, Math.ceil(total / pageSize));

 if (loadingWork) {
 return <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden"><div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden /><div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden /><div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden /><div className="relative z-10 min-h-screen grid place-items-center font-mono text-sm text-gray-500">{t("work.detail.loading")}</div></div>;
 }

 if (!work) {
 return (
 <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
 <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
 <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <Navbar />
 <div className="relative z-10 max-w-7xl mx-auto px-4 py-20 text-center font-mono text-sm text-gray-500">{t("common.notFoundWork")}</div>
 </div>
 );
 }

 const meta = work.catalog_metadata || {};

 return (
 <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
 <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
 <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <Navbar onOpenUpload={() => setIsUploaderOpen(true)} />
 <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full space-y-5 flex-1">
 <div className="flex items-center gap-2 font-mono text-sm text-gray-500">
 <Link href="/explore" className="hover:text-primary transition-colors">{t("work.detail.explore")}</Link>
 <span className="text-gray-400 dark:text-white/20">/</span>
 {work.category ? (
 <>
 <span className="text-gray-600 dark:text-gray-400">{categoryDisplayName(work.category as Category, locale)}</span>
 <span className="text-gray-400 dark:text-white/20">/</span>
 </>
 ) : work.media_type ? (
 <>
 <span className="text-gray-600 dark:text-gray-400">{getMediaTypeName(work.media_type, t)}</span>
 <span className="text-gray-400 dark:text-white/20">/</span>
 </>
 ) : null}
 <span className="text-gray-900 dark:text-white truncate max-w-[40ch]">{work.title}</span>
 </div>

 <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden space-y-3">
 <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
 <div className="w-32 sm:w-40 shrink-0">
 <div className="aspect-[3/4] rounded-md overflow-hidden border border-black/10 dark:border-white/10 bg-background shadow-xs">
 <EntityCover
 src={work.cover_image_url}
 alt={work.title}
 title={work.title}
 originalTitle={work.original_title}
 mediaType={work.media_type}
 id={work.id}
 imgClassName="w-full h-full object-cover"
 />
 </div>
 <div className="mt-2 flex items-center gap-2 font-mono text-xs text-gray-500">
 <Eye className="w-4 h-4 text-gray-400" strokeWidth={1.5} /> {t("work.detail.viewCount", { count: work.view_count })}
 {meta.clc_code && <span>· {t("work.detail.clc", { code: meta.clc_code })}</span>}
 </div>
 </div>
 <div className="flex-1 space-y-3 min-w-0">
 <div className="flex flex-wrap items-center gap-2 font-mono text-xs tracking-wide">
 <span className="px-2.5 py-1 rounded-sm bg-primary text-white font-semibold">{t("work.detail.workBadge")}</span>
 {work.category ? (
 <span className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
 {categoryDisplayName(work.category as Category, locale)}
 </span>
 ) : work.media_type ? (
 <span className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
 {getMediaTypeName(work.media_type, t)}
 </span>
 ) : null}
 <TemporalBadge
 beginDate={work.begin_date}
 endDate={work.end_date}
 ended={work.ended}
 activeLabel={t("entity.temporal.activeWork")}
 endedLabel={t("entity.temporal.endedWork")}
 />
 {meta.isbn_13 && <span className="text-gray-500">ISBN {meta.isbn_13}</span>}
 </div>
 <div>
 <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{work.title}</h1>
 {work.original_title && <p className="font-mono text-sm text-gray-500 dark:text-gray-400 mt-0.5">{work.original_title}</p>}
 {work.original_language && <p className="font-mono text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("work.detail.originalLanguage", { value: t(`origLang.${work.original_language}`) })}</p>}
 {work.aliases && work.aliases.length > 0 && <p className="font-mono text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("work.detail.alias", { value: work.aliases.join(" / ") })}</p>}
 </div>
 {work.artist_relations && work.artist_relations.length > 0 && (
 <div className="flex flex-wrap gap-2">
 {work.artist_relations.map((rel) => (
 <Link
 key={rel.id}
 href={`/artists/${rel.artist_id}`}
 className="inline-flex items-center gap-2 px-2.5 py-1 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 hover:border-primary/40 text-sm text-gray-700 dark:text-gray-200 transition-colors"
 >
 <User className="w-4 h-4 text-primary" strokeWidth={1.5} />
 <span className="font-mono text-xs text-gray-500">{getRoleName(rel.role, t)}:</span>
 <span className="underline decoration-dotted underline-offset-2">{rel.artist?.name}</span>
 </Link>
 ))}
 </div>
 )}
 {work.summary && <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400 max-w-3xl line-clamp-3">{work.summary}</p>}
 {work.tags && work.tags.length > 0 && (
 <div className="flex flex-wrap gap-2 pt-0.5">
 {work.tags.map((tag) => (
 <span key={tag.id} className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.04] border border-black/5 dark:border-white/10 font-mono text-xs text-gray-600 dark:text-gray-400">
 #{tag.name}
 </span>
 ))}
 </div>
 )}

 {/* Action Toolbar */}
 <div className="pt-2.5 border-t border-black/5 dark:border-white/[0.06]">
 <EntityActionToolbar
 onEdit={() => setIsEditorOpen(true)}
 onHistory={() => setIsHistoryOpen(true)}
 onMerge={() => setIsMergeOpen(true)}
 entityTypeLabel={t("entity.toolbar.work")}
 >
 <FavoriteButton targetType="work" targetId={work.id} />
 </EntityActionToolbar>
 </div>
 </div>
 </div>
 </section>

 <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden">
 <div className="px-3.5 sm:px-4 py-3 border-b border-black/5 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
 <div className="flex items-center gap-2">
 <span className="w-9 h-9 max-sm:min-h-[44px] grid place-items-center rounded-md bg-sky-500/10 border border-sky-500/20">
 <Layers className="w-4 h-4 text-sky-500" strokeWidth={1.5} />
 </span>
 <h2 className="font-display text-base font-bold tracking-tight text-gray-900 dark:text-white">{t("work.detail.releaseCatalog")}</h2>
 <span className="font-mono text-sm text-gray-500">{t("work.detail.totalReleases", { count: total })}</span>
 </div>
 <div className="flex items-center gap-2">
 <form onSubmit={onSearch} className="relative w-full sm:w-auto">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
 <input
 value={qInput}
 onChange={(e) => setQInput(e.target.value)}
 placeholder={t("work.detail.searchPlaceholder")}
 className="pl-11 pr-3.5 h-9 max-sm:min-h-[44px] w-full sm:w-48 bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-md text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary/50 font-mono"
 />
 </form>
 {user && (
 <button onClick={() => setIsUploaderOpen(true)} className="inline-flex items-center gap-2 h-9 max-sm:min-h-[44px] px-3 rounded-md bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity">
 <UploadCloud className="w-4 h-4" strokeWidth={1.6} />
 <span>{t("work.detail.addRelease")}</span>
 </button>
 )}
 </div>
 </div>

 {loadingReleases ? (
 <div className="p-8 text-center font-mono text-sm text-gray-500">{t("work.detail.loadingReleases")}</div>
 ) : releases.length === 0 ? (
 <div className="p-8 rounded-lg border border-dashed border-black/10 dark:border-white/10 bg-surface/50 backdrop-blur-sm text-center font-mono text-sm text-gray-500">{t("work.detail.noReleases")}{q ? t("work.detail.noReleasesHint") : user ? t("work.detail.beFirstUploader") : ""}</div>
 ) : (
 <>
 <div className="hidden sm:block overflow-x-auto">
 <table className="w-full text-left text-sm">
 <thead className="bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/5 dark:border-white/[0.06] font-mono text-xs uppercase tracking-wider text-gray-500">
 <tr>
 <th className="py-2.5 px-3.5 font-medium">{t("work.detail.tableRelease")}</th>
 <th className="py-2.5 px-3.5 font-medium">{t("work.detail.tablePublisher")}</th>
 <th className="py-2.5 px-3.5 font-medium">{t("work.detail.tableCatalogNo")}</th>
 <th className="py-2.5 px-3.5 text-right font-medium">{t("work.detail.tableDate")}</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
 {releases.map((rel) => (
 <tr key={rel.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
 <td className="py-2.5 px-3.5">
 <Link href={`/releases/${rel.id}`} className="font-semibold text-gray-900 dark:text-white hover:text-primary inline-flex items-center gap-2">
 {rel.edition_name} <ArrowUpRight className="w-4 h-4 text-gray-400" strokeWidth={1.6} />
 </Link>
 </td>
 <td className="py-2.5 px-3.5 text-gray-600 dark:text-gray-400">
 {rel.publisher_entity ? (
 <Link href={`/artists/${rel.publisher_entity.id}`} className="text-primary hover:underline font-medium">
 {rel.publisher_entity.name}
 </Link>
 ) : (
 rel.publisher || "—"
 )}
 </td>
 <td className="py-2.5 px-3.5 font-mono text-gray-500">{rel.catalog_number || "—"}</td>
 <td className="py-2.5 px-3.5 font-mono text-gray-500 text-right">{rel.edition_date ? new Date(rel.edition_date).toLocaleDateString() : "—"}</td>
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
 <div className="font-semibold text-gray-900 dark:text-white text-sm leading-tight line-clamp-2 inline-flex items-center gap-2">{rel.edition_name} <ArrowUpRight className="w-4 h-4 text-gray-400 shrink-0" strokeWidth={1.6} /></div>
 <div className="font-mono text-xs text-gray-500 truncate">{rel.publisher_entity ? rel.publisher_entity.name : rel.publisher || "—"} {rel.catalog_number ? "· " + rel.catalog_number : ""}</div>
 <div className="font-mono text-xs text-gray-400">{rel.edition_date ? new Date(rel.edition_date).toLocaleDateString() : "—"}</div>
 </div>
 <span className={`shrink-0 px-2.5 py-1 rounded-sm text-xs font-mono border ${rel.is_master_verified ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-300" : "bg-black/[0.04] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-500"}`}>{rel.is_master_verified ? t("work.detail.verified") : t("work.detail.pending")}</span>
 </div>
 </a>
 ))}
 </div>
 <div className="px-3.5 py-2.5 border-t border-black/5 dark:border-white/[0.06] bg-black/[0.01] dark:bg-white/[0.01] flex items-center justify-between">
 <span className="font-mono text-sm text-gray-500">
 {t("common.pagination", { page, total: totalPages })}
 </span>
 <div className="flex items-center gap-2">
 <button
 disabled={page <= 1}
 onClick={() => setPage((p) => Math.max(1, p - 1))}
 className="w-9 h-9 max-sm:min-h-[44px] grid place-items-center rounded-md bg-black/[0.03] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-black/[0.06] dark:hover:bg-white/[0.10]"
 >
 <ChevronLeft className="w-4 h-4" strokeWidth={1.6} />
 </button>
 <button
 disabled={page >= totalPages}
 onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
 className="w-9 h-9 max-sm:min-h-[44px] grid place-items-center rounded-md bg-black/[0.03] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-black/[0.06] dark:hover:bg-white/[0.10]"
 >
 <ChevronRight className="w-4 h-4" strokeWidth={1.6} />
 </button>
 <Link href={`/works/${workId}/releases`} className="ml-1 inline-flex items-center gap-2 h-9 max-sm:min-h-[44px] px-3.5 rounded-md bg-black/[0.03] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-sm font-mono text-gray-700 dark:text-gray-300 hover:text-primary transition-colors">
 {t("work.detail.viewAll")} <ArrowRight className="w-4 h-4" strokeWidth={1.6} />
 </Link>
 </div>
 </div>
 </>
 )}
 </section>

 <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft">
 <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-2">
 <h3 className="font-display text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
 <MessageSquare className="w-4 h-4 text-emerald-500" strokeWidth={1.5} />
 <span>{t("work.detail.relatedTopics")}</span>
 <span className="font-mono text-sm font-normal text-gray-500">({topics.length})</span>
 </h3>
 <Link href="/community?board_code=comment" className="font-mono text-sm text-primary hover:underline inline-flex items-center gap-0.5">
 <span>{t("work.detail.enterForum")}</span>
 <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
 </Link>
 </div>
 {topics.length === 0 ? (
 <p className="font-mono text-sm text-gray-500 mt-2">{t("work.detail.noRelatedTopics")}</p>
 ) : (
 <div className="divide-y divide-black/5 dark:divide-white/[0.06] mt-2">
 {topics.slice(0, 3).map((t) => (
 <Link key={t.id} href={`/community/${t.id}`} className="py-2.5 flex items-center justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] px-2.5 rounded-md transition-colors">
 <span className="text-sm text-gray-800 dark:text-gray-200 truncate pr-4">{t.title}</span>
 <span className="font-mono text-xs text-gray-500 shrink-0">{new Date(t.created_at).toLocaleDateString()}</span>
 </Link>
 ))}
 </div>
 )}
 </section>
 </main>
 <MultipartUploader isOpen={isUploaderOpen} onClose={() => setIsUploaderOpen(false)} workId={work.id} onUploadSuccess={() => { loadReleases(1, q); setPage(1); }} />

 {/* Universal Entity Editor (Edit Mode) */}
 <UniversalEntityEditor
 isOpen={isEditorOpen}
 onClose={() => setIsEditorOpen(false)}
 targetType="work"
 mode="edit"
 initialData={work}
 onSuccess={() => loadWork()}
 />

 {/* Revision History & Diff Modal */}
 <RevisionHistoryModal
 isOpen={isHistoryOpen}
 onClose={() => setIsHistoryOpen(false)}
 targetType="work"
 targetId={work.id}
 entityTitle={work.title}
 />

 {/* Entity Merge Modal */}
 <EntityMergeModal
 isOpen={isMergeOpen}
 onClose={() => setIsMergeOpen(false)}
 targetType="work"
 sourceEntity={{ id: work.id, title: work.title }}
 />
 </div>
 );
}
