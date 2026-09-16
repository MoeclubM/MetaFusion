"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { UserAvatar } from "@/components/UserAvatar";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme, accentLabel } from "@/lib/themeContext";
import { displayNameOf, fetchAuthSettings, PublicAuthSettings } from "@/lib/api";
import { authErrorText, httpStatusOf } from "@/lib/authErrors";
import { UserRoleBadge } from "@/lib/roles";
import { TitleDisplayOrderSetting } from "@/components/settings/TitleDisplayOrderSetting";
import { ThemeControls } from "@/components/ThemeControls";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Shield,
  Globe,
  Palette,
  Sun,
  Moon,
  Laptop,
  Lock,
  Check,
  AlertCircle,
  Settings,
  KeyRound,
  Eye,
  Heart,
  Mail,
} from "lucide-react";
import { TabPanel } from "@/components/ui/TabPanel";
import { PageShell } from "@/components/ui/PageShell";

export default function SettingsPage() {
  const { user } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { mode, accent, setMode, setAccent, accents } = useTheme();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as string) === "tokens" ? "tokens" : "profile";

  const [activeTab, setActiveTab] = useState<"profile" | "password" | "appearance" | "tokens">(initialTab as "profile" | "password" | "appearance" | "tokens");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  // 邮箱验证能力：后端 GET /auth/settings 目前如实返回全部关闭。
  const [authSettings, setAuthSettings] = useState<PublicAuthSettings | null>(null);

  useEffect(() => {
    fetchAuthSettings().then(setAuthSettings).catch(() => {});
  }, []);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "tokens" || tab === "appearance" || tab === "password" || tab === "profile") {
      setActiveTab(tab as "profile" | "password" | "appearance" | "tokens");
    }
  }, [searchParams]);

  useEffect(() => {
    if (user) {
      const u = user as unknown as Record<string, unknown>;
      setDisplayName((u["display_name"] as string) || "");
      setBio((u["bio"] as string) || "");
      setAvatarUrl((u["avatar_url"] as string) || "");
    }
  }, [user?.id, (user as any)?.avatar_url, (user as any)?.display_name, (user as any)?.bio]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // 后端 Store.ChangePassword 要求 12–72 位，与请求体 old_password/new_password 对齐。
    if (newPassword.length < 12) {
      setError(t("auth.error.invalid_password_length"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.passwordMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 带上状态码：账号服务的错误码要经 authErrorText 翻成当前语言的人话。
        const failed = new Error(data.error || "request_failed") as Error & { status?: number };
        failed.status = res.status;
        throw failed;
      }
      setSuccess(t("settings.passwordSuccess"));
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      // 服务端给的是稳定错误码（invalid_old_password / invalid_password_length 等）：
      // 必须走四语字典，不能把原始码当文案贴给用户（此处曾直出 invalid_old_password）。
      setError(
        authErrorText(
          err instanceof Error ? err.message : String(err),
          t,
          httpStatusOf(err),
          "settings.passwordFail"
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <PageShell width="narrow" center className="py-16">
          <div className="w-12 h-12 rounded-full bg-white/5 grid place-items-center">
            <KeyRound className="w-6 h-6 text-gray-500" />
          </div>
          <p className="text-sm text-gray-500">{t("create.common.requiresLogin")}</p>
          <Link href="/login?redirect=/settings" className="px-5 h-9 rounded-full bg-primary text-white keep-white inline-flex items-center text-sm font-semibold">
            {t("nav.login")}
          </Link>
        </PageShell>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <Navbar />
      <PageShell width="narrow">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-line-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 text-primary grid place-items-center shrink-0">
              <Settings className="w-4 h-4" strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight text-text-strong leading-none">
                {t("settings.title")}
              </h1>
              <p className="text-xs text-gray-500 mt-1">{t("settings.subtitle")}</p>
            </div>
          </div>

          <div className="flex gap-1 p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] border border-line-subtle w-fit overflow-x-auto">
            <button
              onClick={() => {
                setActiveTab("profile");
                setError(null);
                setSuccess(null);
              }}
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors duration-fast ease-soft whitespace-nowrap ${
                activeTab === "profile" ? "bg-white dark:bg-white text-black font-semibold shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {t("settings.tabProfile")}
            </button>
            <button
              onClick={() => {
                setActiveTab("tokens");
                setError(null);
                setSuccess(null);
              }}
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors duration-fast ease-soft flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === "tokens" ? "bg-white dark:bg-white text-black font-semibold shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{t("settings.tabTokens")}</span>
            </button>
            <button
              onClick={() => {
                setActiveTab("appearance");
                setError(null);
                setSuccess(null);
              }}
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors duration-fast ease-soft whitespace-nowrap ${
                activeTab === "appearance" ? "bg-white dark:bg-white text-black font-semibold shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {t("settings.appearanceTitle")}
            </button>
            <button
              onClick={() => {
                setActiveTab("password");
                setError(null);
                setSuccess(null);
              }}
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors duration-fast ease-soft whitespace-nowrap ${
                activeTab === "password" ? "bg-white dark:bg-white text-black font-semibold shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {t("settings.tabPassword")}
            </button>
          </div>
        </div>

        {/* key 随页签变化：切换时重挂载以重放 .mf-tabpanel 进入动画（与详情页/管理台同一约定）。 */}
        <TabPanel activeKey={activeTab} spacing="none" className="rounded-xl border border-line bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden">
          {activeTab === "profile" && (
            <div className="p-4 sm:p-6 space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 font-mono text-xs sm:text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-xs sm:text-sm flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{success}</span>
                </div>
              )}

              <div className="flex items-center gap-4 p-4 rounded-xl bg-surfaceSubtle border border-line-subtle">
                <div className="shrink-0">
                  <UserAvatar
                    user={{
                      username: user.username,
                      display_name: displayName || (user as any).display_name,
                      avatar_url: avatarUrl,
                    }}
                    size="xl"
                    shape="rounded"
                    ring
                  />
                </div>

                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-text-strong text-base truncate">
                      {displayNameOf(user as unknown as { username: string; display_name?: string })}
                    </span>
                    <UserRoleBadge role={user.role} t={t} showIcon />
                    {displayNameOf(user as unknown as { username: string; display_name?: string }) !== user.username && (
                      <span className="font-mono text-xs text-gray-500">@{user.username}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap font-mono text-xs text-gray-500">
                    <span className="truncate">{user.email || t("settings.unboundEmail")}</span>
                    {user.email && (
                      user.is_email_verified ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-mono font-medium">
                          <Check className="w-3 h-3" />
                          <span>{t("settings.emailVerified")}</span>
                        </span>
                      ) : authSettings?.email_verification_enabled === false ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.04] text-gray-500 border border-line text-[10px] font-mono font-medium">
                          <span>{t("settings.emailVerificationDisabledTag")}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-mono font-medium">
                          <AlertCircle className="w-3 h-3" />
                          <span>{t("settings.emailUnverified")}</span>
                        </span>
                      )
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-gray-400 break-all">
                    UUID: {user.id}
                  </div>
                </div>
              </div>

              {/* 资料编辑：后端没有 /auth/profile 实现，改为只读展示 + 占位说明 */}
              <div className="space-y-3.5">
                <div className="p-3 rounded-lg bg-surfaceSubtle border border-line-subtle text-xs text-text-body flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                  <span>
                    {t("settings.displayName")} / {t("settings.bioLabel")}: {t("catalog.unavailable")}
                  </span>
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-xs sm:text-sm text-text-muted">{t("settings.displayName")}</label>
                  <div className="w-full min-h-10 px-3.5 py-2.5 bg-background border border-line rounded-lg text-text-strong text-sm opacity-70">
                    {displayNameOf(user as unknown as { username: string; display_name?: string })}
                  </div>
                  <p className="font-mono text-xs text-gray-500">{t("settings.displayNameHint")}</p>
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-xs sm:text-sm text-text-muted">{t("settings.bioLabel")}</label>
                  <div className="w-full min-h-10 p-3.5 bg-background border border-line rounded-lg text-text-strong text-sm opacity-70 whitespace-pre-wrap">
                    {bio || "—"}
                  </div>
                </div>
              </div>

              <div className="grid gap-1.5 pt-2 border-t border-line-subtle">
                <div className="p-2.5 rounded-md bg-background border border-line-subtle flex items-center justify-between text-xs font-mono">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
                    <span>{t("settings.accountRole")}</span>
                  </span>
                  <UserRoleBadge role={user.role} t={t} showIcon />
                </div>

                {!!(user as unknown as { invite_code?: string }).invite_code && (
                  <div className="p-2.5 rounded-md bg-background border border-line-subtle flex items-center justify-between text-xs font-mono">
                    <span className="text-gray-500 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
                      <span>{t("settings.inviteCodeLabel")}</span>
                    </span>
                    <span className="text-text-strong font-semibold tracking-widest">{(user as unknown as { invite_code: string }).invite_code}</span>
                  </div>
                )}

                <div className="p-2.5 rounded-md bg-background border border-line-subtle flex items-center justify-between text-xs font-mono">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-sky-500" strokeWidth={1.5} />
                    <span>{t("settings.interfaceLanguage")}</span>
                  </span>
                  <Select
                    value={locale}
                    onChange={(val) => setLocale(val as "zh-CN" | "zh-TW" | "ja-JP" | "en-US")}
                    fullWidth={false}
                    className="min-w-[10.5rem] h-8 px-2 text-xs"
                    options={[
                      { value: "zh-CN", label: t("locale.simplifiedChinese") },
                      { value: "zh-TW", label: t("locale.traditionalChinese") },
                      { value: "ja-JP", label: t("locale.japanese") },
                      { value: "en-US", label: t("locale.englishUs") },
                    ]}
                  />
                </div>

                <TitleDisplayOrderSetting />
              </div>

              {/* 隐私设置：后端没有 /auth/profile 实现，开关不可写，如实禁用 */}
              <div className="space-y-1.5 pt-2 border-t border-line-subtle">
                <div className="flex items-center gap-1.5 pb-1">
                  <Eye className="w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
                  <span className="font-mono text-xs font-semibold text-text-body">{t("settings.privacyTitle")}</span>
                  <span className="ml-auto font-mono text-[10px] text-gray-400">{t("catalog.unavailable")}</span>
                </div>

                <div className="p-3 rounded-md bg-background border border-line-subtle flex items-center justify-between gap-3 opacity-60">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs sm:text-sm font-medium text-text-strong flex items-center gap-1.5">
                      <Heart className="w-3.5 h-3.5 text-rose-500" strokeWidth={1.8} />
                      <span>{t("settings.privacyFavorites")}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 leading-relaxed">{t("settings.privacyFavoritesDesc")}</div>
                  </div>
                  <label className="relative inline-flex items-center shrink-0 cursor-not-allowed">
                    <input type="checkbox" checked={favoritesPublicValue(user)} disabled readOnly className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-300 dark:bg-white/20 rounded-full peer-checked:bg-primary"></div>
                  </label>
                </div>

                <div className="p-3 rounded-md bg-background border border-line-subtle flex items-center justify-between gap-3 opacity-60">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs sm:text-sm font-medium text-text-strong flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-sky-500" strokeWidth={1.8} />
                      <span>{t("settings.privacyEmail")}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 leading-relaxed">{t("settings.privacyEmailDesc")}</div>
                  </div>
                  <label className="relative inline-flex items-center shrink-0 cursor-not-allowed">
                    <input type="checkbox" checked={emailPublicValue(user)} disabled readOnly className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-300 dark:bg-white/20 rounded-full peer-checked:bg-primary"></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === "tokens" && (
            <div className="p-4 sm:p-5 space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-text-strong flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-amber-500" />
                  <span>{t("settings.patTitle")}</span>
                </h3>
              </div>

              <div className="p-6 rounded-xl bg-amber-500/[0.06] border border-amber-500/25 flex flex-col items-center gap-2 text-center">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <div className="text-sm font-semibold text-text-strong">{t("catalog.unavailable")}</div>
                <p className="text-xs text-gray-500 max-w-sm">
                  {t("settings.patDesc")}
                </p>
              </div>
            </div>
          )}

          {activeTab === "appearance" && (
            <div className="p-4 sm:p-5">
              <ThemeControls />
            </div>
          )}

          {activeTab === "password" && (
            <form onSubmit={handlePasswordChange} className="p-4 sm:p-6 space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 font-mono text-xs sm:text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-xs sm:text-sm flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{success}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-mono text-xs sm:text-sm text-text-muted">{t("settings.oldPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    placeholder={t("settings.oldPasswordPlaceholder")}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full pl-9 pr-3.5 h-10 bg-background border border-line rounded-lg text-text-strong text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-xs sm:text-sm text-text-muted">{t("settings.newPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    minLength={12}
                    placeholder={t("settings.newPasswordPlaceholder")}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-9 pr-3.5 h-10 bg-background border border-line rounded-lg text-text-strong text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-xs sm:text-sm text-text-muted">{t("settings.confirmPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    minLength={12}
                    placeholder={t("settings.confirmPasswordPlaceholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-3.5 h-10 bg-background border border-line rounded-lg text-text-strong text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-10 rounded-lg bg-primary text-white keep-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50 mt-1 shadow-xs"
              >
                {submitting ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : t("settings.confirmChange")}
              </button>
            </form>
          )}
        </TabPanel>
      </PageShell>
    </div>
  );
}

function favoritesPublicValue(user: unknown): boolean {
  return (user as Record<string, unknown>)["favorites_public"] !== false;
}

function emailPublicValue(user: unknown): boolean {
  return (user as Record<string, unknown>)["email_public"] === true;
}
