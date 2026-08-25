"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { UserAvatar } from "@/components/UserAvatar";
import { fetchApi, displayNameOf, toggleFavorite, FavoriteTargetType } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import DirectMessageModal from "@/components/community/DirectMessageModal";
import { UserRoleBadge } from "@/lib/roles";
import { DiffViewer } from "@/components/editor/DiffViewer";
import {
  FileText,
  Disc,
  Users,
  MessageSquare,
  History,
  Mail,
  MessageCircle,
  Calendar,
  Heart,
  Lock,
  Trash2,
  Settings,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitCommit,
} from "lucide-react";
import { fetchFavorites, FavoriteItem } from "@/lib/api";

type Profile = {
  user: {
    id: string;
    username: string;
    display_name?: string | null;
    email?: string;
    favorites_public?: boolean;
    role: string;
    avatar_url?: string;
    bio?: string;
    created_at: string;
    invite_code?: string;
  };
  stats: {
    works_created: number;
    releases_created: number;
    artists_created: number;
    topics_created: number;
    comments_created: number;
    audit_actions: number;
    revisions_count?: number;
    invited_count: number;
    favorites_count: number;
  };
};

export default function UserDetailPage() {
  const params = useParams() as { id: string };
  const id = params.id;
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") || "all";

  const { user: currentUser } = useAuth();
  const { t, locale } = useI18n();

  const tabs = [
    { id: "all", label: t("users.profile.tabs.all") },
    { id: "revisions", label: t("users.profile.tabs.revisions") },
    { id: "works", label: t("users.profile.tabs.works") },
    { id: "releases", label: t("users.profile.tabs.releases") },
    { id: "artists", label: t("users.profile.tabs.artists") },
    { id: "topics", label: t("users.profile.tabs.topics") },
    { id: "comments", label: t("users.profile.tabs.comments") },
    { id: "favorites", label: t("users.profile.tabs.favorites") },
    { id: "audits", label: t("users.profile.tabs.audits") },
  ] as const;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<string>(initialTab);
  const [favFilter, setFavFilter] = useState<FavoriteTargetType | "">("");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [favVisible, setFavVisible] = useState(true);
  const [copiedId, setCopiedId] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchApi<Profile>(`/users/${id}`).then(setProfile).catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => {
    if (tab !== "favorites") return;
    setLoading(true);
    fetchFavorites(id, { targetType: favFilter || undefined, page, pageSize: 20 })
      .then((r) => {
        setFavVisible(r.visible);
        setItems(r.items || []);
        setTotal(r.total || 0);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id, tab, favFilter, page]);

  useEffect(() => {
    if (tab === "favorites") return;
    setLoading(true);
    fetchApi<{ items: any[]; total: number }>(`/users/${id}/contributions?tab=${tab}&page=${page}&page_size=20`)
      .then((r) => {
        setItems(r.items || []);
        setTotal(r.total || 0);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id, tab, page]);

  const handleCopyId = () => {
    if (!profile) return;
    navigator.clipboard.writeText(profile.user.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const toggleDiff = (itemId: string) => {
    setExpandedDiffs((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  const handleRemoveFavorite = async (e: React.MouseEvent, it: FavoriteItem) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await toggleFavorite(it.target_type, it.target_id);
      setItems((prev) => prev.filter((item) => item.id !== it.id));
      setTotal((prev) => Math.max(0, prev - 1));
      if (profile) {
        setProfile({
          ...profile,
          stats: {
            ...profile.stats,
            favorites_count: Math.max(0, profile.stats.favorites_count - 1),
          },
        });
      }
    } catch (error) {
      console.error("Failed to remove favorite:", error);
    }
  };

  if (err)
    return (
      <div className="min-h-screen bg-background text-gray-900 dark:text-white p-6">
        <Navbar />
        <div className="max-w-5xl mx-auto pt-8 text-rose-500 text-sm">{err}</div>
      </div>
    );

  if (!profile)
    return (
      <div className="min-h-screen bg-background text-gray-900 dark:text-white">
        <Navbar />
        <div className="max-w-5xl mx-auto p-6 text-gray-500 text-sm font-mono">{t("common.loading")}</div>
      </div>
    );

  const u = profile.user;
  const s = profile.stats;
  const isMe = currentUser?.id === u.id;

  const getRevisionActionLabel = (editType?: string) => {
    switch (editType) {
      case "create":
        return { label: t("editor.history.actionCreate"), color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" };
      case "delete":
        return { label: t("editor.history.actionDelete"), color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" };
      case "merge":
        return { label: t("editor.history.actionMerge"), color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" };
      case "rollback":
        return { label: t("editor.history.actionRollback"), color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" };
      case "cover_update":
        return { label: t("editor.history.actionCover"), color: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20" };
      case "relation_update":
        return { label: t("editor.history.actionRelations"), color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" };
      case "external_links":
        return { label: t("editor.history.actionExternalIds"), color: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" };
      case "release_mount":
        return { label: t("editor.history.actionReleaseMount"), color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20" };
      case "update":
      default:
        return { label: t("editor.history.actionUpdate"), color: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" };
    }
  };

  return (
    <div className="min-h-screen bg-background text-gray-900 dark:text-white flex flex-col">
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-5 flex-1 space-y-4 sm:space-y-5">
        {/* User Card Header */}
        <div className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 flex flex-col sm:flex-row gap-3.5 sm:items-center justify-between shadow-soft">
          <div className="flex gap-3.5 items-start min-w-0">
            <UserAvatar user={u} size="xl" shape="rounded" ring className="shadow-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-gray-900 dark:text-white">{displayNameOf(u as any)}</h1>
                {displayNameOf(u as any) !== u.username && <span className="text-xs text-gray-500 font-mono">@{u.username}</span>}
                <UserRoleBadge role={u.role} t={t} showIcon />
                <span className="text-[11px] text-gray-500 font-mono flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.03] dark:bg-white/5 border border-black/10 dark:border-white/10">
                  <Calendar className="w-3 h-3 text-emerald-500" />
                  <span>
                    {t("users.profile.registeredAt")}:{" "}
                    {new Date(u.created_at).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    })}
                  </span>
                </span>
              </div>
              {u.bio && <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap line-clamp-2">{u.bio}</p>}
              {u.email && (
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  <span>{u.email}</span>
                </div>
              )}
              <div className="text-[11px] font-mono text-gray-400 flex items-center gap-2 flex-wrap">
                <span>
                  ID: <span className="text-gray-600 dark:text-gray-300 font-medium">{u.id}</span>
                </span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  title={t("users.profile.copyId")}
                  className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex items-center gap-1"
                >
                  {copiedId ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span className="text-[10px]">{copiedId ? t("users.profile.copied") : t("users.profile.copyId")}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {!isMe ? (
              <button
                type="button"
                onClick={() => {
                  if (!currentUser) {
                    window.location.href = `/login?redirect=/users/${u.id}`;
                    return;
                  }
                  setIsChatOpen(true);
                }}
                className="px-3.5 h-8 rounded-lg bg-primary hover:opacity-90 text-white keep-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-opacity"
              >
                <MessageCircle className="w-3.5 h-3.5 stroke-[2]" />
                <span>{t("users.profile.sendMessage")}</span>
              </button>
            ) : (
              <Link
                href="/settings"
                className="px-3.5 h-8 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 hover:border-primary/50 text-gray-700 dark:text-gray-200 hover:text-primary text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>{t("users.profile.editSettings")}</span>
              </Link>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {[
            { id: "revisions", label: t("users.profile.stats.revisions"), v: s.revisions_count ?? s.audit_actions, icon: GitCommit },
            { id: "works", label: t("users.profile.stats.works"), v: s.works_created, icon: FileText },
            { id: "releases", label: t("users.profile.stats.releases"), v: s.releases_created, icon: Disc },
            { id: "artists", label: t("users.profile.stats.artists"), v: s.artists_created, icon: Users },
            { id: "favorites", label: t("users.profile.stats.favorites"), v: s.favorites_count, icon: Heart },
            { id: "topics", label: t("users.profile.stats.topics"), v: s.topics_created, icon: MessageSquare },
            { id: "comments", label: t("users.profile.stats.comments"), v: s.comments_created, icon: MessageSquare },
            { id: "invited", label: t("users.profile.stats.invited"), v: s.invited_count, icon: Users },
          ].map((it) => (
            <div key={it.id} className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-2.5 text-center shadow-2xs">
              <div className="text-[10px] text-gray-500 font-mono flex items-center justify-center gap-1">
                <it.icon className="w-3 h-3" />
                <span>{it.label}</span>
              </div>
              <div className="text-base font-bold text-gray-900 dark:text-white mt-0.5">{it.v}</div>
            </div>
          ))}
        </div>

        {/* Tabs Bar */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.id}
              onClick={() => {
                setTab(tabItem.id);
                setPage(1);
              }}
              className={`px-3 h-7 rounded-md text-xs font-medium border shrink-0 transition-colors ${
                tab === tabItem.id
                  ? "bg-primary text-white keep-white border-primary shadow-xs"
                  : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        {tab === "favorites" && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {[
              { id: "", label: t("users.profile.favFilterAll") },
              { id: "work", label: t("users.profile.favFilterWork") },
              { id: "release", label: t("users.profile.favFilterRelease") },
              { id: "artist", label: t("users.profile.favFilterArtist") },
              { id: "franchise", label: t("users.profile.favFilterFranchise") },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setFavFilter(f.id as FavoriteTargetType | "");
                  setPage(1);
                }}
                className={`px-2.5 h-6.5 rounded-full text-[11px] font-medium border transition-colors ${
                  favFilter === f.id
                    ? "bg-rose-500/10 text-rose-500 border-rose-500/30 font-semibold"
                    : "bg-black/[0.02] dark:bg-white/[0.03] border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Content Box */}
        <div className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft">
          {loading ? (
            <div className="p-8 text-center text-gray-500 text-xs font-mono">{t("common.loading")}</div>
          ) : tab === "favorites" && !favVisible ? (
            <div className="p-10 text-center space-y-2">
              <Lock className="w-6 h-6 text-gray-400 mx-auto" strokeWidth={1.5} />
              <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">{t("users.profile.favoritesPrivate")}</div>
              <div className="text-xs text-gray-500 font-mono">{t("users.profile.favoritesPrivateHint")}</div>
            </div>
          ) : tab === "favorites" && items.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-xs font-mono">{t("users.profile.noFavorites")}</div>
          ) : tab === "favorites" ? (
            <ul className="divide-y divide-black/5 dark:divide-white/[0.06]">
              {items.map((it: FavoriteItem) => {
                const href =
                  it.target_type === "work"
                    ? `/works/${it.target_id}`
                    : it.target_type === "release"
                    ? `/releases/${it.target_id}`
                    : it.target_type === "franchise"
                    ? `/franchises/${it.target_id}`
                    : `/artists/${it.target_id}`;
                const title = it.work?.title || it.release?.edition_name || it.artist?.name || it.franchise?.title || it.target_id;
                const typeLabel =
                  it.target_type === "work"
                    ? t("users.profile.tabs.works")
                    : it.target_type === "release"
                    ? t("users.profile.tabs.releases")
                    : it.target_type === "franchise"
                    ? t("explore.typeFranchises")
                    : t("users.profile.tabs.artists");
                return (
                  <li
                    key={it.id}
                    className="p-3 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group"
                  >
                    <Link href={href} className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Heart className="w-3.5 h-3.5 shrink-0 text-rose-500" fill="currentColor" strokeWidth={0} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-gray-900 dark:text-white font-medium truncate group-hover:text-primary transition-colors">
                          {title}
                        </div>
                        <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                          {typeLabel}
                          {it.created_at ? ` · ${new Date(it.created_at).toLocaleDateString()}` : ""}
                        </div>
                      </div>
                    </Link>
                    {isMe && (
                      <button
                        type="button"
                        onClick={(e) => handleRemoveFavorite(e, it)}
                        title={t("users.profile.unfavorite")}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-rose-500/10 text-gray-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-xs font-mono">{t("users.profile.noData")}</div>
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/[0.06]">
              {items.map((it: any, idx: number) => {
                const isRevision = it.edit_type !== undefined || it.diff !== undefined;
                const itemId = it.id || String(idx);
                const isDiffExpanded = !!expandedDiffs[itemId];

                // 实体链接解析
                let entityHref = "#";
                let entityDisplayName = it.target_title || it.title || it.edition_name || it.name || it.summary || "";
                if (it.target_type === "work" || it.work_id || it.work?.id) {
                  entityHref = `/works/${it.target_id || it.work_id || it.work?.id || it.id}`;
                } else if (it.target_type === "release" || it.edition_name) {
                  entityHref = `/releases/${it.target_id || it.id}`;
                } else if (it.target_type === "artist" || it.name) {
                  entityHref = `/artists/${it.target_id || it.id}`;
                } else if (it.target_type === "franchise") {
                  entityHref = `/franchises/${it.target_id || it.id}`;
                } else if (it.id && it.title) {
                  entityHref = `/works/${it.id}`;
                }

                if (!entityDisplayName && isRevision) {
                  entityDisplayName = `${it.target_type?.toUpperCase() || "ENTITY"}: ${String(it.target_id || "").slice(0, 8)}…`;
                }

                const actionBadge = isRevision ? getRevisionActionLabel(it.edit_type) : null;

                return (
                  <li key={itemId} className="p-3.5 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        {isRevision ? (
                          <GitCommit className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        ) : (
                          <History className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            {actionBadge && (
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono border font-medium ${actionBadge.color}`}>
                                {actionBadge.label}
                              </span>
                            )}
                            <Link href={entityHref} className="font-semibold text-gray-900 dark:text-white hover:text-primary transition-colors truncate">
                              {entityDisplayName || it.action || it.content?.slice(0, 60)}
                            </Link>
                            {it.target_type && (
                              <span className="text-[10px] font-mono text-gray-400 uppercase bg-black/[0.03] dark:bg-white/5 px-1 rounded">
                                {it.target_type}
                              </span>
                            )}
                          </div>

                          {it.edit_note && (
                            <p className="text-xs text-gray-600 dark:text-gray-300 font-sans">
                              {it.edit_note}
                            </p>
                          )}

                          {it.source_urls && it.source_urls.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono text-gray-400 pt-0.5">
                              <span>{t("users.profile.sources")}:</span>
                              {it.source_urls.map((url: string, uidx: number) => (
                                <a
                                  key={uidx}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-600 dark:text-sky-400 hover:underline max-w-[200px] truncate inline-flex items-center gap-0.5"
                                >
                                  <span>{url}</span>
                                  <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                </a>
                              ))}
                            </div>
                          )}

                          <div className="text-[10px] text-gray-500 font-mono flex items-center gap-2">
                            <span>{it.created_at ? new Date(it.created_at).toLocaleString() : ""}</span>
                            {it.is_master_verified !== undefined && (
                              <span>· {it.is_master_verified ? t("users.profile.verified") : t("users.profile.pending")}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Diff Toggle Button */}
                      {isRevision && it.diff && Object.keys(it.diff).length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleDiff(itemId)}
                          className="shrink-0 px-2.5 py-1 rounded-md bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/10 border border-black/10 dark:border-white/10 text-[11px] font-mono text-gray-700 dark:text-gray-300 flex items-center gap-1 transition-colors"
                        >
                          <span>{isDiffExpanded ? t("users.profile.hideDiff") : t("users.profile.viewDiff")}</span>
                          {isDiffExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      )}
                    </div>

                    {/* Collapsible Field-by-Field Diff */}
                    {isRevision && isDiffExpanded && (
                      <div className="pt-2 border-t border-black/5 dark:border-white/[0.06] pl-6">
                        <DiffViewer diff={it.diff} editType={it.edit_type} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="font-mono text-[11px]">{t("users.profile.pagination", { total, page })}</span>
          <div className="flex gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 h-6.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 disabled:opacity-40 hover:text-primary transition-colors text-xs"
            >
              {t("users.profile.prevPage")}
            </button>
            <button
              disabled={items.length < 20}
              onClick={() => setPage((p) => p + 1)}
              className="px-2.5 h-6.5 rounded-md bg-primary text-white keep-white font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity text-xs"
            >
              {t("users.profile.nextPage")}
            </button>
          </div>
        </div>
      </main>

      {isChatOpen && (
        <DirectMessageModal
          peerUser={u}
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
        />
      )}
    </div>
  );
}
