"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { DefinitionsEditor } from "@/components/catalog/DefinitionsEditor";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { useDefinitions, getTypeName } from "@/lib/definitions";
import { PageContainer } from "@/components/ui/PageShell";
import { TabPanel } from "@/components/ui/TabPanel";
import { ExternalDatabasesTab } from "./components/tabs/ExternalDatabasesTab";
import { ShelvesTab } from "./components/tabs/ShelvesTab";
import { AccountAccessTab } from "./components/tabs/AccountAccessTab";
import { canEnterAdmin } from "@/lib/permissions";
import { fetchApi } from "@/lib/api";
import {
  Shield,
  LayoutDashboard,
  Sliders,
  CheckSquare,
  GitMerge,
  Cpu,
  Users,
  ArrowLeft,
  RefreshCw,
  Power,
  Layers,
  Search,
  Plus,
  ArrowUpRight,
  Trash2,
  Globe,
  ShieldCheck,
} from "lucide-react";

type AdminTab =
  | "overview"
  | "entities"
  | "definitions"
  | "reviews"
  | "merge"
  | "modules"
  | "users"
  | "extdb"
  | "shelves"
  | "accounts";

function AdminInner() {
  const { user, loading: authLoading } = useAuth();
  const { t, tr, locale } = useI18n();
  const router = useRouter();

  const { definitions: defs } = useDefinitions();

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [stats, setStats] = useState({
    pending: 0,
    totalEntities: 0,
  });
  const [modules, setModules] = useState<any[]>([]);
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  // 审核动作的反馈：原来用 alert()，既不本地化也打断操作
  const [reviewNotice, setReviewNotice] = useState("");

  // Entities management state
  const [entitiesList, setEntitiesList] = useState<any[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entitiesQ, setEntitiesQ] = useState("");
  const [entitiesKind, setEntitiesKind] = useState("all");
  const [entitiesStatus, setEntitiesStatus] = useState("all");

  // Merge form states
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeNote, setMergeNote] = useState("");
  const [mergeMessage, setMergeMessage] = useState("");
  const [merging, setMerging] = useState(false);

  // Users state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [userActionMsg, setUserActionMsg] = useState("");

  const loadOverview = () => {
    fetch("/api/catalog/entities?status=pending_review", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        setPendingItems(d.items || []);
        setStats((prev) => ({ ...prev, pending: (d.items || []).length }));
      })
      .catch(() => {});

    fetch("/api/catalog/entities?limit=1", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .catch(() => {});

    fetch("/api/capabilities", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { modules: [] }))
      .then((d) => setModules(d.modules || []))
      .catch(() => {});
  };

  const loadEntities = () => {
    setEntitiesLoading(true);
    const params = new URLSearchParams();
    if (entitiesKind !== "all") params.set("kind", entitiesKind);
    if (entitiesStatus !== "all") params.set("status", entitiesStatus);
    if (entitiesQ.trim()) params.set("q", entitiesQ.trim());
    params.set("limit", "50");

    fetch(`/api/catalog/entities?${params.toString()}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setEntitiesList(d.items || []))
      .catch(() => setEntitiesList([]))
      .finally(() => setEntitiesLoading(false));
  };

  // 取数条件与进入管理台的闸门保持一致（canEnterAdmin，按权限码判定）：
  // 原来只认 role==="admin"，导致后台分配了管理权限组、但 role 仍是 user 的成员
  // 能进 /admin 却永远看不到概览与实体列表（空面板而非"无权限"，等于假象无数据）。
  const mayEnter = canEnterAdmin(user);

  useEffect(() => {
    if (mayEnter) {
      loadOverview();
    }
  }, [mayEnter]);

  useEffect(() => {
    if (activeTab === "entities" && mayEnter) {
      loadEntities();
    }
  }, [activeTab, entitiesKind, entitiesStatus, mayEnter]);

  const handleEntityLifecycle = async (id: string, newStatus: string) => {
    try {
      // Find current entity to get version
      const target = entitiesList.find((e) => e.id === id);
      const res = await fetch(`/api/catalog/entities/${id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: {
            ...target,
            status: newStatus,
          },
          expected_version: target?.version || 1,
          edit_note: `Admin lifecycle status changed to ${newStatus}`,
          sources: [{ kind: "editorial", citation: "Admin Console Lifecycle" }],
        }),
      });
      if (res.ok) {
        loadEntities();
      } else {
        const err = await res.json();
        alert(err.error || "Action failed");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleReviewAction = async (id: string, action: "published" | "draft") => {
    setReviewNotice("");
    try {
      // PUT 是整份替换：必须先把实体读全再改状态。
      // 之前直接提交待审列表里的摘要对象（且用不带 Authorization 的裸 fetch），
      // 服务端会因缺字段/校验失败返回 400，按钮点了等于没反应。
      const full = await fetchApi<Record<string, any>>(`/catalog/entities/${id}`);
      const { updated_at: _updatedAt, ...doc } = full;
      await fetchApi(`/catalog/entities/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          entity: { ...doc, id, status: action },
          expected_version: full.version || 1,
          edit_note:
            action === "published"
              ? t("admin.reviews.approveNote")
              : t("admin.reviews.rejectNote"),
          // 来源必须是 { kind: "url", url, citation }：kind: "editorial" 且缺 url 会被服务端拒为 invalid_source
          sources: [
            {
              kind: "url",
              url: `${window.location.origin}/catalog/${id}`,
              citation: t("admin.reviews.sourceCitation"),
            },
          ],
        }),
      });
      setPendingItems((prev) => prev.filter((i) => i.id !== id));
      setReviewNotice(action === "published" ? t("admin.reviews.approved") : t("admin.reviews.rejected"));
    } catch (e) {
      setReviewNotice(String((e as Error).message || e));
    }
  };

  // 这里刻意没有"启停"动作：运行时模块开关已随子系统拆分退役，
  // 能力是否可用由部署决定（服务在不在、配置没配置），后端 PUT /api/admin/modules/:id
  // 恒定返回 409 module_toggle_retired。面板只呈现事实，不提供会必然失败的按钮。

  const handleMergeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMerging(true);
    setMergeMessage("");
    try {
      // Find source entity version
      const srcRes = await fetch(`/api/catalog/entities/${mergeSource.trim()}`, { credentials: "same-origin" });
      if (!srcRes.ok) {
        setMergeMessage("Source entity not found");
        return;
      }
      const srcData = await srcRes.json();
      const res = await fetch(`/api/catalog/entities/${mergeSource.trim()}/lifecycle`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_id: mergeTarget.trim(),
          expected_version: srcData.version,
          edit_note: mergeNote.trim() || "Merged via Admin Console",
          sources: [{ kind: "editorial", citation: "Administrative Merge" }],
        }),
      });
      if (res.ok) {
        setMergeMessage(t("admin.console.mergeSuccess"));
        setMergeSource("");
        setMergeTarget("");
        setMergeNote("");
      } else {
        const err = await res.json();
        setMergeMessage(`Error: ${err.error || "Merge failed"}`);
      }
    } catch (e: any) {
      setMergeMessage(`Error: ${e.message}`);
    } finally {
      setMerging(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingUser(true);
    setUserActionMsg("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
        }),
      });
      if (res.ok) {
        setUserActionMsg(t("admin.console.userCreated"));
        setNewUsername("");
        setNewPassword("");
      } else {
        const err = await res.json();
        setUserActionMsg(`Error: ${err.error || "Failed"}`);
      }
    } catch (e: any) {
      setUserActionMsg(`Error: ${e.message}`);
    } finally {
      setCreatingUser(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-text-faint font-mono text-xs">
        <RefreshCw className="w-5 h-5 animate-spin text-primary mr-2" />
        {t("admin.console.checkingPerms")}
      </div>
    );
  }

  if (!user || !canEnterAdmin(user)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mb-4">
          <Shield className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-text-strong mb-2">
          {t("admin.console.permRequired")}
        </h1>
        <p className="text-sm text-text-muted max-w-md mb-6">
          {t("admin.console.permDesc")}
        </p>
        <Link
          href="/account"
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-medium"
        >
          {t("admin.console.goLogin")}
        </Link>
      </div>
    );
  }

  const navTabs = [
    { id: "overview", labelKey: "admin.tab.overview", icon: LayoutDashboard },
    { id: "entities", labelKey: "admin.nav.entities", icon: Layers },
    { id: "definitions", labelKey: "admin.tab.definitions", icon: Sliders },
    { id: "extdb", labelKey: "admin.tab.extdb", icon: Globe },
    { id: "shelves", labelKey: "admin.tab.shelves", icon: LayoutDashboard },
    { id: "reviews", labelKey: "admin.tab.reviews", icon: CheckSquare },
    { id: "merge", labelKey: "admin.tab.merge", icon: GitMerge },
    { id: "modules", labelKey: "admin.tab.modules", icon: Cpu },
    { id: "users", labelKey: "admin.tab.users", icon: Users },
    { id: "accounts", labelKey: "admin.tab.accounts", icon: ShieldCheck },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-text-strong">
      {/* Admin Topbar */}
      <header className="border-b border-line bg-surface/90 backdrop-blur sticky top-[var(--mf-header-h)] z-30">
        <PageContainer className="h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-strong transition-colors duration-fast ease-soft"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t("admin.console.backToSite")}</span>
            </Link>
            <span className="text-text-faint">/</span>
            <div className="flex items-center gap-2 font-semibold text-sm text-text-strong">
              <Shield className="w-4 h-4 text-primary" />
              <span>{t("admin.console.consoleTitle")}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-text-muted">
            <span className="px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
              {user.username} ({user.role})
            </span>
          </div>
        </PageContainer>
      </header>

      <PageContainer className="py-6 flex-1 flex flex-col md:flex-row gap-6">
        {/* Left Sidebar */}
        <aside className="w-full md:w-60 shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0 scrollbar-none sticky top-[calc(var(--mf-header-h)+1.5rem)]">
            {navTabs.map((tItem) => {
              const Icon = tItem.icon;
              const active = activeTab === tItem.id;
              return (
                <button
                  key={tItem.id}
                  type="button"
                  onClick={() => setActiveTab(tItem.id as AdminTab)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all text-left whitespace-nowrap ${
                    active
                      ? "bg-primary text-white shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-strong hover:bg-surfaceHover"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{t(tItem.labelKey)}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right Main Workbench */}
        {/* key 让每次切换页签都重放进入动画；外层统一包裹层保证各页签的首元素落在同一纵向位置 */}
        <TabPanel activeKey={activeTab} spacing="none" className="flex-1 min-w-0">
          <div className="space-y-4 [&>*:first-child]:mt-0">
          {activeTab === "overview" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle">
                <h2 className="text-base font-semibold text-text-strong mb-1.5">
                  {t("admin.console.sysOverview")}
                </h2>
                <p className="text-xs text-text-muted leading-relaxed">
                  {t("admin.console.sysOverviewDesc")}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t("admin.console.pendingReviews")}
                  </div>
                  <div className="text-2xl font-bold text-amber-400">{stats.pending}</div>
                </div>
                <div className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t("admin.console.totalModules")}
                  </div>
                  <div className="text-2xl font-bold text-text-strong">{modules.length || 6}</div>
                </div>
                <div className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t("admin.console.coreEngine")}
                  </div>
                  <div className="text-sm font-semibold text-emerald-400">PostgreSQL 16</div>
                </div>
                <div className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t("admin.console.authSession")}
                  </div>
                  <div className="text-sm font-semibold text-sky-400">HTTP-Only Cookie</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "entities" && (
            <div className="space-y-4">
              {/* Entities Header & Search */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-surfaceSubtle border border-line-subtle">
                <div>
                  <h2 className="text-base font-semibold text-text-strong">
                    {t("admin.entities.title")}
                  </h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t("admin.entities.desc")}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadEntities}
                    className="p-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-xs text-text-body transition-colors duration-fast ease-soft cursor-pointer"
                    title="Refresh"
                  >
                    <RefreshCw className={`w-4 h-4 ${entitiesLoading ? "animate-spin text-primary" : ""}`} />
                  </button>
                  <Link
                    href="/new"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-medium text-white transition-colors duration-fast ease-soft"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t("catalog.newEntity")}</span>
                  </Link>
                </div>
              </div>

              {/* Filter Row */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-xl bg-surfaceSubtle border border-line-subtle">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    loadEntities();
                  }}
                  className="sm:col-span-5 relative flex items-center"
                >
                  <Search className="absolute left-3 w-4 h-4 text-text-faint" />
                  <input
                    type="text"
                    value={entitiesQ}
                    onChange={(e) => setEntitiesQ(e.target.value)}
                    placeholder={t("admin.entities.search")}
                    className="w-full pl-9 pr-14 py-1.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
                  />
                  <button
                    type="submit"
                    className="absolute right-1 px-2.5 py-0.5 rounded bg-primary/20 hover:bg-primary/30 text-primary text-[11px] font-medium transition-colors duration-fast ease-soft"
                  >
                    {t("catalog.searchAction")}
                  </button>
                </form>

                <div className="sm:col-span-3">
                  <select
                    value={entitiesKind}
                    aria-label={t("catalog.kindLabel")}
                    onChange={(e) => setEntitiesKind(e.target.value)}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-body focus:border-primary outline-none"
                  >
                    <option value="all">{t("catalog.kind.all")}</option>
                    {["work", "release", "agent", "collection", "content_unit", "expression", "medium", "track"].map((k) => (
                      <option key={k} value={k}>{tr(`catalog.kind.${k}`, k)}</option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <select
                    value={entitiesStatus}
                    aria-label={t("catalog.status")}
                    onChange={(e) => setEntitiesStatus(e.target.value)}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-body focus:border-primary outline-none"
                  >
                    <option value="all">{t("catalog.allStates")}</option>
                    <option value="published">{t("catalog.status.published")}</option>
                    <option value="pending_review">{t("catalog.status.pending_review")}</option>
                    <option value="draft">{t("catalog.status.draft")}</option>
                    <option value="deleted">{t("catalog.status.deleted")}</option>
                    <option value="merged">{t("catalog.status.merged")}</option>
                  </select>
                </div>
              </div>

              {/* Table */}
              {entitiesLoading ? (
                <div className="py-20 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                  <span>{t("catalog.loading")}</span>
                </div>
              ) : entitiesList.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
                  {t("catalog.emptyTitle")}
                </div>
              ) : (
                <div className="rounded-xl border border-line-subtle overflow-hidden bg-surface/40">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-line-subtle bg-surfaceSubtle text-text-muted font-mono">
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colTitle")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colKind")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colStatus")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colTypes")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colVersion")}</th>
                        <th className="py-2.5 px-3 font-medium text-right">{t("admin.entities.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-subtle">
                      {entitiesList.map((e) => (
                        <tr key={e.id} className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft">
                          <td className="py-2.5 px-3">
                            <Link href={`/catalog/${e.id}`} className="font-semibold text-text-strong hover:text-primary transition-colors duration-fast ease-soft line-clamp-1">
                              {e.title}
                            </Link>
                            <div className="text-[10px] text-text-faint font-mono">ID: {e.id}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-1.5 py-0.5 rounded bg-surfaceSubtle text-[10px] font-mono">
                              {tr(`catalog.kind.${e.kind}`, e.kind)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                              e.status === "published" ? "bg-emerald-500/20 text-emerald-400" :
                              e.status === "pending_review" ? "bg-amber-500/20 text-amber-400" :
                              e.status === "deleted" ? "bg-rose-500/20 text-rose-400" :
                              e.status === "merged" ? "bg-purple-500/20 text-purple-400" :
                              "bg-surfaceSubtle text-text-muted"
                            }`}>
                              {tr(`catalog.status.${e.status}`, e.status)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex flex-wrap gap-1">
                              {(e.types || []).map((tCode: string) => (
                                <span key={tCode} className="px-1 py-0.2 rounded bg-surfaceSubtle text-[9px] text-text-muted font-mono">
                                  {getTypeName(defs, tCode, locale)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-text-muted">
                            v{e.version || 1}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Link
                                href={`/catalog/${e.id}`}
                                className="px-2 py-1 rounded bg-surfaceSubtle hover:bg-surfaceHover text-text-body hover:text-text-strong text-[11px] transition-colors duration-fast ease-soft"
                              >
                                {t("admin.entities.edit")}
                              </Link>
                              {e.status !== "published" && (
                                <button
                                  type="button"
                                  onClick={() => handleEntityLifecycle(e.id, "published")}
                                  className="px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
                                >
                                  {t("admin.entities.approve")}
                                </button>
                              )}
                              {e.status === "published" && (
                                <button
                                  type="button"
                                  onClick={() => handleEntityLifecycle(e.id, "draft")}
                                  className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
                                >
                                  {t("admin.entities.reject")}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTab("merge");
                                  setMergeSource(e.id);
                                }}
                                className="px-2 py-1 rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
                              >
                                {t("admin.entities.merge")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "definitions" && (
            <CatalogProvider>
              <DefinitionsEditor />
            </CatalogProvider>
          )}

          {activeTab === "extdb" && <ExternalDatabasesTab />}

          {activeTab === "shelves" && <ShelvesTab />}

          {activeTab === "accounts" && <AccountAccessTab />}

          {activeTab === "reviews" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-text-strong">
                    {t("admin.console.reviewWorkbench")}
                  </h2>
                  <p className="text-xs text-text-muted">
                    {t("admin.console.reviewWorkbenchDesc")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadOverview}
                  className="p-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover text-xs text-text-body"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {reviewNotice && (
                <div className="p-3 rounded-xl border border-primary/30 bg-primary/[0.08] text-xs text-text-body">
                  {reviewNotice}
                </div>
              )}

              {pendingItems.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
                  {t("admin.console.noPending")}
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-mono uppercase">
                            {item.kind}
                          </span>
                          <span className="font-semibold text-sm text-text-strong">{item.title}</span>
                        </div>
                        <div className="text-xs text-text-faint font-mono">
                          ID: {item.id} · v{item.version}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/catalog/${item.id}`}
                          className="px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover text-xs text-text-body"
                        >
                          {t("admin.console.inspect")}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleReviewAction(item.id, "published")}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold"
                        >
                          {t("admin.reviews.approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewAction(item.id, "draft")}
                          className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 text-xs font-semibold"
                        >
                          {t("admin.entities.reject")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "merge" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle">
                <h2 className="text-base font-semibold text-text-strong mb-1">
                  {t("admin.console.mergeTitle")}
                </h2>
                <p className="text-xs text-text-muted leading-relaxed">
                  {t("admin.console.mergeDesc")}
                </p>
              </div>

              <form onSubmit={handleMergeSubmit} className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle space-y-4 max-w-xl">
                <div>
                  <label className="block text-xs font-medium text-text-body mb-1">
                    {t("admin.console.sourceUuid")}
                  </label>
                  <input
                    type="text"
                    required
                    value={mergeSource}
                    onChange={(e) => setMergeSource(e.target.value)}
                    placeholder="e.g. 5d1211ef-afe5-46fb-bfcb-706d84cebaec"
                    className="w-full p-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs font-mono text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-body mb-1">
                    {t("admin.console.targetUuid")}
                  </label>
                  <input
                    type="text"
                    required
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                    placeholder="e.g. ea8c8cd1-c75b-4919-9f02-b61e9a082b44"
                    className="w-full p-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs font-mono text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-body mb-1">
                    {t("admin.console.mergeNote")}
                  </label>
                  <textarea
                    rows={2}
                    value={mergeNote}
                    onChange={(e) => setMergeNote(e.target.value)}
                    placeholder={t("admin.console.mergeNotePlaceholder")}
                    className="w-full p-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
                  />
                </div>

                {mergeMessage && (
                  <div className={`p-3 rounded-lg text-xs font-mono ${
                    mergeMessage.startsWith("Error") ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/20 text-emerald-400"
                  }`}>
                    {mergeMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={merging}
                  className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-xs cursor-pointer"
                >
                  {merging ? t("admin.console.merging") : t("admin.console.executeMerge")}
                </button>
              </form>
            </div>
          )}

          {activeTab === "modules" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-text-strong">
                    {t("admin.console.modulesTitle")}
                  </h2>
                  <p className="text-xs text-text-muted">
                    {t("admin.console.modulesDesc")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadOverview}
                  className="p-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover text-xs text-text-body"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {modules.map((mod) => (
                  <div
                    key={mod.id}
                    className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text-strong text-sm font-mono">{mod.id}</span>
                        <span className="text-[10px] text-text-faint font-mono">v{mod.version}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`w-2 h-2 rounded-full ${mod.enabled ? "bg-emerald-400" : "bg-text-faint"}`} />
                        <span className="text-text-muted font-mono text-[11px]">
                          {mod.enabled ? t("admin.console.active") : t("admin.console.disabled")}
                        </span>
                      </div>
                      {Object.keys(mod.dependencies || {}).length > 0 && (
                        <div className="text-[10px] text-text-faint font-mono pt-1">
                          Deps: {JSON.stringify(mod.dependencies)}
                        </div>
                      )}
                    </div>

                    <span
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                        mod.healthy
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-rose-500/15 text-rose-400"
                      }`}
                    >
                      {mod.healthy ? t("admin.console.healthy") : t("admin.console.unreachable")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "users" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle">
                <h2 className="text-base font-semibold text-text-strong mb-1">
                  {t("admin.console.usersTitle")}
                </h2>
                <p className="text-xs text-text-muted leading-relaxed">
                  {t("admin.console.usersDesc")}
                </p>
              </div>

              <form onSubmit={handleCreateUser} className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle space-y-4 max-w-md">
                <h3 className="font-semibold text-text-strong text-xs">
                  {t("admin.console.createEditorTitle")}
                </h3>
                <div>
                  <label className="block text-xs font-medium text-text-body mb-1">
                    {t("catalog.username")}
                  </label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g. curator_01"
                    className="w-full p-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-body mb-1">
                    {t("admin.console.fieldPassword")}
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full p-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
                  />
                </div>

                {userActionMsg && (
                  <div className={`p-3 rounded-lg text-xs font-mono ${
                    userActionMsg.startsWith("Error") ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/20 text-emerald-400"
                  }`}>
                    {userActionMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={creatingUser}
                  className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-xs cursor-pointer"
                >
                  {creatingUser ? t("admin.console.creating") : t("admin.console.createUser")}
                </button>
              </form>
            </div>
          )}
          </div>
        </TabPanel>
      </PageContainer>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background text-text-faint font-mono text-xs grid place-items-center">Loading Admin...</div>}>
      <AdminInner />
    </Suspense>
  );
}
