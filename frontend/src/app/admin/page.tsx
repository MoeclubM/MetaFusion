"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { DefinitionsEditor } from "@/components/catalog/DefinitionsEditor";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { useDefinitions, getTypeName } from "@/lib/definitions";
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
} from "lucide-react";

type AdminTab = "overview" | "entities" | "definitions" | "reviews" | "merge" | "modules" | "users";

function AdminInner() {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();

  const { definitions: defs } = useDefinitions();

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [stats, setStats] = useState({
    pending: 0,
    totalEntities: 0,
  });
  const [modules, setModules] = useState<any[]>([]);
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);

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

  useEffect(() => {
    if (user?.role === "admin") {
      loadOverview();
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "entities" && user?.role === "admin") {
      loadEntities();
    }
  }, [activeTab, entitiesKind, entitiesStatus]);

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
    try {
      const target = pendingItems.find((e) => e.id === id);
      const res = await fetch(`/api/catalog/entities/${id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: {
            ...target,
            status: action,
          },
          expected_version: target?.version || 1,
          edit_note: action === "published" ? "Approved by admin" : "Rejected by admin",
          sources: [{ kind: "editorial", citation: "Admin Review Workbench" }],
        }),
      });
      if (res.ok) {
        setPendingItems((prev) => prev.filter((i) => i.id !== id));
      } else {
        const err = await res.json();
        alert(err.error || "Review action failed");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleToggleModule = async (modId: string, currentEnabled: boolean) => {
    setLoadingModules(true);
    try {
      const res = await fetch(`/api/admin/modules/${modId}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !currentEnabled,
          cascade: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setModules(data.modules || []);
      } else {
        const err = await res.json();
        alert(err.error || "Module update failed");
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoadingModules(false);
    }
  };

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
        setMergeMessage(locale === "zh-CN" ? "实体合并成功完成！" : "Entity merged successfully!");
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
        setUserActionMsg(locale === "zh-CN" ? "用户创建成功！" : "User created successfully!");
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
      <div className="min-h-screen bg-background flex items-center justify-center text-gray-500 font-mono text-xs">
        <RefreshCw className="w-5 h-5 animate-spin text-primary mr-2" />
        {locale === "zh-CN" ? "验证管理员权限..." : "Checking permissions..."}
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mb-4">
          <Shield className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">
          {locale === "zh-CN" ? "需要管理员权限" : "Admin Permission Required"}
        </h1>
        <p className="text-sm text-gray-400 max-w-md mb-6">
          {locale === "zh-CN"
            ? "当前页面属于系统后台管理控制台，仅对管理员 (Admin) 开放。"
            : "This administrative panel is restricted to system administrators only."}
        </p>
        <Link
          href="/account"
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-medium"
        >
          {locale === "zh-CN" ? "前往账号中心登录" : "Go to Login"}
        </Link>
      </div>
    );
  }

  const navTabs = [
    { id: "overview", labelZh: "控制台概览", labelEn: "Overview", icon: LayoutDashboard },
    { id: "entities", labelZh: t("admin.nav.entities"), labelEn: "Entities", icon: Layers },
    { id: "definitions", labelZh: "元数据定义设计器", labelEn: "Definitions Designer", icon: Sliders },
    { id: "reviews", labelZh: "编目审核工作台", labelEn: "Reviews", icon: CheckSquare },
    { id: "merge", labelZh: "实体版本与合并", labelEn: "Entity Merge", icon: GitMerge },
    { id: "modules", labelZh: "外围模块与能力", labelEn: "Peripheral Modules", icon: Cpu },
    { id: "users", labelZh: "用户与权限管理", labelEn: "Users & Roles", icon: Users },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      {/* Admin Topbar */}
      <header className="border-b border-white/[0.08] bg-surface/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{locale === "zh-CN" ? "返回主站" : "Back to Site"}</span>
            </Link>
            <span className="text-white/20">/</span>
            <div className="flex items-center gap-2 font-semibold text-sm text-white">
              <Shield className="w-4 h-4 text-primary" />
              <span>{locale === "zh-CN" ? "MetaFusion 后台管理控制台" : "MetaFusion Admin Console"}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-gray-400">
            <span className="px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
              {user.username} ({user.role})
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full flex-1 flex flex-col md:flex-row gap-6">
        {/* Left Sidebar */}
        <aside className="w-full md:w-60 shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0 scrollbar-none sticky top-20">
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
                      : "text-gray-400 hover:text-white hover:bg-white/[0.04]"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{locale === "zh-CN" ? tItem.labelZh : tItem.labelEn}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right Main Workbench */}
        <main className="flex-1 min-w-0">
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h2 className="text-base font-semibold text-white mb-2">
                  {locale === "zh-CN" ? "系统架构与运行概况" : "System Status Overview"}
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {locale === "zh-CN"
                    ? "当前系统运行在 MetaFusion 模块化架构之上。核心元数据基于 PostgreSQL 稳定运转；动态类型、属性、关系与模板完全由后台定义驱动。"
                    : "The platform runs on MetaFusion modular architecture. PostgreSQL powers the pure metadata core, with dynamic definitions driving types, relations, and templates."}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20">
                  <div className="text-xs text-gray-400 font-mono mb-1">
                    {locale === "zh-CN" ? "待审核提交" : "Pending Reviews"}
                  </div>
                  <div className="text-2xl font-bold text-amber-400">{stats.pending}</div>
                </div>
                <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20">
                  <div className="text-xs text-gray-400 font-mono mb-1">
                    {locale === "zh-CN" ? "外围模块总数" : "Total Modules"}
                  </div>
                  <div className="text-2xl font-bold text-white">{modules.length || 6}</div>
                </div>
                <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20">
                  <div className="text-xs text-gray-400 font-mono mb-1">
                    {locale === "zh-CN" ? "核心存储引擎" : "Core Engine"}
                  </div>
                  <div className="text-sm font-semibold text-emerald-400">PostgreSQL 16</div>
                </div>
                <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20">
                  <div className="text-xs text-gray-400 font-mono mb-1">
                    {locale === "zh-CN" ? "会话模式" : "Auth Session"}
                  </div>
                  <div className="text-sm font-semibold text-sky-400">HTTP-Only Cookie</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "entities" && (
            <div className="space-y-4">
              {/* Entities Header & Search */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {t("admin.entities.title")}
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t("admin.entities.desc")}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadEntities}
                    className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-gray-300 transition-colors cursor-pointer"
                    title="Refresh"
                  >
                    <RefreshCw className={`w-4 h-4 ${entitiesLoading ? "animate-spin text-primary" : ""}`} />
                  </button>
                  <Link
                    href="/new"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-medium text-white transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t("catalog.newEntity")}</span>
                  </Link>
                </div>
              </div>

              {/* Filter Row */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    loadEntities();
                  }}
                  className="sm:col-span-5 relative flex items-center"
                >
                  <Search className="absolute left-3 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={entitiesQ}
                    onChange={(e) => setEntitiesQ(e.target.value)}
                    placeholder={t("admin.entities.search")}
                    className="w-full pl-9 pr-14 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-gray-500 focus:border-primary outline-none"
                  />
                  <button
                    type="submit"
                    className="absolute right-1 px-2.5 py-0.5 rounded bg-primary/20 hover:bg-primary/30 text-primary text-[11px] font-medium transition-colors"
                  >
                    {t("catalog.searchAction")}
                  </button>
                </form>

                <div className="sm:col-span-3">
                  <select
                    value={entitiesKind}
                    onChange={(e) => setEntitiesKind(e.target.value)}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-gray-300 focus:border-primary outline-none"
                  >
                    <option value="all">{t("catalog.kind.all")}</option>
                    {["work", "release", "agent", "collection", "content_unit", "expression", "medium", "track"].map((k) => (
                      <option key={k} value={k}>{t(`catalog.kind.${k}`) || k}</option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <select
                    value={entitiesStatus}
                    onChange={(e) => setEntitiesStatus(e.target.value)}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-gray-300 focus:border-primary outline-none"
                  >
                    <option value="all">{locale === "zh-CN" ? "全部状态" : "All Statuses"}</option>
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
                <div className="py-20 text-center text-xs text-gray-500 font-mono flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                  <span>{t("catalog.loading")}</span>
                </div>
              ) : entitiesList.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-white/10 text-center text-xs text-gray-500 font-mono">
                  {t("catalog.emptyTitle")}
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.06] overflow-hidden bg-surface/40">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.02] text-gray-400 font-mono">
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colTitle")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colKind")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colStatus")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colTypes")}</th>
                        <th className="py-2.5 px-3 font-medium">{t("admin.entities.colVersion")}</th>
                        <th className="py-2.5 px-3 font-medium text-right">{t("admin.entities.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {entitiesList.map((e) => (
                        <tr key={e.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 px-3">
                            <Link href={`/catalog/${e.id}`} className="font-semibold text-white hover:text-primary transition-colors line-clamp-1">
                              {e.title}
                            </Link>
                            <div className="text-[10px] text-gray-500 font-mono">ID: {e.id}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono">
                              {t(`catalog.kind.${e.kind}`) || e.kind}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                              e.status === "published" ? "bg-emerald-500/20 text-emerald-400" :
                              e.status === "pending_review" ? "bg-amber-500/20 text-amber-400" :
                              e.status === "deleted" ? "bg-rose-500/20 text-rose-400" :
                              e.status === "merged" ? "bg-purple-500/20 text-purple-400" :
                              "bg-gray-500/20 text-gray-400"
                            }`}>
                              {t(`catalog.status.${e.status}`) || e.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex flex-wrap gap-1">
                              {(e.types || []).map((tCode: string) => (
                                <span key={tCode} className="px-1 py-0.2 rounded bg-white/[0.04] text-[9px] text-gray-400 font-mono">
                                  {getTypeName(defs, tCode, locale)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-gray-400">
                            v{e.version || 1}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Link
                                href={`/catalog/${e.id}`}
                                className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 hover:text-white text-[11px] transition-colors"
                              >
                                {t("admin.entities.edit")}
                              </Link>
                              {e.status !== "published" && (
                                <button
                                  type="button"
                                  onClick={() => handleEntityLifecycle(e.id, "published")}
                                  className="px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-[11px] transition-colors cursor-pointer"
                                >
                                  {t("admin.entities.approve")}
                                </button>
                              )}
                              {e.status === "published" && (
                                <button
                                  type="button"
                                  onClick={() => handleEntityLifecycle(e.id, "draft")}
                                  className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-[11px] transition-colors cursor-pointer"
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
                                className="px-2 py-1 rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 text-[11px] transition-colors cursor-pointer"
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

          {activeTab === "reviews" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {locale === "zh-CN" ? "编目审核工作台" : "Review Workbench"}
                  </h2>
                  <p className="text-xs text-gray-400">
                    {locale === "zh-CN" ? "审核用户提交的元数据条目修改与草稿" : "Approve or reject catalog drafts"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadOverview}
                  className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-gray-300"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {pendingItems.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-white/10 text-center text-xs text-gray-500 font-mono">
                  {locale === "zh-CN" ? "当前无待审核条目" : "No pending reviews at this moment"}
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-xl border border-white/[0.06] bg-black/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-mono uppercase">
                            {item.kind}
                          </span>
                          <span className="font-semibold text-sm text-white">{item.title}</span>
                        </div>
                        <div className="text-xs text-gray-500 font-mono">
                          ID: {item.id} · v{item.version}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/catalog/${item.id}`}
                          className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-gray-300"
                        >
                          {locale === "zh-CN" ? "查看详情" : "Inspect"}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleReviewAction(item.id, "published")}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold"
                        >
                          {locale === "zh-CN" ? "通过发布" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewAction(item.id, "draft")}
                          className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 text-xs font-semibold"
                        >
                          {locale === "zh-CN" ? "驳回草稿" : "Reject"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "merge" && (
            <div className="space-y-6">
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h2 className="text-base font-semibold text-white mb-1">
                  {locale === "zh-CN" ? "实体合并 (Entity Merge)" : "Entity Merge"}
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {locale === "zh-CN"
                    ? "将重复建档的源实体合并至目标权威实体。合并后源实体将重定向 (redirect_id) 至目标实体，历史修订与反向收录全部完整保留，满足 ACID 审计合规。"
                    : "Merge duplicate source entity into target authority entity. Redirects source to target, preserving audit trail."}
                </p>
              </div>

              <form onSubmit={handleMergeSubmit} className="p-5 rounded-xl bg-black/20 border border-white/[0.06] space-y-4 max-w-xl">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    {locale === "zh-CN" ? "源实体 UUID (将被重定向)" : "Source Entity UUID"}
                  </label>
                  <input
                    type="text"
                    required
                    value={mergeSource}
                    onChange={(e) => setMergeSource(e.target.value)}
                    placeholder="e.g. 5d1211ef-afe5-46fb-bfcb-706d84cebaec"
                    className="w-full p-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-mono text-white placeholder:text-gray-600 focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    {locale === "zh-CN" ? "目标实体 UUID (权威留存实体)" : "Target Entity UUID"}
                  </label>
                  <input
                    type="text"
                    required
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                    placeholder="e.g. ea8c8cd1-c75b-4919-9f02-b61e9a082b44"
                    className="w-full p-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-mono text-white placeholder:text-gray-600 focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    {locale === "zh-CN" ? "合并说明 (Edit Note)" : "Merge Note"}
                  </label>
                  <textarea
                    rows={2}
                    value={mergeNote}
                    onChange={(e) => setMergeNote(e.target.value)}
                    placeholder={locale === "zh-CN" ? "注明合并原因，如重复条目收敛..." : "Reason for merge..."}
                    className="w-full p-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-gray-600 focus:border-primary outline-none"
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
                  {merging ? (locale === "zh-CN" ? "正在执行合并..." : "Merging...") : (locale === "zh-CN" ? "确认执行合并" : "Execute Merge")}
                </button>
              </form>
            </div>
          )}

          {activeTab === "modules" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {locale === "zh-CN" ? "外围解耦模块拓扑与启停" : "Peripheral Modules Governance"}
                  </h2>
                  <p className="text-xs text-gray-400">
                    {locale === "zh-CN" ? "按需启用外围服务；核心元数据即使在所有模块停用时亦能 100% 独立运行" : "Core operates 100% standalone"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadOverview}
                  className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-gray-300"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {modules.map((mod) => (
                  <div
                    key={mod.id}
                    className="p-4 rounded-xl border border-white/[0.06] bg-black/20 flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm font-mono">{mod.id}</span>
                        <span className="text-[10px] text-gray-500 font-mono">v{mod.version}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`w-2 h-2 rounded-full ${mod.enabled ? "bg-emerald-400" : "bg-gray-600"}`} />
                        <span className="text-gray-400 font-mono text-[11px]">
                          {mod.enabled ? (locale === "zh-CN" ? "已激活启用" : "Active") : (locale === "zh-CN" ? "已独立停用" : "Disabled")}
                        </span>
                      </div>
                      {Object.keys(mod.dependencies || {}).length > 0 && (
                        <div className="text-[10px] text-gray-500 font-mono pt-1">
                          Deps: {JSON.stringify(mod.dependencies)}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={loadingModules}
                      onClick={() => handleToggleModule(mod.id, mod.enabled)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        mod.enabled
                          ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400"
                          : "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
                      }`}
                    >
                      {mod.enabled ? (locale === "zh-CN" ? "停用模块" : "Disable") : (locale === "zh-CN" ? "启用模块" : "Enable")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "users" && (
            <div className="space-y-6">
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h2 className="text-base font-semibold text-white mb-1">
                  {locale === "zh-CN" ? "用户与权限分配" : "User Roles & Permissions"}
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {locale === "zh-CN"
                    ? "元数据核心采用轻量 RBAC：admin 具备全局定义与审核权限，editor 具备条目编目与修订权限。"
                    : "Role-based access: admin has schema/audit control, editor can edit and propose revisions."}
                </p>
              </div>

              <form onSubmit={handleCreateUser} className="p-5 rounded-xl bg-black/20 border border-white/[0.06] space-y-4 max-w-md">
                <h3 className="font-semibold text-white text-xs">
                  {locale === "zh-CN" ? "添加编目成员账号" : "Create Editor Account"}
                </h3>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    {locale === "zh-CN" ? "用户名" : "Username"}
                  </label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g. curator_01"
                    className="w-full p-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-gray-600 focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    {locale === "zh-CN" ? "初始密码" : "Password"}
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full p-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-gray-600 focus:border-primary outline-none"
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
                  {creatingUser ? (locale === "zh-CN" ? "正在创建..." : "Creating...") : (locale === "zh-CN" ? "创建账号" : "Create User")}
                </button>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background text-gray-500 font-mono text-xs grid place-items-center">Loading Admin...</div>}>
      <AdminInner />
    </Suspense>
  );
}
