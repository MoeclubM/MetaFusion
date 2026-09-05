"use client";

import React, { useState, useEffect, useRef } from "react";
import { Navbar } from "@/components/Navbar";
import { UserAvatar } from "@/components/UserAvatar";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/lib/themeContext";
import { fetchApi, displayNameOf, ApiToken, listApiTokens, createApiToken, deleteApiToken, uploadAvatar, deleteAvatar, sendVerificationEmail, verifyEmail, fetchAuthSettings, PublicAuthSettings } from "@/lib/api";
import { UserRoleBadge } from "@/lib/roles";
import { TitleDisplayOrderSetting } from "@/components/settings/TitleDisplayOrderSetting";
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
  Copy,
  Trash2,
  Terminal,
  Code2,
  ExternalLink,
  Camera,
  Loader2,
  Eye,
  Heart,
  Mail,
  Send,
  X,
} from "lucide-react";

export default function SettingsPage() {
  const { user, refreshProfile } = useAuth();
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
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarRemoving, setAvatarRemoving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 隐私开关状态
  const [favoritesPublic, setFavoritesPublic] = useState(true);
  const [emailPublic, setEmailPublic] = useState(false);
  const [privacySaving, setPrivacySaving] = useState<string | null>(null);

  // 邮箱验证弹窗与配置状态
  const [authSettings, setAuthSettings] = useState<PublicAuthSettings | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [verifyCountdown, setVerifyCountdown] = useState(0);
  const [verifyModalError, setVerifyModalError] = useState<string | null>(null);
  const [verifyModalSuccess, setVerifyModalSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthSettings().then(setAuthSettings).catch(() => {});
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (verifyCountdown > 0) {
      timer = setTimeout(() => setVerifyCountdown((c) => c - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [verifyCountdown]);

  const handleSendVerificationEmail = async () => {
    if (authSettings?.email_verification_enabled === false) {
      setVerifyModalError(t("settings.emailVerificationDisabled"));
      return;
    }
    setVerifyModalError(null);
    setVerifyModalSuccess(null);
    setSendingEmail(true);
    try {
      const res = await sendVerificationEmail();
      setVerifyModalSuccess(res.message || t("settings.verificationEmailSent"));
      setVerifyCountdown(60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setVerifyModalError(msg || t("settings.verificationEmailFail"));
    } finally {
      setSendingEmail(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode.trim()) {
      setVerifyModalError(t("settings.verificationCodeRequired"));
      return;
    }
    setVerifyModalError(null);
    setVerifyModalSuccess(null);
    setVerifyingEmail(true);
    try {
      const res = await verifyEmail(verificationCode.trim());
      await refreshProfile();
      setSuccess(res.message || t("settings.emailVerifiedSuccess"));
      setShowVerifyModal(false);
      setVerificationCode("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setVerifyModalError(msg || t("settings.verificationCodeFail"));
    } finally {
      setVerifyingEmail(false);
    }
  };

  // PAT state
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdTokenMeta, setCreatedTokenMeta] = useState<ApiToken | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      setFavoritesPublic(u["favorites_public"] !== false);
      setEmailPublic(u["email_public"] === true);
    }
  }, [user?.id, (user as any)?.avatar_url, (user as any)?.display_name, (user as any)?.bio]);

  const handlePrivacyChange = async (field: "favorites_public" | "email_public", value: boolean) => {
    setError(null);
    setSuccess(null);
    const prev = field === "favorites_public" ? favoritesPublic : emailPublic;
    // 乐观更新，失败回滚
    if (field === "favorites_public") setFavoritesPublic(value);
    else setEmailPublic(value);
    setPrivacySaving(field);
    try {
      await fetchApi("/auth/profile", {
        method: "PUT",
        body: JSON.stringify({ [field]: value }),
      });
      await refreshProfile();
      setSuccess(t(field === "favorites_public" ? "settings.privacyFavoritesSaved" : "settings.privacyEmailSaved"));
    } catch (err: unknown) {
      if (field === "favorites_public") setFavoritesPublic(prev);
      else setEmailPublic(prev);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t("settings.privacySaveFail"));
    } finally {
      setPrivacySaving(null);
    }
  };

  const loadTokens = async () => {
    setTokensLoading(true);
    setTokenError(null);
    try {
      const res = await listApiTokens();
      setTokens(res.items || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTokenError(msg);
    } finally {
      setTokensLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "tokens" && user) {
      loadTokens();
    }
  }, [activeTab, user?.id]);

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError(t("settings.avatarTooLarge"));
      e.target.value = "";
      return;
    }
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/avif"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i)) {
      setError(t("settings.avatarInvalidType"));
      e.target.value = "";
      return;
    }

    setError(null);
    setSuccess(null);
    setAvatarUploading(true);
    try {
      const res = await uploadAvatar(file);
      setAvatarUrl(res.avatar_url);
      await refreshProfile();
      setSuccess(t("settings.avatarUploadSuccess"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t("settings.avatarUploadFail"));
    } finally {
      setAvatarUploading(false);
      e.target.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    setError(null);
    setSuccess(null);
    setAvatarRemoving(true);
    try {
      await deleteAvatar();
      setAvatarUrl("");
      await refreshProfile();
      setSuccess(t("settings.avatarRemoveSuccess"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t("settings.avatarRemoveFail"));
    } finally {
      setAvatarRemoving(false);
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = displayName.trim();
    if (trimmed.length > 64) {
      setError(t("settings.displayNameHint"));
      return;
    }
    setProfileSaving(true);
    try {
      await fetchApi("/auth/profile", {
        method: "PUT",
        body: JSON.stringify({ display_name: displayName, bio, avatar_url: avatarUrl.trim() }),
      });
      await refreshProfile();
      setSuccess(t("settings.profileSuccess"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t("settings.profileFail"));
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8) {
      setError(t("settings.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.passwordMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      await fetchApi("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      setSuccess(t("settings.passwordSuccess"));
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t("settings.passwordFail"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim()) {
      setTokenError(t("settings.patNameRequired"));
      return;
    }
    setCreatingToken(true);
    setTokenError(null);
    setCreatedToken(null);
    try {
      const scopes = isReadOnly ? ["read"] : ["read", "write"];
      const res = await createApiToken({ name: newTokenName.trim(), scopes });
      setCreatedToken(res.token);
      setCreatedTokenMeta({ id: res.id, name: res.name, prefix: res.prefix, scopes: res.scopes, created_at: res.created_at, updated_at: res.created_at, last_used_at: null, expires_at: res.expires_at });
      setNewTokenName("");
      setIsReadOnly(false);
      await loadTokens();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTokenError(msg);
    } finally {
      setCreatingToken(false);
    }
  };

  const handleDeleteToken = async (id: string) => {
    if (!confirm(t("settings.patRevokeConfirm"))) return;
    try {
      await deleteApiToken(id);
      await loadTokens();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTokenError(msg);
    }
  };

  const copyToken = async (v: string) => {
    await navigator.clipboard.writeText(v);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-16 w-full flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-white/5 grid place-items-center">
            <KeyRound className="w-6 h-6 text-gray-500" />
          </div>
          <p className="text-sm text-gray-500">{t("create.common.requiresLogin")}</p>
          <Link href="/login" className="px-5 h-9 rounded-full bg-primary text-white keep-white inline-flex items-center text-sm font-semibold">
            {t("nav.login")}
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <Navbar />
      <main className="relative z-10 max-w-3xl mx-auto px-4 py-5 w-full flex-1 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-black/5 dark:border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 text-primary grid place-items-center shrink-0">
              <Settings className="w-4 h-4" strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight text-gray-900 dark:text-white leading-none">
                {t("settings.title")}
              </h1>
              <p className="text-xs text-gray-500 mt-1">{t("settings.subtitle")}</p>
            </div>
          </div>

          <div className="flex gap-1 p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] w-fit overflow-x-auto">
            <button
              onClick={() => {
                setActiveTab("profile");
                setError(null);
                setSuccess(null);
              }}
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
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
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
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
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
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
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === "password" ? "bg-white dark:bg-white text-black font-semibold shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {t("settings.tabPassword")}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden">
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

              <div className="flex items-center gap-4 p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/[0.06]">
                {/* Clickable Avatar with Camera Overlay & File Input */}
                <div
                  className="relative group cursor-pointer shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                  title={t("settings.avatarUpload")}
                >
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
                  <div className="absolute inset-0 rounded-md bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center text-white">
                    {avatarUploading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-white" />
                    ) : (
                      <Camera className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleAvatarFileChange}
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif"
                    className="hidden"
                  />
                </div>

                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-white text-base truncate">
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
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.04] text-gray-500 border border-black/10 dark:border-white/10 text-[10px] font-mono font-medium">
                          <span>{t("settings.emailVerificationDisabledTag")}</span>
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-mono font-medium">
                            <AlertCircle className="w-3 h-3" />
                            <span>{t("settings.emailUnverified")}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setShowVerifyModal(true);
                              setVerifyModalError(null);
                              setVerifyModalSuccess(null);
                              setVerificationCode("");
                            }}
                            className="text-primary hover:underline text-[11px] font-semibold cursor-pointer"
                          >
                            {t("settings.verifyEmailBtn")}
                          </button>
                        </div>
                      )
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-gray-400 break-all flex items-center gap-2">
                    <span>UUID: {user.id}</span>
                    {!!avatarUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        disabled={avatarRemoving || avatarUploading}
                        className="text-red-500 hover:underline text-[11px] font-mono cursor-pointer ml-2"
                      >
                        {avatarRemoving ? t("settings.avatarRemoving") : t("settings.avatarRemove")}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {user.email && !user.is_email_verified && authSettings?.email_verification_enabled !== false && authSettings?.require_email_verification && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-300 font-mono text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
                    <span>{t("settings.emailVerificationNotice")}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowVerifyModal(true);
                      setVerifyModalError(null);
                      setVerifyModalSuccess(null);
                      setVerificationCode("");
                    }}
                    className="px-3 h-7 rounded-lg bg-amber-500 text-white font-semibold text-[11px] hover:bg-amber-600 transition-colors shrink-0 cursor-pointer inline-flex items-center justify-center"
                  >
                    {t("settings.verifyEmailBtn")}
                  </button>
                </div>
              )}

              <form onSubmit={handleProfileSave} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="font-mono text-xs sm:text-sm text-gray-500 dark:text-gray-400">{t("settings.displayName")}</label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t("settings.displayNamePlaceholder")}
                    maxLength={64}
                    className="w-full h-10 px-3.5 bg-background border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                  <p className="font-mono text-xs text-gray-500">{t("settings.displayNameHint")}</p>
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-xs sm:text-sm text-gray-500 dark:text-gray-400">{t("settings.bioLabel")}</label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder={t("settings.bioPlaceholder")}
                    rows={3}
                    className="w-full p-3.5 bg-background border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary/50 resize-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="w-full h-10 rounded-lg bg-primary text-white keep-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50 shadow-xs"
                >
                  {profileSaving ? <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : null}
                  <span>{profileSaving ? t("settings.profileSaving") : t("settings.profileSave")}</span>
                </button>
              </form>

              <div className="grid gap-1.5 pt-2 border-t border-black/5 dark:border-white/[0.06]">
                <div className="p-2.5 rounded-md bg-background border border-black/5 dark:border-white/[0.06] flex items-center justify-between text-xs font-mono">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
                    <span>{t("settings.accountRole")}</span>
                  </span>
                  <UserRoleBadge role={user.role} t={t} showIcon />
                </div>

                {!!(user as unknown as { invite_code?: string }).invite_code && (
                  <div className="p-2.5 rounded-md bg-background border border-black/5 dark:border-white/[0.06] flex items-center justify-between text-xs font-mono">
                    <span className="text-gray-500 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
                      <span>{t("settings.inviteCodeLabel")}</span>
                    </span>
                    <span className="text-gray-900 dark:text-white font-semibold tracking-widest">{(user as unknown as { invite_code: string }).invite_code}</span>
                  </div>
                )}

                <div className="p-2.5 rounded-md bg-background border border-black/5 dark:border-white/[0.06] flex items-center justify-between text-xs font-mono">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-sky-500" strokeWidth={1.5} />
                    <span>{t("settings.interfaceLanguage")}</span>
                  </span>
                  <Select
                    value={locale}
                    onChange={(val) => setLocale(val as "zh-CN" | "en-US")}
                    fullWidth={false}
                    className="min-w-[10.5rem] h-8 px-2 text-xs"
                    options={[
                      { value: "zh-CN", label: `${t("locale.chinese")} (Chinese)` },
                      { value: "en-US", label: "English (US)" },
                    ]}
                  />
                </div>

                <TitleDisplayOrderSetting />
              </div>

              {/* 隐私设置：收藏列表与邮箱的公开范围 */}
              <div className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/[0.06]">
                <div className="flex items-center gap-1.5 pb-1">
                  <Eye className="w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
                  <span className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">{t("settings.privacyTitle")}</span>
                </div>

                <div className="p-3 rounded-md bg-background border border-black/5 dark:border-white/[0.06] flex items-center justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                      <Heart className="w-3.5 h-3.5 text-rose-500" strokeWidth={1.8} />
                      <span>{t("settings.privacyFavorites")}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 leading-relaxed">{t("settings.privacyFavoritesDesc")}</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={favoritesPublic}
                      disabled={privacySaving === "favorites_public"}
                      onChange={(e) => handlePrivacyChange("favorites_public", e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className={`w-9 h-5 bg-gray-300 dark:bg-white/20 rounded-full peer after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white peer-checked:bg-primary ${privacySaving === "favorites_public" ? "opacity-60" : ""}`}></div>
                  </label>
                </div>

                <div className="p-3 rounded-md bg-background border border-black/5 dark:border-white/[0.06] flex items-center justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-sky-500" strokeWidth={1.8} />
                      <span>{t("settings.privacyEmail")}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 leading-relaxed">{t("settings.privacyEmailDesc")}</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={emailPublic}
                      disabled={privacySaving === "email_public"}
                      onChange={(e) => handlePrivacyChange("email_public", e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className={`w-9 h-5 bg-gray-300 dark:bg-white/20 rounded-full peer after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white peer-checked:bg-primary ${privacySaving === "email_public" ? "opacity-60" : ""}`}></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === "tokens" && (
            <div className="p-4 sm:p-5 space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-amber-500" />
                  <span>{t("settings.patTitle")}</span>
                </h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  {t("settings.patDesc")}
                </p>
                <a href="/docs/api-auth" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <Code2 className="w-3 h-3" />
                  <span>{t("settings.patViewDevDocs")}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {createdToken && (
                <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                    <Check className="w-4 h-4" />
                    <span>{t("settings.patCreatedBanner")}</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded bg-black/90 border border-white/10">
                    <Terminal className="w-3.5 h-3.5 text-white/60 shrink-0" />
                    <code className="flex-1 font-mono text-xs text-emerald-300 break-all">{createdToken}</code>
                    <button onClick={() => copyToken(createdToken)} className="shrink-0 inline-flex items-center gap-1 px-2.5 h-7 rounded bg-white text-black text-xs font-semibold hover:bg-gray-100">
                      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? t("common.copied") : t("common.copy")}</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10">{t("settings.patPrefix", { prefix: createdTokenMeta?.prefix || "" })}</span>
                    <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10">
                      {createdTokenMeta?.scopes.includes("write") ? t("settings.scopeReadWrite") : t("settings.scopeReadOnly")}
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300/80">{t("settings.patEnvHint")}</p>
                </div>
              )}

              {tokenError && (
                <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 font-mono text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{tokenError}</span>
                </div>
              )}

              <form onSubmit={handleCreateToken} className="p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/[0.06] space-y-3.5">
                <div className="space-y-1">
                  <label className="font-mono text-xs sm:text-sm text-gray-500">{t("settings.patTokenName")}</label>
                  <input value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} placeholder={t("settings.patNamePlaceholder")} maxLength={64} className="w-full h-10 px-3.5 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:border-primary/50" />
                </div>
                
                <div className="flex items-center justify-between p-3 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06]">
                  <div className="space-y-0.5">
                    <div className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">
                      {t("settings.apiKeyReadOnlyTitle")}
                    </div>
                    <div className="text-xs text-gray-500">
                      {t("settings.apiKeyReadOnlyDesc")}
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isReadOnly}
                      onChange={(e) => setIsReadOnly(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-300 dark:bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>

                <button type="submit" disabled={creatingToken || !newTokenName.trim()} className="w-full h-10 rounded-lg bg-primary text-white keep-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 shadow-xs">
                  {creatingToken ? <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  <span>{creatingToken ? t("settings.patCreating") : t("settings.patCreateBtn")}</span>
                </button>
                <p className="font-mono text-xs text-gray-500 text-center">{t("settings.patLimitHint")}</p>
              </form>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">{t("settings.patIssuedTitle")}</h4>
                  <button onClick={loadTokens} className="text-xs text-primary hover:underline">{t("settings.patRefresh")}</button>
                </div>
                {tokensLoading ? (
                  <div className="p-4 text-center font-mono text-xs text-gray-500">{t("settings.patLoading")}</div>
                ) : tokens.length === 0 ? (
                  <div className="p-4 rounded-md bg-black/[0.02] dark:bg-white/[0.03] border border-dashed border-black/10 dark:border-white/10 text-center font-mono text-xs text-gray-500">
                    {t("settings.patEmpty")}
                    <div className="mt-2">
                      <a href="/docs/api-overview" className="text-primary hover:underline inline-flex items-center gap-1">
                        <Terminal className="w-3 h-3" />
                        <span>{t("settings.patViewExamples")}</span>
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {tokens.map((tk) => (
                      <div key={tk.id} className="p-3 rounded-md bg-background border border-black/5 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">{tk.name}</span>
                            <span className="px-1.5 py-0.5 rounded-sm bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 font-mono text-[10px] text-gray-600 dark:text-gray-300">{tk.prefix}••••</span>
                            <span className={`px-1.5 py-0.5 rounded-sm font-mono text-[10px] border ${tk.scopes.includes("write") ? "bg-primary/10 text-primary border-primary/20" : "bg-black/5 dark:bg-white/10 text-gray-500 border-black/10 dark:border-white/10"}`}>
                              {tk.scopes.includes("write") ? t("settings.scopeReadWrite") : t("settings.scopeReadOnly")}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-gray-500 flex flex-wrap gap-2">
                            <span>{t("settings.patCreatedAt", { time: new Date(tk.created_at).toLocaleString() })}</span>
                            {tk.last_used_at && <span>{t("settings.patLastUsedAt", { time: new Date(tk.last_used_at).toLocaleString() })}</span>}
                            {!tk.last_used_at && <span className="text-amber-600 dark:text-amber-400">{t("settings.patNeverUsed")}</span>}
                          </div>
                        </div>
                        <button onClick={() => handleDeleteToken(tk.id)} className="shrink-0 inline-flex items-center gap-1 px-2.5 h-7 rounded-md bg-red-500/10 text-red-600 dark:text-red-300 border border-red-500/20 hover:bg-red-500/15 text-xs font-medium self-start sm:self-auto">
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t("settings.patRevoke")}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "appearance" && (
            <div className="p-4 sm:p-5 space-y-3.5">
              <div className="p-3.5 rounded-md bg-background border border-black/5 dark:border-white/[0.06] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-500 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
                    <span>{t("theme.displayMode")}</span>
                  </span>
                  <span className="font-mono text-[10px] text-gray-400">{t("theme.themeLabel")}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 bg-black/[0.04] dark:bg-white/[0.04] p-0.5 rounded-md border border-black/[0.06] dark:border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setMode("dark")}
                    className={`py-2 rounded-md flex flex-col items-center gap-1 transition-all ${
                      mode === "dark" ? "bg-primary text-white keep-white shadow-xs font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{t("theme.dark")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("light")}
                    className={`py-2 rounded-md flex flex-col items-center gap-1 transition-all ${
                      mode === "light" ? "bg-primary text-white keep-white shadow-xs font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{t("theme.light")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("system")}
                    className={`py-2 rounded-md flex flex-col items-center gap-1 transition-all ${
                      mode === "system" ? "bg-primary text-white keep-white shadow-xs font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Laptop className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{t("theme.system")}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-black/[0.06] dark:border-white/[0.06]">
                  <span className="font-mono text-xs text-gray-500">{t("theme.accentLabel")}</span>
                  <span className="font-mono text-[11px] font-semibold text-gray-900 dark:text-white">{(() => { const cur = accents.find((a) => a.id === accent); return locale === "en-US" ? (cur?.enName || cur?.name) : (cur?.name || cur?.enName); })()}</span>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  {accents.map((item) => {
                    const active = accent === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setAccent(item.id)}
                        title={locale === "en-US" ? item.enName : item.name}
                        className={`flex-1 py-2 rounded-md border flex flex-col items-center gap-1 transition-all ${
                          active ? "bg-black/[0.04] dark:bg-white/[0.08] border-primary/40 text-gray-900 dark:text-white" : "bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/[0.06] text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full grid place-items-center shadow-2xs ${active ? "ring-2 ring-primary ring-offset-1 ring-offset-surface" : ""}`} style={{ backgroundColor: item.color }}>
                          {active && <Check className="w-3 h-3 text-white stroke-[3]" />}
                        </div>
                        <span className="text-[10px] font-medium truncate">{locale === "en-US" ? item.enName : item.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
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
                <label className="font-mono text-xs sm:text-sm text-gray-500 dark:text-gray-400">{t("settings.oldPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    placeholder={t("settings.oldPasswordPlaceholder")}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full pl-9 pr-3.5 h-10 bg-background border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-xs sm:text-sm text-gray-500 dark:text-gray-400">{t("settings.newPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder={t("settings.newPasswordPlaceholder")}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-9 pr-3.5 h-10 bg-background border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-xs sm:text-sm text-gray-500 dark:text-gray-400">{t("settings.confirmPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder={t("settings.confirmPasswordPlaceholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-3.5 h-10 bg-background border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
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
        </div>
      </main>

      {/* 邮箱验证弹窗 */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-surface border border-surfaceBorder rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-black/5 dark:border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 text-primary grid place-items-center">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                    {t("settings.verifyEmailTitle")}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono">
                    {user.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowVerifyModal(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {verifyModalError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 font-mono text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                <span>{verifyModalError}</span>
              </div>
            )}

            {verifyModalSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-xs flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                <span>{verifyModalSuccess}</span>
              </div>
            )}

            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {t("settings.verifyEmailModalDesc")}
            </p>

            <form onSubmit={handleVerifyEmail} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.verificationCodeLabel")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                    placeholder={t("settings.verificationCodePlaceholder")}
                    className="flex-1 h-10 px-3.5 bg-background border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white font-mono text-sm tracking-widest placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                  <button
                    type="button"
                    onClick={handleSendVerificationEmail}
                    disabled={sendingEmail || verifyCountdown > 0}
                    className="shrink-0 px-3.5 h-10 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] disabled:opacity-50 text-xs font-mono font-medium text-gray-700 dark:text-gray-200 border border-black/5 dark:border-white/5 transition-colors flex items-center gap-1.5"
                  >
                    {sendingEmail ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {verifyCountdown > 0
                        ? t("settings.resendCountdown", { count: verifyCountdown })
                        : (sendingEmail ? t("settings.sendingCode") : t("settings.sendCode"))}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/5 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setShowVerifyModal(false)}
                  className="px-4 h-9 rounded-lg border border-black/10 dark:border-white/10 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={verifyingEmail || verificationCode.length !== 6}
                  className="px-5 h-9 rounded-lg bg-primary text-white keep-white font-semibold text-xs flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50 shadow-xs"
                >
                  {verifyingEmail ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>{verifyingEmail ? t("settings.verifying") : t("settings.confirmVerify")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
