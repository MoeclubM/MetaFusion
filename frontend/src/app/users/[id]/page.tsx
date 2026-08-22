"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { UserAvatar } from "@/components/UserAvatar";
import { fetchApi, displayNameOf } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import DirectMessageModal from "@/components/community/DirectMessageModal";
import { Clock, Shield, FileText, Disc, Users, MessageSquare, History, Mail, MessageCircle, Calendar, Heart, Lock } from "lucide-react";
import { fetchFavorites, FavoriteItem } from "@/lib/api";

type Profile = {
  user: { id: string; username: string; display_name?: string | null; email?: string; favorites_public?: boolean; role: string; avatar_url?: string; bio?: string; created_at: string; invite_code?: string };
  stats: { works_created: number; releases_created: number; artists_created: number; topics_created: number; comments_created: number; audit_actions: number; invited_count: number; favorites_count: number };
};

export default function UserDetailPage() {
  const params = useParams() as { id: string };
  const id = params.id;
  const { user: currentUser } = useAuth();
  const { t, locale } = useI18n();
  const tabs = [
    { id: "all", label: t("users.profile.tabs.all") },
    { id: "works", label: t("users.profile.tabs.works") },
    { id: "releases", label: t("users.profile.tabs.releases") },
    { id: "artists", label: t("users.profile.tabs.artists") },
    { id: "topics", label: t("users.profile.tabs.topics") },
    { id: "comments", label: t("users.profile.tabs.comments") },
    { id: "favorites", label: t("users.profile.tabs.favorites") },
    { id: "audits", label: t("users.profile.tabs.audits") },
  ] as const;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<string>("all");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [favVisible, setFavVisible] = useState(true);

  useEffect(() => {
    fetchApi<Profile>(`/users/${id}`).then(setProfile).catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => {
    if (tab !== "favorites") return;
    setLoading(true);
    fetchFavorites(id, { page, pageSize: 20 })
      .then((r) => {
        setFavVisible(r.visible);
        setItems(r.items || []);
        setTotal(r.total || 0);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
    return;
  }, [id, tab, page]);

  useEffect(() => {
    if (tab === "favorites") return;
    setLoading(true);
    fetchApi<{ items: any[]; total: number }>(`/users/${id}/contributions?tab=${tab}&page=${page}&page_size=20`)
      .then((r) => { setItems(r.items || []); setTotal(r.total || 0); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id, tab, page]);

  if (err) return <div className="min-h-screen bg-background text-white p-6"><Navbar /><div className="max-w-5xl mx-auto pt-8 text-rose-400 text-sm">{err}</div></div>;
  if (!profile) return <div className="min-h-screen bg-background text-white"><Navbar /><div className="max-w-5xl mx-auto p-6 text-gray-500 text-sm">{t("common.loading")}</div></div>;

  const u = profile.user;
  const s = profile.stats;

  return (
    <div className="min-h-screen bg-background text-gray-900 dark:text-white flex flex-col">
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-5 flex-1 space-y-4 sm:space-y-5">
        <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 flex flex-col sm:flex-row gap-3.5 sm:items-center justify-between shadow-soft">
          <div className="flex gap-3.5 items-start min-w-0">
            <UserAvatar user={u} size="xl" shape="rounded" ring className="shadow-md" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="text-lg font-bold text-gray-900 dark:text-white">{displayNameOf(u as any)}</h1>
                {displayNameOf(u as any) !== u.username && <span className="text-xs text-gray-500 font-mono">@{u.username}</span>}
                <span className="px-1.5 py-0.2 rounded-sm bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-[10px] font-mono capitalize text-gray-700 dark:text-gray-300">{u.role}</span>
                <span className="text-[11px] text-gray-500 font-mono flex items-center gap-1 px-2 py-0.2 rounded-sm bg-black/[0.03] dark:bg-white/5 border border-black/10 dark:border-white/10">
                  <Calendar className="w-3 h-3 text-emerald-500" />
                  <span>{t("users.profile.registeredAt")}: {new Date(u.created_at).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
                </span>
              </div>
              {u.bio && <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap line-clamp-2">{u.bio}</p>}
              {u.email && <div className="text-xs text-gray-500 flex items-center gap-1"><Mail className="w-3 h-3" /><span>{u.email}</span></div>}
              <div className="text-[11px] font-mono text-gray-400 break-all">ID: {u.id}</div>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {currentUser?.id !== u.id ? (
              <button
                type="button"
                onClick={() => {
                  if (!currentUser) {
                    window.location.href = `/login?redirect=/users/${u.id}`;
                    return;
                  }
                  setIsChatOpen(true);
                }}
                className="px-3.5 h-7 rounded-md bg-primary hover:opacity-90 text-white keep-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-opacity"
              >
                <MessageCircle className="w-3.5 h-3.5 stroke-[2]" />
                <span>{t("users.profile.sendMessage")}</span>
              </button>
            ) : (
              <span className="text-[10px] text-gray-500 font-mono px-2.5 py-1 rounded-md bg-black/[0.03] dark:bg-white/5 border border-black/10 dark:border-white/10">
                {t("users.profile.cannotChatSelf")}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {[
            { id: "works", label: t("users.profile.stats.works"), v: s.works_created, icon: FileText },
            { id: "releases", label: t("users.profile.stats.releases"), v: s.releases_created, icon: Disc },
            { id: "artists", label: t("users.profile.stats.artists"), v: s.artists_created, icon: Users },
            { id: "favorites", label: t("users.profile.stats.favorites"), v: s.favorites_count, icon: Heart },
            { id: "topics", label: t("users.profile.stats.topics"), v: s.topics_created, icon: MessageSquare },
            { id: "comments", label: t("users.profile.stats.comments"), v: s.comments_created, icon: MessageSquare },
            { id: "audits", label: t("users.profile.stats.audits"), v: s.audit_actions, icon: Shield },
            { id: "invited", label: t("users.profile.stats.invited"), v: s.invited_count, icon: Users },
          ].map((it) => (
            <div key={it.id} className="rounded-md border border-black/10 dark:border-white/[0.08] bg-surface p-2.5 text-center shadow-2xs">
              <div className="text-[10px] text-gray-500 font-mono flex items-center justify-center gap-1"><it.icon className="w-3 h-3" /><span>{it.label}</span></div>
              <div className="text-base font-bold text-gray-900 dark:text-white mt-0.5">{it.v}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1">
          {tabs.map((tabItem) => (
            <button key={tabItem.id} onClick={() => { setTab(tabItem.id); setPage(1); }} className={`px-3 h-7 rounded-md text-xs font-medium border shrink-0 transition-colors ${tab === tabItem.id ? "bg-primary text-white keep-white border-primary shadow-xs" : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"}`}>{tabItem.label}</button>
          ))}
        </div>

        <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft">
          {loading ? <div className="p-8 text-center text-gray-500 text-xs font-mono">{t("common.loading")}</div>
          : tab === "favorites" && !favVisible ? (
            <div className="p-10 text-center space-y-2">
              <Lock className="w-6 h-6 text-gray-400 mx-auto" strokeWidth={1.5} />
              <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">{t("users.profile.favoritesPrivate")}</div>
              <div className="text-xs text-gray-500 font-mono">{t("users.profile.favoritesPrivateHint")}</div>
            </div>
          )
          : tab === "favorites" && items.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-xs font-mono">{t("users.profile.noFavorites")}</div>
          )
          : tab === "favorites" ? (
            <ul className="divide-y divide-black/5 dark:divide-white/[0.06]">
              {items.map((it: FavoriteItem) => {
                const href = it.target_type === "work" ? `/works/${it.target_id}` : it.target_type === "release" ? `/releases/${it.target_id}` : it.target_type === "franchise" ? `/franchises/${it.target_id}` : `/artists/${it.target_id}`;
                const title = it.work?.title || it.release?.edition_name || it.artist?.name || it.franchise?.title || it.target_id;
                const typeLabel = it.target_type === "work" ? t("users.profile.tabs.works") : it.target_type === "release" ? t("users.profile.tabs.releases") : it.target_type === "franchise" ? t("explore.typeFranchises") : t("users.profile.tabs.artists");
                return (
                  <li key={it.id}>
                    <Link href={href} className="p-3 flex items-center gap-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group">
                      <Heart className="w-3.5 h-3.5 shrink-0 text-rose-500" fill="currentColor" strokeWidth={0} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-gray-900 dark:text-white font-medium truncate group-hover:text-primary transition-colors">{title}</div>
                        <div className="text-[10px] text-gray-500 font-mono mt-0.5">{typeLabel}{it.created_at ? ` · ${new Date(it.created_at).toLocaleDateString()}` : ""}</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
          : items.length === 0 ? <div className="p-8 text-center text-gray-500 text-xs font-mono">{t("users.profile.noData")}</div> : (
            <ul className="divide-y divide-black/5 dark:divide-white/[0.06]">
              {items.map((it: any, idx: number) => (
                <li key={idx} className="p-3 flex items-start gap-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                  <History className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-gray-900 dark:text-white font-medium truncate">
                      {it.title ? <Link href={it.work_id ? `/works/${it.work_id}` : it.work?.id ? `/works/${it.work.id}` : it.id ? `/works/${it.id}` : "#"} className="hover:text-primary transition-colors">{it.title || it.edition_name || it.name || it.action || it.content?.slice(0, 60)}</Link> : it.edition_name ? <Link href={`/releases/${it.id}`} className="hover:text-primary transition-colors">{it.edition_name}</Link> : it.name ? <Link href={`/artists/${it.id}`} className="hover:text-primary transition-colors">{it.name}</Link> : it.action ? <span>{it.action} · {it.target_type}:{String(it.target_id).slice(0, 8)}</span> : <span className="text-gray-600 dark:text-gray-300 line-clamp-2">{it.content}</span>}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">{it.created_at ? new Date(it.created_at).toLocaleString() : ""}{it.is_master_verified !== undefined ? ` · ${it.is_master_verified ? t("users.profile.verified") : t("users.profile.pending")}` : ""}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="font-mono text-[11px]">{t("users.profile.pagination", { total, page })}</span>
          <div className="flex gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-2.5 h-6.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 disabled:opacity-40 hover:text-primary transition-colors text-xs">{t("users.profile.prevPage")}</button>
            <button disabled={items.length < 20} onClick={() => setPage((p) => p + 1)} className="px-2.5 h-6.5 rounded-md bg-primary text-white keep-white font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity text-xs">{t("users.profile.nextPage")}</button>
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
