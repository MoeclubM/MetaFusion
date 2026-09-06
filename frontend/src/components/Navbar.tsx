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
import {
  Plus,
  LogOut,
  User as UserIcon,
  Shield,
  Settings,
  ChevronDown,
  Library,
  Compass,
  Layers,
  Users,
  Disc,
  Network,
  BookOpen,
  GitCompare,
  DownloadCloud,
  MessageSquare,
} from "lucide-react";

export const Navbar: React.FC<{ onOpenUpload?: () => void }> = ({ onOpenUpload }) => {
  const { user, logout } = useAuth();
  const { t, locale } = useI18n();
  const pathname = usePathname();

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const navLinks = [
    { href: "/", label: locale === "zh-CN" ? "首页" : "Home", icon: Library, exact: true },
    { href: "/explore", label: locale === "zh-CN" ? "探索中心" : "Explore", icon: Compass },
    { href: "/compare", label: locale === "zh-CN" ? "多版本对比" : "Compare", icon: GitCompare },
    { href: "/community", label: locale === "zh-CN" ? "社区论坛" : "Community", icon: MessageSquare },
    { href: "/downloads", label: locale === "zh-CN" ? "资源中心 ↗" : "Resources ↗", icon: DownloadCloud },
    { href: "/docs/catalog", label: locale === "zh-CN" ? "编目指南" : "Docs", icon: BookOpen, external: true },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-surface/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/85">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 sm:h-15 flex items-center justify-between gap-3">
        {/* Left Brand + Navigation */}
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/" title="MetaFusion" className="flex items-center gap-2.5 shrink-0 group">
            <BrandMark size={26} withGlow={false} idSuffix="nav" />
            <span className="flex flex-col leading-none">
              <span className="font-display text-[20px] leading-none tracking-[-0.03em] text-white group-hover:text-primary transition-colors">
                MetaFusion
              </span>
              <span className="hidden sm:inline font-mono text-[7px] tracking-[0.16em] text-white/30 leading-none mt-[3px]">
                CATALOG
              </span>
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1.5 ml-2">
            {navLinks.map((tab) => {
              const Icon = tab.icon;
              const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
              const className = `relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                active
                  ? "text-primary bg-primary/10 border border-primary/25 font-semibold shadow-xs"
                  : "text-gray-400 hover:text-white hover:bg-white/[0.04]"
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

            {user?.role === "admin" && (
              <Link
                href="/admin"
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium tracking-wide transition-all ${
                  pathname.startsWith("/admin")
                    ? "text-rose-400 bg-rose-500/10 border border-rose-500/25 font-semibold"
                    : "text-rose-400/80 hover:text-rose-400 hover:bg-rose-500/5"
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>{locale === "zh-CN" ? "管理后台" : "Admin"}</span>
              </Link>
            )}
          </nav>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Create dropdown */}
          <div className="relative group/create">
            <Link
              href="/new"
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/30 text-xs font-medium text-primary hover:text-white transition-all shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">{locale === "zh-CN" ? "新建条目" : "Create"}</span>
              <ChevronDown className="w-3 h-3 opacity-60 group-hover/create:rotate-180 transition-transform" />
            </Link>

            <div className="absolute right-0 top-full pt-1.5 hidden group-hover/create:block z-40">
              <div className="w-48 rounded-xl border border-white/10 bg-surface shadow-elevated py-1.5 text-xs overflow-hidden">
                <Link
                  href="/new?kind=work"
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] text-gray-200"
                >
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  <span>{locale === "zh-CN" ? "新建作品 (Work)" : "New Work"}</span>
                </Link>
                <Link
                  href="/new?kind=release"
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] text-gray-200"
                >
                  <Disc className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{locale === "zh-CN" ? "新建发行 (Release)" : "New Release"}</span>
                </Link>
                <Link
                  href="/new?kind=agent"
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] text-gray-200"
                >
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  <span>{locale === "zh-CN" ? "新建主体 (Agent)" : "New Agent"}</span>
                </Link>
                <Link
                  href="/new?kind=collection"
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] text-gray-200"
                >
                  <Network className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{locale === "zh-CN" ? "新建企划 (Collection)" : "New Collection"}</span>
                </Link>
              </div>
            </div>
          </div>

          {/* User Profile / Login */}
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 pl-1.5 pr-2.5 h-9 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-gray-200 transition-colors cursor-pointer"
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
                    <Link
                      href="/account"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="w-full px-3 py-2 text-left text-gray-300 hover:text-white hover:bg-white/[0.06] flex items-center gap-2 transition-colors font-medium"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-primary" strokeWidth={1.7} />
                      <span>{locale === "zh-CN" ? "个人中心与会话" : "Account & Sessions"}</span>
                    </Link>

                    {user.role === "admin" && (
                      <Link
                        href="/admin"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="w-full px-3 py-2 text-left text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 flex items-center gap-2 transition-colors font-medium"
                      >
                        <Shield className="w-3.5 h-3.5" strokeWidth={1.7} />
                        <span>{locale === "zh-CN" ? "管理控制台" : "Admin Console"}</span>
                      </Link>
                    )}
                  </div>

                  <div className="border-t border-white/[0.06] pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full px-3 py-2 text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" strokeWidth={1.7} />
                      <span>{locale === "zh-CN" ? "退出登录" : "Sign Out"}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/account"
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-medium text-gray-200 transition-colors"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>{locale === "zh-CN" ? "登录 / 注册" : "Sign In"}</span>
            </Link>
          )}

          {/* Controls: Theme & Locale */}
          <div className="flex items-center border-l border-white/10 pl-2 gap-1.5">
            <LocaleSwitcher />
            <ThemePicker />
          </div>
        </div>
      </div>
    </header>
  );
};
