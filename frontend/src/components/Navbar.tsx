"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemePicker } from "./ThemePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "./Logo";
import { UserAvatar } from "./UserAvatar";
import { displayNameOf, fetchUnreadMessageCount, fetchUnreadCount, NOTIFICATIONS_CHANGED_EVENT } from "@/lib/api";
import { UserRoleBadge } from "@/lib/roles";
import { canEnterAdmin } from "@/lib/permissions";
import { getAuthLoginUrl, getAuthUsersAdminUrl, STORAGE_SERVICE_URL, hasResourceStation } from "@/lib/services";
import { PageContainer } from "@/components/ui/PageShell";
import {
  Bell,
  Plus,
  LogOut,
  User as UserIcon,
  Shield,
  Settings,
  ChevronDown,
  Library,
  Compass,
  BookOpen,
  GitCompare,
  DownloadCloud,
  MessageSquare,
  Sparkles,
  Terminal,
  Mail,
} from "lucide-react";

/**
 * 导航项的 active 判定：桌面顶栏与移动行共用这一份，避免两处漂移
 * （移动行曾用 pathname === href，桌面用 startsWith，于是 /community/<id>、
 * 实体详情这类子路径在移动端一个页签都不高亮）。
 * external 项不属于本应用路由（文档站前缀、外站资源站），不参与判定。
 */
// 顶栏角标的最短刷新间隔：可见性切换/其它触发都受它限制，杜绝高频轮询。
const NOTIFICATION_BADGE_MIN_INTERVAL_MS = 60000;

