"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { DefinitionsEditor } from "@/components/catalog-v2/DefinitionsEditor";
import { CatalogProvider } from "@/components/catalog-v2/CatalogProvider";
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
} from "lucide-react";

type AdminTab = "overview" | "definitions" | "reviews" | "merge" | "modules" | "users";

function AdminInner() {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [stats, setStats] = useState({
    pending: 0,
  });
  const [modules, setModules] = useState<any[]>([]);
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);

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
    fetch("/api/v2/catalog/entities?status=pending_review", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        setPendingItems(d.items || []);
        setStats({ pending: d.items?.length || 0 });
      })
      .catch(() => {});

    fetch("/api/v2/capabilities", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { modules: [] }))
      .then((d) => setModules(d.modules || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleReviewAction = async (id: string, action: "published" | "draft") => {
    try {
      const res = await fetch(`/api/v2/catalog/entities/${id}/lifecycle`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
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
      const res = await fetch(`/api/v2/admin/modules/${modId}`, {
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
      const res = await fetch("/api/v2/admin/merge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: mergeSource.trim(),
          target_id: mergeTarget.trim(),
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
      const res = await fetch("/api/v2/admin/users", {
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
          href="/catalog/account"
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-medium"
        >
          {locale === "zh-CN" ? "前往账号中心登录" : "Go to Login"}
        </Link>
      </div>
    );
  }

  const navTabs = [
    { id: "overview", labelZh: "控制台概览", labelEn: "Overview", icon: LayoutDashboard },
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
            {navTabs.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as AdminTab)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium text-left transition-all whitespace-nowrap cursor-pointer ${
                    active
                      ? "bg-primary text-white border border-primary font-semibold shadow-xs"
                      : "bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] text-gray-400 hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{locale === "zh-CN" ? t.labelZh : t.labelEn}</span>
                  {t.id === "reviews" && stats.pending > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-black text-[10px] font-bold">
                      {stats.pending}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right Main Content */}
        <main className="flex-1 min-w-0">
          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h2 className="text-base font-semibold text-white mb-2">
                  {locale === "zh-CN" ? "系统架构与运行概况" : "System Status Overview"}
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {locale === "zh-CN"
                    ? "当前系统运行在 MetaFusion v2 模块化单体架构之上。核心元数据基于 PostgreSQL 稳定运转；动态类型、属性、关系与模板完全由后台定义驱动。"
                    : "The platform runs on MetaFusion v2 modular monolith. PostgreSQL powers the pure metadata core, with dynamic definitions driving types, relations, and templates."}
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

              {/* Quick Jump Links */}
              <div className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <h3 className="text-sm font-semibold text-white mb-3">
                  {locale === "zh-CN" ? "快速操作通道" : "Quick Operations"}
                </h3>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab("definitions")}
                    className="px-3.5 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs text-white cursor-pointer"
                  >
                    {locale === "zh-CN" ? "编辑元数据定义 (Types & Relations) →" : "Edit Definitions →"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("reviews")}
                    className="px-3.5 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs text-white cursor-pointer"
                  >
                    {locale === "zh-CN" ? "进入审核工作台 →" : "Open Review Workbench →"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("modules")}
                    className="px-3.5 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs text-white cursor-pointer"
                  >
                    {locale === "zh-CN" ? "管理外围能力启停 →" : "Manage Capabilities →"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DEFINITIONS DESIGNER */}
          {activeTab === "definitions" && (
            <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="mb-4 pb-4 border-b border-white/[0.06]">
                <h2 className="text-lg font-bold text-white">
                  {locale === "zh-CN" ? "动态元数据定义设计器" : "Dynamic Definitions Designer"}
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  {locale === "zh-CN"
                    ? "可视化维护多类型、语义关系（支持上下文）、属性字段组、受控词表及展示模板。支持版本化草稿、全量数据冲突影响分析与平滑发布。"
                    : "GUI configuration for types, contextual relations, attribute groups, vocabularies, and templates. Includes draft impact analysis."}
                </p>
              </div>

              {/* Embed Definitions Editor inside CatalogProvider */}
              <div className="catalog-admin-wrapper">
                <CatalogProvider>
                  <DefinitionsEditor />
                </CatalogProvider>
              </div>
            </div>
          )}

          {/* TAB 3: REVIEWS */}
          {activeTab === "reviews" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    {locale === "zh-CN" ? "编目审核工作台" : "Editorial Review Workbench"}
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    {locale === "zh-CN"
                      ? "审批来自编目员和创作者提交的未公开草稿，核验编辑说明与来源"
                      : "Approve or reject submissions pending editorial review"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadOverview}
                  className="p-2 rounded-lg border border-white/10 text-gray-400 hover:text-white cursor-pointer"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {pendingItems.length === 0 ? (
                <div className="py-16 text-center rounded-xl border border-dashed border-white/10 text-gray-500 font-mono text-xs">
                  {locale === "zh-CN" ? "当前没有待审核的条目提交。" : "No pending submissions to review."}
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06] border border-white/10 rounded-xl bg-white/[0.01] overflow-hidden">
                  {pendingItems.map((item) => (
                    <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-mono uppercase">
                            {item.kind}
                          </span>
                          <h3 className="font-semibold text-white text-sm">{item.title}</h3>
                          <span className="text-xs font-mono text-gray-500">ID: {item.id.slice(0, 8)}...</span>
                        </div>
                        <div className="text-xs text-gray-400 font-mono">
                          {item.types?.join(", ") || "No types assigned"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/catalog/${item.id}`}
                          className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-gray-300 hover:text-white"
                        >
                          {locale === "zh-CN" ? "审查详情" : "Inspect"}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleReviewAction(item.id, "published")}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer"
                        >
                          {locale === "zh-CN" ? "批准发布" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewAction(item.id, "draft")}
                          className="px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-medium cursor-pointer"
                        >
                          {locale === "zh-CN" ? "退回草稿" : "Reject"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: MERGE */}
          {activeTab === "merge" && (
            <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06] max-w-2xl">
              <h2 className="text-lg font-bold text-white mb-2">
                {locale === "zh-CN" ? "实体合并与版本管理" : "Entity Merge & Lifecycle"}
              </h2>
              <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                {locale === "zh-CN"
                  ? "合并同类型的重复实体。源实体的收录位置、关系、表达引用与动态属性将自动重定向并写入目标实体，并保留完整的原子修订审计日志。"
                  : "Atomically merge duplicate entities of the same kind. Rewrites references and records an audit log."}
              </p>

              <form onSubmit={handleMergeSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">
                    {locale === "zh-CN" ? "源实体 UUID (Source ID - 将被合并并重定向)" : "Source Entity UUID"}
                  </label>
                  <input
                    type="text"
                    required
                    value={mergeSource}
                    onChange={(e) => setMergeSource(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-mono text-white outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">
                    {locale === "zh-CN" ? "目标保留实体 UUID (Target ID - 保留的主体)" : "Target Entity UUID"}
                  </label>
                  <input
                    type="text"
                    required
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-mono text-white outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">
                    {locale === "zh-CN" ? "合并原因与证据说明 (Edit Note)" : "Edit Note"}
                  </label>
                  <input
                    type="text"
                    required
                    value={mergeNote}
                    onChange={(e) => setMergeNote(e.target.value)}
                    placeholder={locale === "zh-CN" ? "例：合并重复创建的同张专辑条目" : "e.g., Merging duplicated entries"}
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white outline-none focus:border-primary"
                  />
                </div>

                {mergeMessage && (
                  <div
                    className={`p-3 rounded-lg text-xs font-mono ${
                      mergeMessage.startsWith("Error") ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"
                    }`}
                  >
                    {mergeMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={merging}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-2 cursor-pointer"
                >
                  <GitMerge className="w-4 h-4" />
                  <span>{merging ? "Merging..." : locale === "zh-CN" ? "执行原子合并" : "Perform Merge"}</span>
                </button>
              </form>
            </div>
          )}

          {/* TAB 5: MODULES */}
          {activeTab === "modules" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white">
                  {locale === "zh-CN" ? "外围模块与能力启停" : "Peripheral Capabilities Management"}
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  {locale === "zh-CN"
                    ? "模块按 Semver 与 DAG 依赖编排，外围故障绝不拖垮核心元数据。支持在线级联启用或停用。"
                    : "Manage decoupled modules safely with Semver and DAG cascade protection."}
                </p>
              </div>

              <div className="divide-y divide-white/[0.06] border border-white/10 rounded-xl bg-white/[0.01] overflow-hidden">
                {modules.map((m) => (
                  <div key={m.id} className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-white text-sm font-mono">{m.id}</span>
                        <span className="text-[11px] font-mono text-gray-500">v{m.version || "2.0.0"}</span>
                        {m.healthy ? (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">
                            HEALTHY
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-400 text-[10px] font-mono">
                            UNHEALTHY
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">
                        {m.id === "archive" && (locale === "zh-CN" ? "物理文件归档与下载存储（CAS / S3）" : "File archive & CAS storage")}
                        {m.id === "playback" && (locale === "zh-CN" ? "音频/视频在线流媒体播放与预览服务" : "Streaming playback & media previews")}
                        {m.id === "media" && (locale === "zh-CN" ? "异步媒体技术分析（ffprobe、MP4 转码）" : "Asynchronous ffprobe & transcoding")}
                        {m.id === "community" && (locale === "zh-CN" ? "条目评论与社群讨论板块" : "Discussion posts & community comments")}
                        {m.id === "records" && (locale === "zh-CN" ? "用户个人收藏、评分、阅读与收听进度" : "Favorites, ratings, and progress tracking")}
                        {m.id === "exchange" && (locale === "zh-CN" ? "元数据 JSON 导入导出与提案流水线" : "Metadata JSON import/export pipeline")}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={loadingModules}
                      onClick={() => handleToggleModule(m.id, m.enabled)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                        m.enabled
                          ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30"
                          : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{m.enabled ? (locale === "zh-CN" ? "停用模块" : "Disable") : (locale === "zh-CN" ? "启用模块" : "Enable")}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: USERS */}
          {activeTab === "users" && (
            <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06] max-w-2xl">
              <h2 className="text-lg font-bold text-white mb-2">
                {locale === "zh-CN" ? "用户与角色权限" : "Users & Access Control"}
              </h2>
              <p className="text-xs text-gray-400 mb-6">
                {locale === "zh-CN"
                  ? "管理已注册账号及其角色权限 (Admin, Editor, User)。"
                  : "Provision accounts and manage RBAC roles."}
              </p>

              <form onSubmit={handleCreateUser} className="space-y-4">
                <h3 className="text-sm font-semibold text-white">
                  {locale === "zh-CN" ? "创建新编目员账号" : "Create Editor Account"}
                </h3>

                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">
                    {locale === "zh-CN" ? "用户名" : "Username"}
                  </label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="editor_user"
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-gray-400 mb-1">
                    {locale === "zh-CN" ? "初始密码 (最少 12 位)" : "Initial Password (min 12 chars)"}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={12}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white outline-none focus:border-primary"
                  />
                </div>

                {userActionMsg && (
                  <div
                    className={`p-3 rounded-lg text-xs font-mono ${
                      userActionMsg.startsWith("Error") ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"
                    }`}
                  >
                    {userActionMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={creatingUser}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                >
                  {creatingUser ? "Creating..." : locale === "zh-CN" ? "创建编目账号" : "Create Account"}
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
    <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center text-xs font-mono text-gray-500">Loading...</div>}>
      <AdminInner />
    </Suspense>
  );
}
