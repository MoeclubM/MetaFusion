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
import { displayNameOf } from "@/lib/api";
import { UserRoleBadge } from "@/lib/roles";
import { canEnterAdmin } from "@/lib/permissions";
import { getAuthLoginUrl, getAuthSettingsUrl, getAuthUsersAdminUrl, STORAGE_SERVICE_URL, hasResourceStation } from "@/lib/services";
import { PageContainer } from "@/components/ui/PageShell";
import {
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
} from "lucide-react";

/**
 * 导航项的 active 判定：桌面顶栏与移动行共用这一份，避免两处漂移
 * （移动行曾用 pathname === href，桌面用 startsWith，于是 /community/<id>、
 * 实体详情这类子路径在移动端一个页签都不高亮）。
 * external 项不属于本应用路由（文档站前缀、外站资源站），不参与判定。
 */
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
  const userMenuRef = useRef<HTMLDivElement>(null);
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
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-surface/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/85">
      <PageContainer className="h-14 sm:h-15 flex items-center justify-between gap-3">
        {/* Left Brand + Navigation */}
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/landing" title={t("navbar.about")} className="flex items-center gap-2.5 shrink-0 group">
            <BrandMark size={26} withGlow={false} idSuffix="nav" />
            <span className="hidden sm:flex flex-col leading-none">
              <span className="font-display text-[20px] leading-none tracking-[-0.03em] text-white group-hover:text-primary transition-colors duration-fast ease-soft">
                MetaFusion
              </span>
              <span className="hidden sm:inline font-mono text-[7px] tracking-[0.16em] text-white/30 leading-none mt-[3px]">
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
                  : "text-gray-400 hover:text-white hover:bg-surfaceHover"
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
                    : "text-gray-400 hover:text-primary hover:bg-primary/5"
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
                    ? "text-rose-400 bg-rose-500/10 border border-rose-500/25 font-semibold"
                    : "text-rose-400/80 hover:text-rose-400 hover:bg-rose-500/5"
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
              或外部权威库导入，带 ?kind= 才直接进编辑器。入口不预设层级，也不枚举层级清单。 */}
          <Link
              href="/new"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/30 text-xs font-medium text-primary hover:text-white transition-all shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">{t("catalog.create")}</span>
            </Link>

          {/* User Profile / Login */}
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 pl-1.5 pr-2.5 h-9 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-gray-200 transition-colors duration-fast ease-soft cursor-pointer"
              >
                <UserAvatar user={user} size="sm" shape="rounded" />
                <span className="font-medium max-w-[90px] truncate hidden sm:inline text-xs">
                  {displayNameOf(user as unknown as { username: string; display_name?: string })}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${
                    isUserMenuOpen ? "rotate-180" : ""
                  }`}
                  strokeWidth={1.5}
                />
              </button>

              {isUserMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 mt-2 w-56 rounded-xl border border-white/10 bg-surface shadow-elevated py-1.5 z-50 animate-slide-up text-xs"
                >
                  <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center gap-2.5">
                    <UserAvatar user={user} size="md" shape="rounded" ring />
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="font-semibold text-white truncate">
                        {displayNameOf(user as unknown as { username: string; display_name?: string })}
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono truncate">@{user.username}</div>
                      <div className="pt-0.5">
                        <UserRoleBadge role={user.role} t={t} showIcon />
                      </div>
                    </div>
                  </div>

                  <div className="py-1">
                    <a
                      href={getAuthSettingsUrl()}
                      onClick={() => setIsUserMenuOpen(false)}
                      className="w-full px-3 py-2 text-left text-gray-300 hover:text-white hover:bg-surfaceHover flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                      <span>{t("navbar.accountSessions")}</span>
                    </a>

                    {/* 开发者中心：桌面顶栏那条入口在 hidden xl:flex 里，<xl 视口（移动端/平板）
                        看不到，这里补同一个入口；可见性用 xl:hidden 与桌面导航配对，避免桌面重复。
                        规则一致：登录即可自助登记应用，未登录不显示——本菜单只在 user 存在时渲染。 */}
                    <Link
                      href="/developer"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="xl:hidden w-full px-3 py-2 text-left text-gray-300 hover:text-white hover:bg-surfaceHover flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                    >
                      <Terminal className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                      <span>{t("navigation.developer")}</span>
                    </Link>

                    {user.role === "admin" && (
                      <Link
                        href="/admin"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="w-full px-3 py-2 text-left text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
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
                        className="w-full px-3 py-2 text-left text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 flex items-center gap-2 transition-colors duration-fast ease-soft font-medium"
                      >
                        <Settings className="w-3.5 h-3.5" strokeWidth={1.7} />
                        <span>{t("navbar.userManagement")}</span>
                      </a>
                    )}
                  </div>

                  <div className="border-t border-white/[0.06] pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full px-3 py-2 text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 transition-colors duration-fast ease-soft cursor-pointer"
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
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-medium text-gray-200 transition-colors duration-fast ease-soft"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>{t("navbar.signIn")}</span>
            </a>
          )}

          {/* Controls: Theme & Locale */}
          <div className="flex items-center border-l border-white/10 pl-2 gap-1.5">
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
          const className = `whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? "bg-primary/10 text-primary" : "text-gray-400"}`;
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
