"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemePicker } from "./ThemePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "./Logo";
import { displayNameOf } from "@/lib/api";
import {
  Plus,
  LogOut,
  User as UserIcon,
  MessageCircle,
  Shield,
  Settings,
  ChevronDown,
  Gift,
  Library,
  Compass,
  Layers,
  Users,
  Disc,
  Sparkles,
  Code2,
  Github,
} from "lucide-react";

interface NavbarProps {
  onOpenUpload?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenUpload }) => {
  const { user, logout } = useAuth();
  const { t } = useI18n();
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
    { href: "/home", label: t("nav.home"), icon: Library },
    { href: "/explore", label: t("nav.explore"), icon: Compass },
    { href: "/community", label: t("nav.community"), icon: MessageCircle },
    { href: "/developers", label: "API", icon: Code2 },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-black/5 dark:border-white/[0.06] bg-surface/80 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/80">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-12 flex items-center justify-between gap-3">
          {/* Left Brand + Telemetry */}
          <div className="flex items-center gap-3 sm:gap-4">
            <Link href="/" title={t("common.back")} className="flex items-center gap-2 shrink-0 group">
              <BrandMark size={24} withGlow={false} idSuffix="nav" />
              <span className="flex flex-col leading-none">
                <span className="font-display text-[19px] leading-none tracking-[-0.03em] text-gray-900 dark:text-white group-hover:text-primary transition-colors">
                  MetaFusion
                </span>
                <span className="hidden sm:inline font-mono text-[7px] tracking-[0.16em] text-gray-500 dark:text-white/30 leading-none mt-[2px]">
                  SINCE 2026
                </span>
              </span>
            </Link>
            <nav className="hidden lg:flex items-center gap-1 ml-1">
              {navLinks.map((tab) => {
                const Icon = tab.icon;
                const active = tab.href === "/" ? pathname === "/" || pathname === "/explore" : pathname.startsWith(tab.href);
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium tracking-wide transition-all ${
                      active
                        ? "text-primary bg-primary/10 border border-primary/25 font-semibold shadow-xs"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" strokeWidth={1.6} />
                    <span>{tab.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <a
              href="https://github.com/MoeclubM/MetaFusion"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub — MoeclubM/MetaFusion"
              className="hidden sm:inline-flex items-center gap-1 px-2.5 h-7.5 rounded-md bg-black/5 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-gray-700 dark:text-white/70 hover:text-gray-900 dark:hover:text-white text-xs font-mono font-medium transition-colors"
            >
              <Github className="w-3.5 h-3.5" strokeWidth={1.8} />
              <span>REPO</span>
            </a>
            {/* Create dropdown — only logged in */}
            {user && (
              <div className="hidden sm:block relative group/create">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1 px-2.5 h-7.5 rounded-md border text-xs font-medium tracking-wide transition-all shadow-2xs ${
                    pathname.startsWith("/contribute") || pathname.startsWith("/works/new") || pathname.startsWith("/artists/new") || pathname.startsWith("/releases/new")
                      ? "bg-primary text-white keep-white border-primary shadow-xs font-semibold"
                      : "bg-primary/10 hover:bg-primary/20 text-primary border-primary/20 hover:border-primary/40 font-medium"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                  <span>{t("nav.createMenu")}</span>
                  <ChevronDown className="w-3 h-3 opacity-60 group-hover/create:rotate-180 transition-transform" />
                </button>
                <div className="absolute right-0 top-full pt-1.5 hidden group-hover/create:block z-40">
                  <div className="w-52 rounded-lg border border-black/10 dark:border-white/10 bg-surface shadow-elevated py-1 text-xs overflow-hidden">
                    <Link href="/works/new" className="flex items-center gap-2.5 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/[0.06] text-gray-700 dark:text-gray-200">
                      <Layers className="w-3.5 h-3.5 text-sky-500" /> {t("nav.createWork")}
                    </Link>
                    <Link href="/artists/new" className="flex items-center gap-2.5 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/[0.06] text-gray-700 dark:text-gray-200">
                      <Users className="w-3.5 h-3.5 text-amber-500" /> {t("nav.createArtist")}
                    </Link>
                    <Link href="/releases/new" className="flex items-center gap-2.5 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/[0.06] text-gray-700 dark:text-gray-200">
                      <Disc className="w-3.5 h-3.5 text-emerald-500" /> {t("nav.createRelease")}
                    </Link>
                    <div className="border-t border-black/[0.06] dark:border-white/[0.06] mt-1 pt-1">
                      <Link href="/contribute" className="flex items-center gap-2.5 px-3 py-2 hover:bg-primary/10 text-primary font-medium">
                        <Sparkles className="w-3.5 h-3.5" /> {t("nav.contributeSystem")}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {user ? (
              <>
                <div className="relative" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-1.5 pl-1.5 pr-2 h-7.5 rounded-md bg-black/5 dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/[0.08] border border-black/10 dark:border-white/10 text-xs text-gray-800 dark:text-gray-200 transition-colors"
                  >
                    <div className="w-4.5 h-4.5 rounded-sm bg-primary text-white keep-white font-mono font-bold text-[10px] grid place-items-center">
                      {displayNameOf(user as unknown as { username: string; display_name?: string }).slice(0, 1).toUpperCase()}
                    </div>
                    <span className="font-medium max-w-[80px] truncate hidden sm:inline">{displayNameOf(user as unknown as { username: string; display_name?: string })}</span>
                    <ChevronDown className={`w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isUserMenuOpen ? "rotate-180" : ""}`} strokeWidth={1.5} />
                  </button>

                  {isUserMenuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 mt-1.5 w-52 rounded-lg border border-black/10 dark:border-white/10 bg-surface shadow-elevated py-1 z-50 isolate animate-slide-up text-xs"
                    >
                      <div className="px-3 py-2 border-b border-black/[0.06] dark:border-white/[0.06] space-y-0.5">
                        <div className="font-semibold text-gray-900 dark:text-white truncate">{displayNameOf(user as unknown as { username: string; display_name?: string })}</div>
                        {displayNameOf(user as unknown as { username: string; display_name?: string }) !== user.username && <div className="text-[10px] text-gray-500 font-mono">@{user.username}</div>}
                        <span className="px-1.5 py-0.2 rounded-sm bg-black/5 dark:bg-white/[0.08] border border-black/10 dark:border-white/10 font-mono text-[9px] text-gray-600 dark:text-gray-300 capitalize">
                          {user.role}
                        </span>
                      </div>

                      <div className="py-1">
                        <Link
                          href="/contribute"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="w-full px-3 py-1.5 text-left text-primary hover:bg-primary/10 flex items-center gap-2 transition-colors font-medium sm:hidden"
                        >
                          <Plus className="w-3.5 h-3.5 text-primary" strokeWidth={2} />
                          <span>{t("nav.contribute")}</span>
                        </Link>

                        <Link
                          href="/invites"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="w-full px-3 py-1.5 text-left text-amber-600 dark:text-amber-300 hover:bg-amber-500/10 flex items-center gap-2 transition-colors"
                        >
                          <Gift className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" strokeWidth={1.5} />
                          <span>{t("nav.inviteFriends")}</span>
                        </Link>

                        <Link
                          href="/settings"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="w-full px-3 py-1.5 text-left text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
                        >
                          <Settings className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" strokeWidth={1.5} />
                          <span>{t("nav.userSettings")}</span>
                        </Link>

                        {(user.role === "admin" || user.role === "archivist") && (
                          <a
                            href="/admin/"
                            onClick={() => setIsUserMenuOpen(false)}
                            className="w-full px-3 py-1.5 text-left text-amber-600 dark:text-amber-300 hover:bg-amber-500/10 flex items-center gap-2 transition-colors"
                          >
                            <Shield className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" strokeWidth={1.5} />
                            <span>{t("nav.adminConsole")}</span>
                          </a>
                        )}
                      </div>

                      <div className="border-t border-black/[0.06] dark:border-white/[0.06] pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            logout();
                          }}
                          className="w-full px-3 py-1.5 text-left text-red-500 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                        >
                          <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} />
                          <span>{t("nav.logout")}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 px-3 h-7.5 rounded-md bg-primary text-white keep-white hover:opacity-90 text-xs font-semibold shadow-xs"
              >
                <UserIcon className="w-3.5 h-3.5" strokeWidth={1.7} />
                <span>{t("nav.login")}</span>
              </Link>
            )}

            <ThemePicker />
            <LocaleSwitcher compact />
          </div>
        </div>
        {/* mobile navLinks row when lg hidden */}
        <div className="lg:hidden border-t border-black/5 dark:border-white/[0.06] bg-surface/60 backdrop-blur">
          <nav className="max-w-7xl mx-auto px-3 py-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar">
            {navLinks.map((tab) => {
              const Icon = tab.icon;
              const active = pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-all ${active ? "bg-primary text-white keep-white border border-primary shadow-xs font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.04] border border-transparent"}`}
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.6} />
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
    </>
  );
};

