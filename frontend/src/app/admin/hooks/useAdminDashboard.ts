"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchApi,
  AdminStats,
  User,
  Work,
  Release,
  CanonicalEntry,
  AssetFile,
  DiscussionTopic,
  Artist,
  AdminAuditLog,
  VirtualShelf,
  updateWorkStatus,
} from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import type { Tab } from "../components/types";

export function useAdminDashboard() {
  const { user, loading: authLoading, logout } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [worksList, setWorksList] = useState<Work[]>([]);
  const [releasesList, setReleasesList] = useState<Release[]>([]);
  const [expressionsList, setExpressionsList] = useState<CanonicalEntry[]>([]);
  const [artistsList, setArtistsList] = useState<Artist[]>([]);
  const [assetsList, setAssetsList] = useState<AssetFile[]>([]);
  const [topicsList, setTopicsList] = useState<DiscussionTopic[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [shelvesList, setShelvesList] = useState<VirtualShelf[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntityType, setSelectedEntityType] = useState<string>("all");
  const [roleUpdatingId, setRoleUpdatingId] = useState<string | null>(null);
  const [verifyingReleaseId, setVerifyingReleaseId] = useState<string | null>(null);
  const [expandedReleaseId, setExpandedReleaseId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<string>("pending_review");

  const [isShelfModalOpen, setIsShelfModalOpen] = useState(false);
  const [shelfForm, setShelfForm] = useState<Partial<VirtualShelf>>({
    slug: "",
    name_zh: "",
    name_en: "",
    query_tags: [],
    require_all_tags: false,
    sort_order: 0,
  });
  const [shelfTagInput, setShelfTagInput] = useState("");

  const [isArtistModalOpen, setIsArtistModalOpen] = useState(false);
  const [editingArtist, setEditingArtist] = useState<Artist | null>(null);
  const [artistForm, setArtistForm] = useState({
    name: "",
    original_name: "",
    disambiguation: "",
    entity_type: "",
    country: "",
    biography: "",
    mb_id: "",
    bangumi_id: "",
    imdb_id: "",
    tmdb_id: "",
  });
  const [artistSubmitting, setArtistSubmitting] = useState(false);

  const [isExprModalOpen, setIsExprModalOpen] = useState(false);
  const [exprForm, setExprForm] = useState({
    title: "",
    sort_title: "",
    duration_seconds: 0,
    isrc: "",
    isbn: "",
    artist_credit: "",
    work_id: "",
  });

  const [isWorkModalOpen, setIsWorkModalOpen] = useState(false);
  const [workForm, setWorkForm] = useState({
    title: "",
    original_title: "",
    summary: "",
    cover_image_url: "",
  });

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== "admin" && user.role !== "archivist"))) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, u, w, rel, expr, art, a, topicsRes, auditRes, shelvesRes] = await Promise.all([
        fetchApi<AdminStats>("/admin/stats").catch(() => null),
        fetchApi<{ items: User[]; total: number }>("/admin/users?page_size=100").catch(() => ({ items: [], total: 0 })),
        fetchApi<{ items: Work[]; total: number }>("/admin/works?page_size=100").catch(() => ({ items: [], total: 0 })),
        fetchApi<{ items: Release[]; total: number }>("/admin/releases?page_size=100").catch(() => ({ items: [], total: 0 })),
        fetchApi<{ items: CanonicalEntry[]; total: number }>("/admin/canonical-entries?page_size=100").catch(() => ({ items: [], total: 0 })),
        fetchApi<{ items: Artist[]; total: number }>("/admin/artists?page_size=100").catch(() => ({ items: [], total: 0 })),
        fetchApi<{ items: AssetFile[]; total: number }>("/admin/assets?page_size=100").catch(() => ({ items: [], total: 0 })),
        fetchApi<{ items: DiscussionTopic[]; total: number }>("/community/topics?page_size=100").catch(() => ({ items: [], total: 0 })),
        fetchApi<{ items: AdminAuditLog[]; total: number }>("/admin/audit-logs?page_size=50").catch(() => ({ items: [], total: 0 })),
        fetchApi<VirtualShelf[]>("/admin/shelves").catch(() => []),
      ]);

      if (s) setStats(s);
      setUsersList(u.items || []);
      setWorksList(w.items || []);
      setReleasesList(rel.items || []);
      setExpressionsList(expr.items || []);
      setArtistsList(art.items || []);
      setAssetsList(a.items || []);
      setTopicsList(topicsRes.items || []);
      setAuditLogs(auditRes.items || []);
      setShelvesList(shelvesRes || []);
    } catch (err) {
      console.error("Admin data load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && (user.role === "admin" || user.role === "archivist")) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleUpdateRole = async (userId: string, newRole: string) => {
    setRoleUpdatingId(userId);
    try {
      await fetchApi(`/admin/users/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      });
      setUsersList((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    } catch (err: any) {
      alert(err.message || t("auth.requestFailed"));
    } finally {
      setRoleUpdatingId(null);
    }
  };

  const handleToggleVerification = async (releaseId: string, current: boolean) => {
    setVerifyingReleaseId(releaseId);
    try {
      await fetchApi(`/admin/releases/${releaseId}/verify`, {
        method: "PUT",
        body: JSON.stringify({ is_master_verified: !current }),
      });
      setReleasesList((prev) => prev.map((r) => (r.id === releaseId ? { ...r, is_master_verified: !current } : r)));
      setWorksList((prev) =>
        prev.map((w) => ({
          ...w,
          releases: w.releases?.map((r) => (r.id === releaseId ? { ...r, is_master_verified: !current } : r)),
        }))
      );
    } catch (err: any) {
      alert(err.message || t("auth.requestFailed"));
    } finally {
      setVerifyingReleaseId(null);
    }
  };

  const handleRetryAsset = async (assetId: string) => {
    try {
      await fetchApi(`/admin/assets/${assetId}/retry`, { method: "POST" });
      alert(t("admin.alert.retryTranscode"));
      loadData();
    } catch (e: any) {
      alert(e.message || t("admin.alert.retryFailed"));
    }
  };

  const handleDeleteTopic = async (topicId: string) => {
    if (!confirm(t("common.confirmDeleteTopic"))) return;
    try {
      await fetchApi(`/admin/topics/${topicId}`, { method: "DELETE" });
      setTopicsList((prev) => prev.filter((t) => t.id !== topicId));
    } catch (err: any) {
      alert(err.message || t("auth.requestFailed"));
    }
  };

  const handleApproveWork = async (workId: string) => {
    setReviewingId(workId);
    try {
      await updateWorkStatus(workId, "published");
      setWorksList((prev) => prev.map((w) => (w.id === workId ? { ...w, status: "published" } : w)));
    } catch (e: any) {
      alert(e.message || t("admin.alert.reviewFailed"));
    } finally {
      setReviewingId(null);
    }
  };

  const handleRejectWork = async (workId: string) => {
    setReviewingId(workId);
    try {
      await updateWorkStatus(workId, "rejected");
      setWorksList((prev) => prev.map((w) => (w.id === workId ? { ...w, status: "rejected" } : w)));
    } catch (e: any) {
      alert(e.message || t("admin.alert.rejectFailed"));
    } finally {
      setReviewingId(null);
    }
  };

  const handleOpenCreateShelf = () => {
    setShelfForm({
      slug: "",
      name_zh: "",
      name_en: "",
      names: { "zh-CN": "", "en-US": "" },
      query_tags: [],
      require_all_tags: false,
      sort_order: (shelvesList.length + 1) * 10,
    });
    setShelfTagInput("");
    setIsShelfModalOpen(true);
  };

  const handleOpenEditShelf = (shelf: VirtualShelf) => {
    const initialNames: Record<string, string> = { ...(shelf.names || {}) };
    if (!initialNames["zh-CN"] && shelf.name_zh) initialNames["zh-CN"] = shelf.name_zh;
    if (!initialNames["en-US"] && shelf.name_en) initialNames["en-US"] = shelf.name_en;

    setShelfForm({ ...shelf, names: initialNames, query_tags: shelf.query_tags || [] });
    setShelfTagInput("");
    setIsShelfModalOpen(true);
  };

  const handleSaveShelf = async (e: React.FormEvent) => {
    e.preventDefault();
    const names = { ...(shelfForm.names || {}) };
    const nameZh = names["zh-CN"] || shelfForm.name_zh || Object.values(names)[0] || "";
    const nameEn = names["en-US"] || shelfForm.name_en || nameZh;

    if (!shelfForm.slug || (!nameZh && Object.keys(names).length === 0)) {
      alert(t("admin.alert.shelfRequired"));
      return;
    }

    const payload = {
      ...shelfForm,
      name_zh: nameZh,
      name_en: nameEn,
      names,
    };

    try {
      await fetchApi("/admin/shelves", { method: "POST", body: JSON.stringify(payload) });
      setIsShelfModalOpen(false);
      const res = await fetchApi<VirtualShelf[]>("/admin/shelves");
      setShelvesList(res || []);
    } catch (e: any) {
      alert(e.message || t("admin.alert.saveShelfFailed"));
    }
  };

  const handleDeleteShelf = async (slug: string) => {
    if (!confirm(t("admin.alert.deleteShelfConfirm", { slug }))) return;
    try {
      await fetchApi(`/admin/shelves/${slug}`, { method: "DELETE" });
      setShelvesList((prev) => prev.filter((s) => s.slug !== slug));
    } catch (e: any) {
      alert(e.message || t("admin.alert.deleteShelfFailed"));
    }
  };

  const handleOpenCreateArtist = () => {
    setEditingArtist(null);
    setArtistForm({
      name: "",
      original_name: "",
      disambiguation: "",
      entity_type: "",
      country: "",
      biography: "",
      mb_id: "",
      bangumi_id: "",
      imdb_id: "",
      tmdb_id: "",
    });
    setIsArtistModalOpen(true);
  };

  const handleOpenEditArtist = (artist: Artist) => {
    setEditingArtist(artist);
    const ext = artist.external_ids || {};
    const eType = artist.entity_type || "";

    setArtistForm({
      name: artist.name || "",
      original_name: artist.original_name || "",
      disambiguation: artist.disambiguation || "",
      entity_type: eType,
      country: artist.country || "",
      biography: artist.biography || "",
      mb_id: ext.musicbrainz || "",
      bangumi_id: ext.bangumi || "",
      imdb_id: ext.imdb || "",
      tmdb_id: ext.tmdb || "",
    });
    setIsArtistModalOpen(true);
  };

  const handleSaveArtist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artistForm.name.trim()) return;
    setArtistSubmitting(true);
    try {
      const extIds: Record<string, string> = {};
      if (artistForm.mb_id.trim()) extIds.musicbrainz = artistForm.mb_id.trim();
      if (artistForm.bangumi_id.trim()) extIds.bangumi = artistForm.bangumi_id.trim();
      if (artistForm.imdb_id.trim()) extIds.imdb = artistForm.imdb_id.trim();
      if (artistForm.tmdb_id.trim()) extIds.tmdb = artistForm.tmdb_id.trim();

      const payload = {
        name: artistForm.name.trim(),
        original_name: artistForm.original_name.trim() || undefined,
        disambiguation: artistForm.disambiguation.trim() || undefined,
        entity_type: artistForm.entity_type,
        country: artistForm.country.trim() || undefined,
        biography: artistForm.biography.trim() || undefined,
        external_ids: Object.keys(extIds).length > 0 ? extIds : undefined,
      };

      if (editingArtist) {
        await fetchApi(`/admin/artists/${editingArtist.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await fetchApi("/admin/artists", { method: "POST", body: JSON.stringify(payload) });
      }

      setIsArtistModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(err.message || t("auth.requestFailed"));
    } finally {
      setArtistSubmitting(false);
    }
  };

  const handleDeleteArtist = async (artist: Artist) => {
    if (!confirm(t("common.confirmDeleteEntity", { name: artist.name }))) return;
    try {
      await fetchApi(`/admin/artists/${artist.id}`, { method: "DELETE" });
      setArtistsList((prev) => prev.filter((a) => a.id !== artist.id));
    } catch (err: any) {
      alert(err.message || t("auth.requestFailed"));
    }
  };

  const handleCreateExpression = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exprForm.title.trim()) return;
    try {
      await fetchApi("/admin/canonical-entries", {
        method: "POST",
        body: JSON.stringify({
          title: exprForm.title.trim(),
          sort_title: exprForm.sort_title.trim(),
          duration_seconds: Number(exprForm.duration_seconds) || 0,
          isrc: exprForm.isrc.trim(),
          isbn: exprForm.isbn.trim(),
          artist_credit: exprForm.artist_credit.trim(),
          work_id: exprForm.work_id ? exprForm.work_id : undefined,
        }),
      });
      setIsExprModalOpen(false);
      setExprForm({ title: "", sort_title: "", duration_seconds: 0, isrc: "", isbn: "", artist_credit: "", work_id: "" });
      loadData();
    } catch (e: any) {
      alert(e.message || t("admin.alert.createFailed"));
    }
  };

  const handleDeleteExpression = async (id: string, title: string) => {
    if (!confirm(t("admin.alert.deleteExpressionConfirm", { title }))) return;
    try {
      await fetchApi(`/admin/canonical-entries/${id}`, { method: "DELETE" });
      setExpressionsList((prev) => prev.filter((x) => x.id !== id));
    } catch (e: any) {
      alert(e.message || t("admin.alert.deleteFailed"));
    }
  };

  const handleCreateWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workForm.title.trim()) return;
    try {
      await fetchApi("/admin/works", { method: "POST", body: JSON.stringify(workForm) });
      setIsWorkModalOpen(false);
      setWorkForm({ title: "", original_title: "", summary: "", cover_image_url: "" });
      loadData();
    } catch (e: any) {
      alert(e.message || t("admin.alert.createWorkFailed"));
    }
  };

  const filteredArtists = artistsList.filter((a) => {
    const matchesSearch =
      !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.original_name && a.original_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (a.country && a.country.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = selectedEntityType === "all" || a.entity_type === selectedEntityType;
    return matchesSearch && matchesType;
  });

  const pendingReviewsCount = worksList.filter((w) => w.status === "pending_review").length;

  const filteredReviewWorks = worksList.filter((w) => {
    if (reviewFilter !== "all" && (w.status || "published") !== reviewFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return w.title.toLowerCase().includes(q) || (w.original_title && w.original_title.toLowerCase().includes(q));
  });

  const filteredShelves = shelvesList.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.slug.toLowerCase().includes(q) || s.name_zh.toLowerCase().includes(q) || s.name_en.toLowerCase().includes(q);
  });

  const filteredWorks = worksList.filter((w) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return w.title.toLowerCase().includes(q) || (w.original_title && w.original_title.toLowerCase().includes(q)) || (w.tags || []).some((tag) => tag.name.toLowerCase().includes(q));
  });

  const filteredExpressions = expressionsList.filter((x) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return x.title.toLowerCase().includes(q) || (x.artist_credit && x.artist_credit.toLowerCase().includes(q)) || (x.isrc && x.isrc.toLowerCase().includes(q)) || (x.isbn && x.isbn.toLowerCase().includes(q));
  });

  const filteredReleases = releasesList.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.edition_name.toLowerCase().includes(q) ||
      (r.catalog_number && r.catalog_number.toLowerCase().includes(q)) ||
      (r.barcode && r.barcode.toLowerCase().includes(q)) ||
      (r.publisher && r.publisher.toLowerCase().includes(q))
    );
  });

  const filteredUsers = usersList.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const dn = ((u as any).display_name as string | null | undefined) || "";
    return (
      u.username.toLowerCase().includes(q) ||
      dn.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      u.id.toLowerCase().includes(q) ||
      (u.invite_code && u.invite_code.toLowerCase().includes(q))
    );
  });

  const handleUpdateUser = async (
    userId: string,
    payload: { email?: string; display_name?: string; password?: string; role?: string }
  ): Promise<User> => {
    setRoleUpdatingId(userId);
    try {
      const updated = await fetchApi<User>(`/admin/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setUsersList((prev) => prev.map((x) => (x.id === userId ? { ...x, ...updated } : x)));
      return updated;
    } catch (err: any) {
      throw err;
    } finally {
      setRoleUpdatingId(null);
    }
  };

  const filteredAssets = assetsList.filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return a.file_name.toLowerCase().includes(q) || a.sha256_hash.toLowerCase().includes(q) || a.s3_key.toLowerCase().includes(q);
  });

  return {
    user,
    authLoading,
    logout,
    locale,
    t,
    activeTab,
    setActiveTab,
    stats,
    usersList,
    worksList,
    releasesList,
    expressionsList,
    artistsList,
    assetsList,
    topicsList,
    auditLogs,
    shelvesList,
    loading,
    searchQuery,
    setSearchQuery,
    selectedEntityType,
    setSelectedEntityType,
    roleUpdatingId,
    verifyingReleaseId,
    expandedReleaseId,
    setExpandedReleaseId,
    reviewingId,
    reviewFilter,
    setReviewFilter,
    isShelfModalOpen,
    setIsShelfModalOpen,
    shelfForm,
    setShelfForm,
    shelfTagInput,
    setShelfTagInput,
    isArtistModalOpen,
    setIsArtistModalOpen,
    editingArtist,
    artistForm,
    setArtistForm,
    artistSubmitting,
    isExprModalOpen,
    setIsExprModalOpen,
    exprForm,
    setExprForm,
    isWorkModalOpen,
    setIsWorkModalOpen,
    workForm,
    setWorkForm,
    loadData,
    handleUpdateRole,
    handleUpdateUser,
    handleToggleVerification,
    handleRetryAsset,
    handleDeleteTopic,
    handleApproveWork,
    handleRejectWork,
    handleOpenCreateShelf,
    handleOpenEditShelf,
    handleSaveShelf,
    handleDeleteShelf,
    handleOpenCreateArtist,
    handleOpenEditArtist,
    handleSaveArtist,
    handleDeleteArtist,
    handleCreateExpression,
    handleDeleteExpression,
    handleCreateWork,
    filteredArtists,
    pendingReviewsCount,
    filteredReviewWorks,
    filteredShelves,
    filteredWorks,
    filteredExpressions,
    filteredReleases,
    filteredUsers,
    filteredAssets,
  };
}

export type AdminDashboard = ReturnType<typeof useAdminDashboard>;
