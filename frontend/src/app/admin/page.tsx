"use client";

// 目录域管理台：只覆盖元数据目录自己的工作面（概览 / 条目 / 定义 / 外部来源 / 货架 / 审核 /
// 合并 / 子系统能力 / 实例交换）。账号、社区、存储三个域的管理台已是独立应用
// （deploy/nginx.conf 的 /admin/account|community|storage/ 三条 location），这里只留入口：
// 左栏底部的「其他控制台」，按权限码与探活结果收敛——未部署的域不出现死链。

import React, { useEffect, useState, Suspense } from "react";
import { LoadingFallback } from "@/components/common/LoadingFallback";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { DefinitionsEditor } from "@/components/catalog/DefinitionsEditor";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { useDefinitions, getKindName, getTypeName, resolveKindOptions } from "@/lib/definitions";
import { kinds as fallbackKinds } from "@/components/catalog/api";
import { PageContainer } from "@/components/ui/PageShell";
import { TabPanel } from "@/components/ui/TabPanel";
import { ExternalDatabasesTab } from "./components/tabs/ExternalDatabasesTab";
import { ShelvesTab } from "./components/tabs/ShelvesTab";
import { ExchangeTab } from "./components/tabs/ExchangeTab";
import {
  AUTH_GROUPS_MANAGE,
  AUTH_INVITES_MANAGE,
  AUTH_OAUTH_MANAGE,
  AUTH_SETTINGS_MANAGE,
  AUTH_USERS_MANAGE,
  COMMUNITY_BOARD_MANAGE,
  COMMUNITY_POST_MODERATE,
  COMMUNITY_TOPIC_PIN,
  STORAGE_ASSET_MODERATE,
  STORAGE_ASSET_UPLOAD,
  can,
  canEnterAdmin,
} from "@/lib/permissions";
import { fetchApi, unpublishEntity } from "@/lib/api";
import { localizeCatalogError } from "@/lib/catalogErrors";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import type { LucideIcon } from "lucide-react";
import {
  Shield,
  LayoutDashboard,
  Sliders,
  CheckSquare,
  GitMerge,
  Cpu,
  ArrowLeft,
  RefreshCw,
  Power,
  Layers,
  Search,
  Plus,
  ArrowUpRight,
  Trash2,
  Globe,
  HardDrive,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";

type AdminTab =
  | "overview"
  | "entities"
  | "definitions"
  | "reviews"
  | "merge"
  | "modules"
  | "extdb"
  | "shelves"
  | "exchange";

type ConsoleId = "account" | "community" | "storage";
type ConsoleState = "unknown" | "online" | "offline";

// 其他控制台：三个已拆出去的管理台的入口定义。
//   * permissions 与目标应用自己的入口判定同集合：账号域五码任一（metafusion-auth/admin
//     的 SECTION_PERMISSIONS）、社区治理三码任一（community 的 GOVERNANCE_CODES，不含
//     普通发帖码 community.post.create）、存储两码任一（storage-admin 的 STORAGE_PERMISSION_CODES）；
//   * href 带尾斜杠：nginx 对裸路径只回 301，直接用带尾斜杠的地址省一次跳转；
//   * target=_blank 见渲染处：点进去是另一个应用，不是本控制台的页签。
const OTHER_CONSOLES: {
  id: ConsoleId;
  href: string;
  labelKey: string;
  icon: LucideIcon;
  permissions: string[];
}[] = [
  {
    id: "account",
    href: "/admin/account/",
    labelKey: "admin.consoles.account",
    icon: ShieldCheck,
    permissions: [AUTH_USERS_MANAGE, AUTH_GROUPS_MANAGE, AUTH_INVITES_MANAGE, AUTH_SETTINGS_MANAGE, AUTH_OAUTH_MANAGE],
  },
  {
    id: "community",
    href: "/admin/community/",
    labelKey: "admin.consoles.community",
    icon: MessageSquare,
    permissions: [COMMUNITY_BOARD_MANAGE, COMMUNITY_POST_MODERATE, COMMUNITY_TOPIC_PIN],
  },
  {
    id: "storage",
    href: "/admin/storage/",
    labelKey: "admin.consoles.storage",
    icon: HardDrive,
    permissions: [STORAGE_ASSET_MODERATE, STORAGE_ASSET_UPLOAD],
  },
];

// 聚合计数的取值口径：只接受有限数字。字段缺失（端点没有这个键）、类型不对、
// 整个响应拿不到，都返回 null，调用方据此保留占位符——"取不到"与"真的是 0"必须分开。
const countOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function AdminInner() {
  const { user, loading: authLoading } = useAuth();
  const { t, tr, locale } = useI18n();
  const router = useRouter();

  const { definitions: defs, kinds } = useDefinitions();

  // 层级名与可选项：服务端 definitions.kinds 优先，服务端未给时退回内置骨架清单，
  // 字典只作名称兜底（缺键退原始码）。
  const kindLabel = (code: string) => getKindName(kinds, code, locale, tr(`catalog.kind.${code}`, code));
  const kindOptions = resolveKindOptions(kinds, fallbackKinds);

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  // 四个计数各为 null 表示"还没拿到或取不到"：卡片显示占位符，不把没取到的数当成 0 讲成事实。
  const [stats, setStats] = useState<{
    pending: number | null;
    published: number | null;
    tombstones: number | null;
    extDatabases: number | null;
  }>({ pending: null, published: null, tombstones: null, extDatabases: null });
  // 其他控制台的探活结果：unknown 表示还没探到——未知不等于在线，这时入口不渲染。
  const [consoles, setConsoles] = useState<Record<string, ConsoleState>>({});
  const [modules, setModules] = useState<any[]>([]);
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  // 审核台要能看的不只是待审：已发布条目下架（published → draft）是审核工作的一部分，
  // 而它只能走 POST /entities/:id/unpublish（保存端点拒绝降级）。所以列表按状态分档取数。
  const [reviewStatus, setReviewStatus] = useState<"pending_review" | "published">("pending_review");
  const [unpublishTarget, setUnpublishTarget] = useState<any | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);
  // 审核动作的反馈：原来用 alert()，既不本地化也打断操作
  const [reviewNotice, setReviewNotice] = useState("");
  // 取数失败必须与「没有待审条目」分开：管理员看到空列表会以为队列已清空（见 loadReviewList）。
  // 状态位此前只有写入没有声明，tsc 直接报 Cannot find name——先补上声明让构建可用；
  // 失败态在审核列表里的渲染分支仍待补（本轮不在我范围内）。
  const [reviewListFailed, setReviewListFailed] = useState(false);

  // Entities management state
  const [entitiesList, setEntitiesList] = useState<any[]>([]);
  const [entitiesListFailed, setEntitiesListFailed] = useState(false);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entitiesQ, setEntitiesQ] = useState("");
  const [entitiesKind, setEntitiesKind] = useState("all");
  const [entitiesStatus, setEntitiesStatus] = useState("all");

  // Merge form states
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeNote, setMergeNote] = useState("");
  const [mergeMessage, setMergeMessage] = useState("");
  // 合并结果的成功/失败由状态位决定配色：原先靠 "Error: " 前缀判定，等于把英文前缀写进流程。
  const [mergeError, setMergeError] = useState(false);
  const [merging, setMerging] = useState(false);

  const loadOverview = () => {
    // 目录域的三个计数（待审 / 已发布 / 墓碑）一次拿全：GET /catalog/entities/stats 是按状态分组的
    // 聚合。以前为两个数字发两次 limit=1 的列表请求，而墓碑数那条路走不通——列表端点固定排除
    // deleted/merged（后端 listFilter 的刻意口径），status=deleted 的列表恒空。
    // 非 2xx、网络失败、字段不是数字一律不写状态：卡片保持占位符，绝不把"取不到"显示成 0。
    fetch("/api/catalog/entities/stats", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const statuses = d?.statuses;
        if (!statuses || typeof statuses !== "object") return;
        const pending = countOrNull(statuses.pending_review);
        const published = countOrNull(statuses.published);
        // 墓碑 = deleted + merged：两个终态都不在列表里，任一项取不到就整张卡留占位符。
        const deleted = countOrNull(statuses.deleted);
        const merged = countOrNull(statuses.merged);
        setStats((prev) => {
          const next = { ...prev };
          if (pending != null) next.pending = pending;
          if (published != null) next.published = published;
          if (deleted != null && merged != null) next.tombstones = deleted + merged;
          return next;
        });
      })
      .catch(() => {});

    // 外部权威库启用数：GET /catalog/external-databases 只回启用项
    // （store.go ListExternalDatabases 的 enabledOnly=true），取到空数组就是 0 个启用，
    // 与"取不到"（留 null）分开——不拿空数组冒充失败，也不拿失败冒充 0。
    fetch("/api/catalog/external-databases", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.items)) {
          setStats((prev) => ({ ...prev, extDatabases: d.items.length }));
        }
      })
      .catch(() => {});

    // 能力清单是部署态声明（registry.go）：enabled 表示部署配置声明了该子系统在不在场。
    // 概览不再用它出卡片（那是部署态数字，不是目录域指标），但"子系统与能力"页签仍读它。
    fetch("/api/capabilities", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setModules(d.modules || []);
      })
      .catch(() => {});
  };

  const loadReviewList = () => {
    // 50 是服务端上限；审核台只呈现这一页，总数另由概览卡片给出，不在这里编造分页。
    // 取数失败必须与"没有待审条目"分开：管理员看到空列表会以为队列已清空。
    setReviewListFailed(false);
    fetch(`/api/catalog/entities?status=${reviewStatus}&limit=50`, { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setPendingItems(d.items || []))
      .catch(() => {
        setPendingItems([]);
        setReviewListFailed(true);
      });
  };

  const loadEntities = () => {
    setEntitiesLoading(true);
    const params = new URLSearchParams();
    if (entitiesKind !== "all") params.set("kind", entitiesKind);
    if (entitiesStatus !== "all") params.set("status", entitiesStatus);
    if (entitiesQ.trim()) params.set("q", entitiesQ.trim());
    params.set("limit", "50");

    setEntitiesListFailed(false);
    fetch(`/api/catalog/entities?${params.toString()}`, { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setEntitiesList(d.items || []))
      .catch(() => {
        setEntitiesList([]);
        setEntitiesListFailed(true);
      })
      .finally(() => setEntitiesLoading(false));
  };

  // 取数条件与进入管理台的闸门保持一致（canEnterAdmin，按权限码判定）：
  // 原来只认 role==="admin"，导致后台分配了管理权限组、但 role 仍是 user 的成员
  // 能进 /admin 却永远看不到概览与实体列表（空面板而非"无权限"，等于假象无数据）。
  const mayEnter = canEnterAdmin(user);

  // 各域管理台挂载时探活一次：2.5s 超时、no-store，只认 HTTP 200。
  // 三个应用的健康体并不一致（auth/storage 是 {"ok":true}，community 是 {"status":"ok"}），
  // 所以不能按字段判定，只看状态码；超时 / 404 / 网络失败一律当未部署，静默隐藏入口。
  // 主站本地开发下这三条路径没有代理，会稳定 404 —— 降级结果就是"看不到入口"，不是报错。
  useEffect(() => {
    if (!mayEnter) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    let alive = true;
    void Promise.all(
      OTHER_CONSOLES.map(async (item) => {
        try {
          const res = await fetch(`${item.href}api/health`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          });
          return [item.id, res.ok ? "online" : "offline"] as const;
        } catch {
          return [item.id, "offline"] as const;
        }
      }),
    )
      .then((entries) => {
        window.clearTimeout(timer);
        if (alive) setConsoles(Object.fromEntries(entries) as Record<ConsoleId, ConsoleState>);
      })
      .catch(() => {});
    return () => {
      alive = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mayEnter]);

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

  useEffect(() => {
    if (activeTab === "reviews" && mayEnter) {
      loadReviewList();
    }
  }, [activeTab, reviewStatus, mayEnter]);

  // 状态写入的唯一封装：PUT 是整份替换，必须先读全量再改状态（列表项是摘要，
  // 直接提交会因缺字段被服务端拒）；sources 的 kind 只能是 url / publication / self
  // （validation.go 的 validateSources）：管理台动作属于自述来源，用 "self" + 操作记录说明，
  // 不拿站点地址冒充外部证据。
  const submitEntityStatus = async (id: string, status: "published" | "draft", note: string) => {
    const full = await fetchApi<Record<string, any>>(`/catalog/entities/${id}`);
    const { updated_at: _updatedAt, ...doc } = full;
    await fetchApi(`/catalog/entities/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        entity: { ...doc, id, status },
        expected_version: full.version || 1,
        edit_note: note,
        sources: [{ kind: "self", citation: t("admin.reviews.sourceCitation") }],
      }),
    });
  };

  // 通过（草稿/待审 → 已发布）只能走保存端点：它是唯一能把状态写成 published 的写路径；
  // 生命周期端点 POST …/lifecycle 只做删除与合并（lifecycle.go 恒把状态置 deleted/merged）。
  // 反向的 published → draft 被 store.go 的 use_lifecycle_endpoint 拦住，只能走
  // POST …/unpublish（见 handleUnpublish）。
  const handleEntityPublish = async (id: string) => {
    setReviewNotice("");
    try {
      await submitEntityStatus(id, "published", t("admin.reviews.approveNote"));
      setReviewNotice(t("admin.reviews.approved"));
      loadEntities();
      loadOverview();
    } catch (e) {
      setReviewNotice(localizeCatalogError(String((e as Error).message || e), t));
    }
  };

  // 下架（published → draft）只能走 /unpublish：保存端点对 published 降级回
  // 400 use_lifecycle_endpoint，生命周期端点只写 deleted/merged。expected_version 用
  // 当前行的版本，服务端把它放进 WHERE 做乐观并发——别人先改过就是 409，不会覆盖掉。
  const handleUnpublish = async () => {
    if (!unpublishTarget) return;
    setUnpublishing(true);
    setReviewNotice("");
    try {
      await unpublishEntity({
        entity_id: unpublishTarget.id,
        expected_version: Number(unpublishTarget.version) || 1,
        edit_note: t("admin.reviews.unpublishNote"),
        citation: t("admin.reviews.sourceCitation"),
      });
      setReviewNotice(t("admin.reviews.unpublished"));
      setUnpublishTarget(null);
      loadReviewList();
      loadEntities();
      loadOverview();
    } catch (e) {
      // 下架有两种拒绝最值得单独讲清：状态已经变了（列表是旧的）与版本冲突（别人先改过）。
      // 其余错误码统一走码表，不把裸码渲染给用户。
      const raw = String((e as Error).message || e);
      const code = raw.trim().split(":")[0]?.trim();
      setReviewNotice(
        code === "invalid_status"
          ? t("admin.reviews.unpublishInvalidStatus")
          : code === "version_conflict"
            ? t("admin.reviews.unpublishVersionConflict")
            : localizeCatalogError(raw, t),
      );
    } finally {
      setUnpublishing(false);
    }
  };

  const handleReviewAction = async (id: string, action: "published" | "draft") => {
    setReviewNotice("");
    try {
      await submitEntityStatus(
        id,
        action,
        action === "published" ? t("admin.reviews.approveNote") : t("admin.reviews.rejectNote"),
      );
      setPendingItems((prev) => prev.filter((i) => i.id !== id));
      setReviewNotice(action === "published" ? t("admin.reviews.approved") : t("admin.reviews.rejected"));
    } catch (e) {
      setReviewNotice(localizeCatalogError(String((e as Error).message || e), t));
    }
  };

  // 这里刻意没有"启停"动作：运行时模块开关已随子系统拆分退役，
  // 能力是否可用由部署决定（服务在不在、配置没配置），后端 PUT /api/admin/modules/:id
  // 恒定返回 409 module_toggle_retired。面板只呈现事实，不提供会必然失败的按钮。

  const handleMergeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sourceId = mergeSource.trim();
    const targetId = mergeTarget.trim();
    setMerging(true);
    setMergeMessage("");
    setMergeError(false);
    try {
      // 前置校验与 lifecycle.go 的合并约束同一口径：源与目标要读得到、同 kind、
      // 同归属（作品/发行版/载体/父级/内容单元）、目标已发布、源不是已删除/已合并。
      // 少任何一条，服务端只会回 invalid_merge_target / invalid_status——先在本地讲清楚。
      const pair = await Promise.all([
        fetchApi<Record<string, any>>(`/catalog/entities/${sourceId}`),
        fetchApi<Record<string, any>>(`/catalog/entities/${targetId}`),
      ]).catch(() => null);
      if (!pair) {
        setMergeError(true);
        setMergeMessage(t("admin.console.mergeMissingEntity"));
        return;
      }
      const [source, target] = pair;
      if (source.status === "deleted" || source.status === "merged") {
        setMergeError(true);
        setMergeMessage(t("admin.console.mergeSourceRetired"));
        return;
      }
      const sameScope =
        source.kind === target.kind &&
        (source.work_id || "") === (target.work_id || "") &&
        (source.release_id || "") === (target.release_id || "") &&
        (source.medium_id || "") === (target.medium_id || "") &&
        (source.parent_id || "") === (target.parent_id || "") &&
        (source.content_unit_id || "") === (target.content_unit_id || "");
      // 自合并（源与目标同一条）服务端同样判 invalid_merge_target，先本地拦掉再讲清楚原因。
      if (sourceId === targetId || !sameScope || target.status !== "published") {
        setMergeError(true);
        setMergeMessage(t("admin.console.mergeInvalidTarget"));
        return;
      }
      await fetchApi(`/catalog/entities/${sourceId}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({
          target_id: targetId,
          // 版本取刚才读到的值：与 Lifecycle 的乐观并发同源，期间被人改过就如实报 version_conflict。
          expected_version: source.version || 1,
          // edit_note 与 sources 都是必填证据（validateSources）：说明留空时退回合并标题，
          // kind 只能是 url / publication / self，管理台动作用 "self" + 操作记录，不伪造外部 URL。
          edit_note: mergeNote.trim() || t("admin.console.mergeTitle"),
          sources: [{ kind: "self", citation: t("admin.reviews.sourceCitation") }],
        }),
      });
      setMergeMessage(t("admin.console.mergeSuccess"));
      setMergeSource("");
      setMergeTarget("");
      setMergeNote("");
    } catch (err) {
      setMergeError(true);
      setMergeMessage(localizeCatalogError(String((err as Error).message || err), t));
    } finally {
      setMerging(false);
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

  // 页签即管理台的全部工作面：进管理台的闸门是 canEnterAdmin，块内 403 各自降级，
  // 不在这里逐块加码。其余域（账号 / 社区 / 存储）已是独立应用，不在这里挂页签。
  const navTabs: { id: AdminTab; labelKey: string; icon: LucideIcon }[] = [
    { id: "overview", labelKey: "admin.tab.overview", icon: LayoutDashboard },
    { id: "entities", labelKey: "admin.nav.entities", icon: Layers },
    { id: "definitions", labelKey: "admin.tab.definitions", icon: Sliders },
    { id: "extdb", labelKey: "admin.tab.extdb", icon: Globe },
    { id: "shelves", labelKey: "admin.tab.shelves", icon: LayoutDashboard },
    { id: "reviews", labelKey: "admin.tab.reviews", icon: CheckSquare },
    { id: "merge", labelKey: "admin.tab.merge", icon: GitMerge },
    { id: "modules", labelKey: "admin.tab.modules", icon: Cpu },
    { id: "exchange", labelKey: "admin.tab.exchange", icon: ArrowUpRight },
  ];

  // 左栏入口 = 有该域管理码 且 探活到在线；探活没回来时一律不渲染，免得闪出一个点进去 404 的链接。
  const consoleEntries = OTHER_CONSOLES.filter(
    (item) => consoles[item.id] === "online" && item.permissions.some((code) => can(user, code)),
  );
  // 概览的状态条按权限（而不是在线）筛：要能讲"这个域你看得到但没部署"。
  // 探活结果与左栏入口同源，不重复请求。
  const permittedConsoles = OTHER_CONSOLES.filter((item) => item.permissions.some((code) => can(user, code)));
  const consoleProbeDone = permittedConsoles.every((item) => consoles[item.id] != null);

  return (
    // pt-[var(--mf-header-h)]：站点头部是 fixed/sticky 且不给内容留位（各页面自己补），
    // 少了这一档，下面这个 sticky topbar 会被顶到 y=60 并盖住其后 57px 内容——标题与左栏首项直接消失。
    <div className="min-h-screen flex flex-col bg-background text-text-strong pt-[var(--mf-header-h)]">
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
          {/* 粘附偏移必须含 topbar 自身高度（h-14=3.5rem）+ 上间距，否则左栏首项被 topbar 吃掉 */}
          <nav className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0 scrollbar-none sticky top-[calc(var(--mf-header-h)+5rem)]">
            {navTabs.map((tItem) => {
              const Icon = tItem.icon;
              const active = activeTab === tItem.id;
              return (
                <button
                  key={tItem.id}
                  type="button"
                  onClick={() => setActiveTab(tItem.id)}
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

          {/* 其他控制台：独立应用，故 target=_blank；探不到在线的域整条不出现（无死链）。 */}
          {consoleEntries.length > 0 && (
            <div className="mt-4 pt-3 border-t border-line-subtle">
              <div className="px-3 mb-1.5 text-[10px] font-mono uppercase tracking-wide text-text-faint">
                {t("admin.consoles.title")}
              </div>
              <div className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
                {consoleEntries.map((item) => {
                  const Icon = item.icon;
                  return (
                    <a
                      key={item.id}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium text-text-muted hover:text-text-strong hover:bg-surfaceHover transition-all whitespace-nowrap"
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{t(item.labelKey)}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-text-faint" />
                    </a>
                  );
                })}
              </div>
              <p className="px-3 mt-1 text-[10px] text-text-faint leading-relaxed">
                {t("admin.consoles.hint")}
              </p>
            </div>
          )}
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

              {/* 卡片只放目录域拿得到的真实数据，且标签与端点口径一致：数据库版本与会话模式没有
                  任何端点暴露，部署态能力数（/api/capabilities）不是目录域指标，都不出现在这里；
                  取不到显示占位符，不写死、不拿 0 冒充。 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t("admin.console.pendingReviews")}
                  </div>
                  <div className="text-2xl font-bold text-amber-400">{stats.pending ?? "—"}</div>
                </div>
                <div className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t("admin.console.publishedEntities")}
                  </div>
                  <div className="text-2xl font-bold text-emerald-400">{stats.published ?? "—"}</div>
                </div>
                {/* 墓碑 = deleted + merged，只来自 GET /catalog/entities/stats：列表端点的过滤固定带
                    status NOT IN ('deleted','merged')（backend/internal/catalog/store.go listFilter），
                    与 status=deleted 相与恒为空，所以这张卡不走列表端点。取不到仍是占位符，
                    不拿 0 冒充——线上同表 deleted 有 288 条，显示 0 就是假数据。 */}
                <div
                  className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle"
                  title={t("admin.console.tombstonesHint")}
                >
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t("admin.console.tombstones")}
                  </div>
                  <div className="text-2xl font-bold text-text-strong">{stats.tombstones ?? "—"}</div>
                  <div className="mt-1 text-[10px] text-text-faint leading-tight">
                    {t("admin.console.tombstonesHint")}
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-line-subtle bg-surfaceSubtle">
                  <div className="text-xs text-text-muted font-mono mb-1">
                    {t("admin.console.extDatabases")}
                  </div>
                  <div className="text-2xl font-bold text-text-strong">{stats.extDatabases ?? "—"}</div>
                </div>
              </div>

              {/* 其他控制台状态条：与左栏入口共用同一次探活，不重复请求；未部署的域在这里
                  如实标"未部署"，但左栏不给入口（状态条不是链接）。 */}
              {consoleProbeDone && permittedConsoles.length > 0 && (
                <div className="p-3 rounded-xl border border-line-subtle bg-surfaceSubtle flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-[11px] font-mono uppercase tracking-wide text-text-faint">
                    {t("admin.consoles.title")}
                  </span>
                  {permittedConsoles.map((item) => {
                    const online = consoles[item.id] === "online";
                    return (
                      <span key={item.id} className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-text-faint"}`} />
                        <span className={online ? "text-text-body" : "text-text-faint"}>
                          {t(item.labelKey)}
                        </span>
                        <span className="font-mono text-[10px] text-text-faint">
                          {online ? t("admin.console.active") : t("admin.console.disabled")}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
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
                    title={t("common.refresh")}
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

              {reviewNotice && (
                <div className="p-3 rounded-xl border border-primary/30 bg-primary/[0.08] text-xs text-text-body">
                  {reviewNotice}
                </div>
              )}

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
                    {kindOptions.map((k) => (
                      <option key={k} value={k}>{kindLabel(k)}</option>
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
              ) : entitiesListFailed ? (
                // 管理员最容易把"取数失败"读成"没有待审条目"：这一格必须说清是失败。
                <div role="alert" className="p-8 rounded-xl border border-amber-500/30 bg-amber-500/5 text-center text-xs space-y-2">
                  <p className="text-amber-700 dark:text-amber-300">{t("catalog.listFailed")}</p>
                  <button type="button" onClick={() => loadEntities()} className="font-mono text-primary hover:underline cursor-pointer">
                    {t("catalog.retry")}
                  </button>
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
                              {kindLabel(e.kind)}
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
                              {/* 只有草稿/待审能通过：保存端点拒绝写 deleted/merged，也拒绝
                                  published → draft（store.go 的 use_lifecycle_endpoint）；
                                  生命周期端点只做删除与合并。已发布条目改成走下架端点（见下），
                                  已删除/已合并连合并入口都不给。 */}
                              {(e.status === "draft" || e.status === "pending_review") && (
                                <button
                                  type="button"
                                  onClick={() => handleEntityPublish(e.id)}
                                  className="px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
                                >
                                  {t("admin.entities.approve")}
                                </button>
                              )}
                              {e.status === "published" && (
                                // 已发布条目现在有真正的降级入口（/unpublish），不再是禁用态：
                                // 调用前二次确认，确认框里说明这一步的影响面。
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReviewNotice("");
                                    setUnpublishTarget(e);
                                  }}
                                  className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
                                >
                                  {t("admin.entities.unpublish")}
                                </button>
                              )}
                              {e.status !== "deleted" && e.status !== "merged" && (
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
                              )}
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
                  onClick={() => {
                    loadReviewList();
                    loadOverview();
                  }}
                  className="p-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover text-xs text-text-body"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {/* 两个档位共用同一端点、不同 status 筛选：待审的入口是"通过/驳回"，
                  已发布的入口是"退回草稿"（只有 /unpublish 能降级）。 */}
              <div className="flex items-center gap-2">
                {(["pending_review", "published"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setReviewStatus(status)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-fast ease-soft cursor-pointer ${
                      reviewStatus === status
                        ? "bg-primary/20 text-primary"
                        : "bg-surfaceSubtle hover:bg-surfaceHover text-text-muted"
                    }`}
                  >
                    {status === "pending_review"
                      ? `${t("admin.reviews.pending")} (${stats.pending ?? "—"})`
                      : t("admin.reviews.published")}
                  </button>
                ))}
              </div>

              {reviewNotice && (
                <div className="p-3 rounded-xl border border-primary/30 bg-primary/[0.08] text-xs text-text-body">
                  {reviewNotice}
                </div>
              )}

              {reviewListFailed ? (
                // 与实体列表同因：取数失败会被读成"队列已清空"（loadReviewList 也刻意把失败与空列表分开）。
                <div role="alert" className="p-8 rounded-xl border border-amber-500/30 bg-amber-500/5 text-center text-xs space-y-2">
                  <p className="text-amber-700 dark:text-amber-300">{t("catalog.listFailed")}</p>
                  <button type="button" onClick={() => loadReviewList()} className="font-mono text-primary hover:underline cursor-pointer">
                    {t("catalog.retry")}
                  </button>
                </div>
              ) : pendingItems.length === 0 ? (
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
                        {/* 已发布条目不能"通过发布"（已经是发布态），也不该走保存端点降级：
                            唯一的出口是 /unpublish，所以两个档位的操作集合不同。 */}
                        {item.status === "published" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setReviewNotice("");
                              setUnpublishTarget(item);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-semibold cursor-pointer"
                          >
                            {t("admin.entities.unpublish")}
                          </button>
                        ) : (
                          <>
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
                          </>
                        )}
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
                    mergeError ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/20 text-emerald-400"
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
                  aria-label={t("common.refresh")}
                  className="p-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover text-xs text-text-body"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
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

          {activeTab === "exchange" && <ExchangeTab />}
          </div>
        </TabPanel>
      </PageContainer>

      {/* 实体行的"退回草稿"与审核台共用这个确认框：一次只可能有一个待确认目标。 */}
      <ConfirmDialog
        open={unpublishTarget != null}
        title={t("admin.entities.unpublish")}
        message={t("admin.entities.unpublishConfirm", {
          title: unpublishTarget?.title ?? "",
          version: String(unpublishTarget?.version ?? 1),
        })}
        confirmLabel={t("admin.entities.unpublish")}
        busy={unpublishing}
        onClose={() => setUnpublishTarget(null)}
        onConfirm={() => void handleUnpublish()}
      />
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<LoadingFallback className="min-h-screen bg-background text-text-faint font-mono text-xs grid place-items-center" />}>
      <AdminInner />
    </Suspense>
  );
}