function isNavLinkActive(
  pathname: string,
  tab: { href: string; exact?: boolean; external?: boolean },
): boolean {
  if (tab.external) return false;
  return tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
}

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { t, locale } = useI18n();
  const pathname = usePathname();

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  // 未读私信角标：登录后拉一次 + 每 30s 一次。失败一律隐藏角标（null），**不渲染成 0**——
  // "取不到"与"没有未读"必须能区分；失败也不影响导航其余部分。
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  // 未读站内通知角标：与私信不同，这条**不轮询**——挂载后取一次、页面重新可见时取一次
  // （最短间隔见 NOTIFICATION_BADGE_MIN_INTERVAL_MS），通知页改完已读会广播事件让它立刻跟一次。
  // 失败一律静默且保留旧值（null = 不显示角标），"取不到"不画成 0，也不弄脏顶栏。
  const [unreadNotifications, setUnreadNotifications] = useState<number | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  // 顶栏实际高度随断点变化：<xl 时顶栏里还多一行移动导航，写死在 CSS 里必然对不上。
  // 这里把实测高度写进 --mf-header-h，吸顶元素（管理台内栏、社区工具条、首页筛选条）
  // 才不会被顶栏压住；globals.css 保留同口径静态值，供无 Navbar 的页面与首帧使用。
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--mf-header-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--mf-header-h");
    };
  }, []);
  // 账号管理台（/admin/account/）是账号服务自带的独立应用：按目录管理台同一约定探活
  // （2.5s AbortController 超时、cache: no-store、只认 HTTP 200）。探不到就不渲染入口——
  // 本机开发与元数据-only 部署都没有这条网关 location，留着就是一个必 404 的死链。
  const [authConsoleOnline, setAuthConsoleOnline] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") {
      setAuthConsoleOnline(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    let alive = true;
    fetch(`${getAuthUsersAdminUrl()}api/health`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((res) => {
        if (alive) setAuthConsoleOnline(res.ok);
      })
      .catch(() => {
        if (alive) setAuthConsoleOnline(false);
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      alive = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(null);
      return;
    }
    let alive = true;
    const load = () => {
      fetchUnreadMessageCount()
        .then((n) => {
          if (alive) setUnreadCount(n);
        })
        .catch(() => {
          if (alive) setUnreadCount(null);
        });
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user]);

  // 打开用户菜单时顺手刷新一次：下拉里的角标不该停在最多 30 秒前的旧值。
  useEffect(() => {
    if (!user || !isUserMenuOpen) return;
    let alive = true;
    fetchUnreadMessageCount()
      .then((n) => {
        if (alive) setUnreadCount(n);
      })
      .catch(() => {
        if (alive) setUnreadCount(null);
      });
    return () => {
      alive = false;
    };
  }, [user, isUserMenuOpen]);

  useEffect(() => {
    if (!user) {
      setUnreadNotifications(null);
      return;
    }
    let alive = true;
    let lastFetchedAt = 0;
    const load = (force: boolean) => {
      // 成功才记时间戳：失败不占这个窗口，下一次可见/变更时还能立刻再试一次。
      if (!force && Date.now() - lastFetchedAt < NOTIFICATION_BADGE_MIN_INTERVAL_MS) return;
      fetchUnreadCount()
        .then((n) => {
          if (!alive) return;
          lastFetchedAt = Date.now();
          setUnreadNotifications(n);
        })
        .catch(() => {
          /* 静默：角标接口挂了不影响顶栏渲染，也不弹错 */
        });
    };
    load(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") load(false);
    };
    // 通知页标记已读后广播：这是明确的用户动作，不受最短间隔限制。
    const onNotificationsChanged = () => load(true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onNotificationsChanged);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onNotificationsChanged);
    };
  }, [user]);

  const navLinks = [
    { href: "/", label: t("navigation.home"), icon: Library, exact: true },
    { href: "/explore", label: t("navigation.explore"), icon: Compass },
    { href: "/community", label: t("navigation.community"), icon: MessageSquare },
    // 资源站未接入时不展示入口，避免死链。
    ...(hasResourceStation()
      ? [{ href: STORAGE_SERVICE_URL, label: t("navigation.resources"), icon: DownloadCloud, external: true }]
      : []),
    { href: "/compare", label: t("catalog.compare"), icon: GitCompare },
    { href: "/docs/catalog", label: t("navigation.docs"), icon: BookOpen, external: true },
  ];

  return (
    <header ref={headerRef} className="sticky top-0 z-40 w-full border-b border-line-subtle bg-surface/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/85">
      <PageContainer className="h-14 sm:h-15 flex items-center justify-between gap-3">
        {/* Left Brand + Navigation */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* 品牌名 span 在 <640px 被隐藏，只剩 26×26 的图形：title 只是兜底名，
              显式 aria-label 才是稳定可访问名（屏幕阅读器与自动化都以它为准）。 */}
          <Link href="/landing" aria-label={t("navbar.about")} title={t("navbar.about")} className="flex items-center gap-2.5 shrink-0 group">
            <BrandMark size={26} withGlow={false} idSuffix="nav" />
            <span className="hidden sm:flex flex-col leading-none">
              <span className="font-display text-[20px] leading-none tracking-[-0.03em] text-emphasis group-hover:text-primary transition-colors duration-fast ease-soft">
                MetaFusion
              </span>
              <span className="hidden sm:inline font-mono text-[7px] tracking-[0.16em] text-text-faint leading-none mt-[3px]">
                CATALOG
              </span>
            </span>
          </Link>

          <nav className="hidden xl:flex items-center gap-1.5 ml-2">
            {navLinks.map((tab) => {
              const Icon = tab.icon;
              const active = isNavLinkActive(pathname, tab);
              const className = `relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                active
                  ? "text-primary bg-primary/10 border border-primary/25 font-semibold shadow-xs"
                  : "text-text-muted hover:text-emphasis hover:bg-surfaceHover"
              }`;

              if (tab.external) {
                return (
                  <a key={tab.href} href={tab.href} className={className}>
                    <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                    <span>{tab.label}</span>
                  </a>
                );
              }
              return (
                <Link key={tab.href} href={tab.href} className={className}>
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                  <span>{tab.label}</span>
                </Link>
              );
            })}

            {/* 开发者中心：任何登录账号都能自助登记自己的应用（见 metafusion-auth 的
                /api/developer/*），因此不像管理台那样受权限码限制；未登录时不提供入口。 */}
            {user && (
              <Link
                href="/developer"
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium tracking-wide transition-all ${
                  pathname.startsWith("/developer")
                    ? "text-primary bg-primary/10 border border-primary/25 font-semibold"
                    : "text-text-muted hover:text-primary hover:bg-primary/5"
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>{t("navigation.developer")}</span>
              </Link>
            )}

            {user && canEnterAdmin(user) && (
              <Link
                href="/admin"
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium tracking-wide transition-all ${
                  pathname.startsWith("/admin")
                    ? "text-danger bg-rose-500/10 border border-rose-500/25 font-semibold"
                    : "text-danger/80 hover:text-danger hover:bg-rose-500/5"
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>{t("navbar.admin")}</span>
              </Link>
            )}
          </nav>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* 新建：指向 /new；那边不带 ?kind= 时会落到编目枢纽（/contribute）先选手动创建
              或外部权威库导入，带 ?kind= 才直接进编辑器。入口不预设层级，也不枚举层级清单。
              标签 span 带 hidden sm:inline，窄屏只剩加号图标，因此必须显式给可访问名。 */}
          {/* 站内通知：常驻铃铛入口（未登录不显示），未读 >0 才挂角标，>99 显示 99+。
              放在右侧控件区而不是 hidden xl:flex 的桌面导航里，窄屏同样看得见。 */}
          {user && (
            <Link
              href="/notifications"
              aria-label={
                unreadNotifications !== null && unreadNotifications > 0
                  ? t("notifications.unreadBadge", { count: unreadNotifications })
                  : t("navigation.notifications")
              }
              title={t("navigation.notifications")}
              className={`relative inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors duration-fast ease-soft ${
                pathname.startsWith("/notifications")
                  ? "bg-primary/10 border-primary/25 text-primary"
                  : "bg-emphasis/[0.04] border-line text-text-strong hover:bg-emphasis/[0.08]"
              }`}
            >
              <Bell className="w-3.5 h-3.5" strokeWidth={1.8} />
              {unreadNotifications !== null && unreadNotifications > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[9px] font-mono font-bold flex items-center justify-center"
                  title={t("notifications.unreadBadge", { count: unreadNotifications })}
                >
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              )}
            </Link>
          )}

          <Link
              href="/new"
            aria-label={t("catalog.create")}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/30 text-xs font-medium text-primary hover:text-emphasis transition-all shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">{t("catalog.create")}</span>
            </Link>

          {/* 私信：与站内通知并列的**独立**入口（各自一枚角标，不合成汇总——合成要跨服务聚合，
              为一个角标给顶栏引入新的可失败依赖不划算）。图标语义必须一眼可辨：
              铃铛 = 站内通知、信封 = 私信；两者各有 aria-label（含未读数时念出条数）。 */}
          {user && (
            <Link
              href="/messages"
              aria-label={
                unreadCount !== null && unreadCount > 0
                  ? t("messages.unreadLabel", { n: unreadCount })
                  : t("messages.title")
              }
              title={t("messages.title")}
              className={`relative inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors duration-fast ease-soft ${
                pathname.startsWith("/messages")
                  ? "bg-primary/10 border-primary/25 text-primary"
                  : "bg-emphasis/[0.04] border-line text-text-strong hover:bg-emphasis/[0.08]"
              }`}
            >
              <Mail className="w-3.5 h-3.5" strokeWidth={1.8} />
              {unreadCount !== null && unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger/15 border border-danger/30 text-danger-soft text-[10px] font-bold flex items-center justify-center"
                  title={t("messages.unreadLabel", { n: unreadCount })}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          )}

          {/* User Profile / Login */}
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="relative flex items-center gap-2 pl-1.5 pr-2.5 h-9 rounded-lg bg-emphasis/[0.04] hover:bg-emphasis/[0.08] border border-line text-xs text-text-strong transition-colors duration-fast ease-soft cursor-pointer"
              >
                {/* 未读私信角标改挂在顶栏信封入口上（见上）：同一个计数在顶栏只出现一次，
                    头像按钮回归"纯菜单开关"，不再承担未读提示。 */}
                <UserAvatar user={user} size="sm" shape="rounded" />
                <span className="font-medium max-w-[90px] truncate hidden sm:inline text-xs">
                  {displayNameOf(user as unknown as { username: string; display_name?: string })}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-text-muted transition-transform duration-200 ${
                    isUserMenuOpen ? "rotate-180" : ""
                  }`}
                  strokeWidth={1.5}
                />
              </button>

              {isUserMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 mt-2 w-56 rounded-xl border border-line bg-surface shadow-elevated py-1.5 z-50 animate-slide-up text-xs"
                >
                  <div className="px-3.5 py-2.5 border-b border-line-subtle flex items-center gap-2.5">
                    <UserAvatar user={user} size="md" shape="rounded" ring />
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="font-semibold text-emphasis truncate">
                        {displayNameOf(user as unknown as { username: string; display_name?: string })}
                      </div>
                      <div className="text-[10px] text-text-faint font-mono truncate">@{user.username}</div>
                      <div className="pt-0.5">
                        <UserRoleBadge role={user.role} t={t} showIcon />
                      </div>
                    </div>
                  </div>

                  <div className="py-1">
                    <Link
                      href={`/users/${user.id}`}
                      onClick={() => setIsUserMenuOpen(false)}
                      className="w-full px-3 py-2 text-left text-text-body hover:text-emphasis hover:bg-surfaceHover flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                      <span>{t("navbar.userCenter")}</span>
                    </Link>
                    <Link
                      href="/settings"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="w-full px-3 py-2 text-left text-text-body hover:text-emphasis hover:bg-surfaceHover flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                    >
                      <Settings className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                      <span>{t("navbar.userSettings")}</span>
                    </Link>

                    {/* 私信收件箱：用户菜单在所有断点都可见，窄屏与桌面共用这一条入口。 */}
                    <Link
                      href="/messages"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="w-full px-3 py-2 text-left text-text-body hover:text-emphasis hover:bg-surfaceHover flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                    >
                      <Mail className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                      <span>{t("messages.title")}</span>
                      {unreadCount !== null && unreadCount > 0 && (
                        <span
                          className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-danger/15 border border-danger/30 text-danger-soft text-[10px] font-bold flex items-center justify-center"
                          title={t("messages.unreadLabel", { n: unreadCount })}
                        >
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </Link>

                    {/* 开发者中心：桌面顶栏那条入口在 hidden xl:flex 里，<xl 视口（移动端/平板）
                        看不到，这里补同一个入口；可见性用 xl:hidden 与桌面导航配对，避免桌面重复。
                        规则一致：登录即可自助登记应用，未登录不显示——本菜单只在 user 存在时渲染。 */}
                    <Link
                      href="/developer"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="xl:hidden w-full px-3 py-2 text-left text-text-body hover:text-emphasis hover:bg-surfaceHover flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                    >
                      <Terminal className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                      <span>{t("navigation.developer")}</span>
                    </Link>

                    {user.role === "admin" && (
                      <Link
                        href="/admin"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="w-full px-3 py-2 text-left text-danger hover:text-danger-soft hover:bg-rose-500/10 flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                      >
                        <Shield className="w-3.5 h-3.5" strokeWidth={1.7} />
                        <span>{t("navbar.adminConsole")}</span>
                      </Link>
                    )}
                    {/* 账号管理台是另一个应用：上面的探活不通过就不渲染，避免死链 */}
                    {user.role === "admin" && authConsoleOnline && (
                      <a
                        href={getAuthUsersAdminUrl()}
                        onClick={() => setIsUserMenuOpen(false)}
                        className="w-full px-3 py-2 text-left text-warn hover:text-warn-soft hover:bg-amber-500/10 flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                      >
                        <Settings className="w-3.5 h-3.5" strokeWidth={1.7} />
                        <span>{t("navbar.userManagement")}</span>
                      </a>
                    )}
                  </div>

                  <div className="border-t border-line-subtle pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full px-3 py-2 text-left text-danger hover:bg-rose-500/10 flex items-center gap-2 transition-colors duration-fast ease-soft cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" strokeWidth={1.7} />
                      <span>{t("catalog.logout")}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <a
              href={getAuthLoginUrl()}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-emphasis/[0.04] hover:bg-emphasis/[0.08] border border-line text-xs font-medium text-text-strong transition-colors duration-fast ease-soft"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>{t("navbar.signIn")}</span>
            </a>
          )}

          {/* Controls: Theme & Locale */}
          <div className="flex items-center border-l border-line pl-2 gap-1.5">
            <LocaleSwitcher compact />
            <ThemePicker />
          </div>
        </div>
      </PageContainer>
      {/* 移动端横向导航：与主行共用 PageContainer，保证顶栏内容同一条左基线。 */}
      <PageContainer>
      <nav aria-label={t("navigation.label")} className="xl:hidden flex gap-1 overflow-x-auto pb-2">
        {navLinks.map((tab) => {
          const active = isNavLinkActive(pathname, tab);
          const className = `whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? "bg-primary/10 text-primary" : "text-text-muted"}`;
          // external 项必须走 <a>：/docs/catalog 与外站资源站不是本应用的路由，
          // next/link 会让 App Router 去取一条不存在的 RSC 载荷（与桌面分支同一处理）。
          if (tab.external) {
            return (
              <a key={tab.href} href={tab.href} className={className}>
                {tab.label}
              </a>
            );
          }
          return (
            <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} className={className}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      </PageContainer>
    </header>
  );
};
