"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/lib/themeContext";
import { fetchApi, displayNameOf, ApiToken, listApiTokens, createApiToken, deleteApiToken } from "@/lib/api";
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
  const [profileSaving, setProfileSaving] = useState(false);

  // PAT state
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenScopes, setNewTokenScopes] = useState<string[]>(["read", "write"]);
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
    }
  }, [user?.id]);

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
        body: JSON.stringify({ display_name: displayName, bio }),
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
      setTokenError("名称不能为空");
      return;
    }
    setCreatingToken(true);
    setTokenError(null);
    setCreatedToken(null);
    try {
      const res = await createApiToken({ name: newTokenName.trim(), scopes: newTokenScopes });
      setCreatedToken(res.token);
      setCreatedTokenMeta({ id: res.id, name: res.name, prefix: res.prefix, scopes: res.scopes, created_at: res.created_at, updated_at: res.created_at, last_used_at: null, expires_at: res.expires_at });
      setNewTokenName("");
      await loadTokens();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTokenError(msg);
    } finally {
      setCreatingToken(false);
    }
  };

  const handleDeleteToken = async (id: string) => {
    if (!confirm("确定撤销该令牌？撤销后使用该令牌的应用将立即失效。")) return;
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
      <main className="relative z-10 max-w-3xl mx-auto px-4 py-5 w-full flex-1 space-y-5">
        <div className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-primary">
            <Settings className="w-3.5 h-3.5" />
            <span>ACCOUNT SETTINGS · ARCHIVE IDENTITY</span>
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
            <span className="w-7 h-7 rounded-sm bg-primary/10 border border-primary/20 text-primary grid place-items-center">
              <Settings className="w-4 h-4" strokeWidth={1.7} />
            </span>
            <span>{t("settings.title")}</span>
          </h1>
          <p className="font-mono text-[11px] text-gray-500">{t("settings.subtitle")}</p>
        </div>

        <div className="flex gap-1 p-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] w-fit overflow-x-auto">
          <button
            onClick={() => {
              setActiveTab("profile");
              setError(null);
              setSuccess(null);
            }}
            className={`px-3 h-7 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
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
            className={`px-3 h-7 rounded-md text-xs font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${
              activeTab === "tokens" ? "bg-white dark:bg-white text-black font-semibold shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <KeyRound className="w-3 h-3" />
            <span>API 令牌</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("appearance");
              setError(null);
              setSuccess(null);
            }}
            className={`px-3 h-7 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
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
            className={`px-3 h-7 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === "password" ? "bg-white dark:bg-white text-black font-semibold shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {t("settings.tabPassword")}
          </button>
        </div>

        <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden">
          {activeTab === "profile" && (
            <div className="p-4 sm:p-5 space-y-3.5">
              {error && (
                <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 font-mono text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-xs flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{success}</span>
                </div>
              )}

              <div className="flex items-center gap-3 p-3 rounded-md bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/[0.06]">
                <div className="w-10 h-10 rounded-md bg-primary text-white keep-white font-display font-bold text-base grid place-items-center shrink-0 shadow-2xs">
                  {displayNameOf(user as unknown as { username: string; display_name?: string }).slice(0, 1).toUpperCase()}
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-white text-sm truncate">{displayNameOf(user as unknown as { username: string; display_name?: string })}</span>
                    <span className="px-1.5 py-0.2 rounded-sm bg-black/5 dark:bg-white/[0.08] border border-black/10 dark:border-white/10 font-mono text-[10px] text-gray-600 dark:text-gray-300 capitalize">
                      {user.role}
                    </span>
                    {displayNameOf(user as unknown as { username: string; display_name?: string }) !== user.username && (
                      <span className="font-mono text-[10px] text-gray-500">@{user.username}</span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-gray-500 truncate">{user.email || t("settings.unboundEmail")}</div>
                  <div className="font-mono text-[11px] text-gray-400 break-all">ID: {user.id}</div>
                </div>
              </div>

              <form onSubmit={handleProfileSave} className="space-y-3">
                <div className="space-y-1">
                  <label className="font-mono text-xs text-gray-500 dark:text-gray-400">{t("settings.displayName")}</label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t("settings.displayNamePlaceholder")}
                    maxLength={64}
                    className="w-full h-8.5 px-3 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white text-xs placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                  <p className="font-mono text-[11px] text-gray-500">{t("settings.displayNameHint")}</p>
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-xs text-gray-500 dark:text-gray-400">{t("settings.bioLabel")}</label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder={t("settings.bioPlaceholder")}
                    rows={3}
                    className="w-full px-3 py-2 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white text-xs placeholder:text-gray-400 focus:outline-none focus:border-primary/50 resize-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="w-full h-8.5 rounded-md bg-primary text-white keep-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50 shadow-xs"
                >
                  {profileSaving ? <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : null}
                  <span>{profileSaving ? t("settings.profileSaving") : t("settings.profileSave")}</span>
                </button>
              </form>

              <div className="grid gap-1.5 pt-2 border-t border-black/5 dark:border-white/[0.06]">
                <div className="p-2.5 rounded-md bg-background border border-black/5 dark:border-white/[0.06] flex items-center justify-between text-xs font-mono">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
                    <span>{t("settings.accountRole")}</span>
                  </span>
                  <span className="text-gray-900 dark:text-white font-medium capitalize">{user.role}</span>
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
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as unknown as "zh-CN" | "en-US")}
                    className="px-2 py-0.5 rounded-md bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.10] text-gray-700 dark:text-gray-200 border border-black/10 dark:border-white/10 text-xs font-sans cursor-pointer focus:outline-none"
                  >
                    <option value="zh-CN">{t("locale.chinese")} (Chinese)</option>
                    <option value="en-US">English (US)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === "tokens" && (
            <div className="p-4 sm:p-5 space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-amber-500" />
                  <span>个人访问令牌（PAT）</span>
                  <span className="px-1.5 py-0.5 rounded-sm bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20 font-mono text-[10px]">MusicBrainz 风格</span>
                </h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  用于外部应用与 Agent 的长期机器接入，格式 <span className="font-mono bg-black/5 dark:bg-white/10 px-1 rounded">mfp_</span>。明文仅在创建时展示一次，请妥善保存。支持 <span className="font-mono">Authorization: Bearer mfp_...</span> 或 <span className="font-mono">X-API-Key</span>。网页端全部功能均可经此令牌复现。
                </p>
                <Link href="/developers" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <Code2 className="w-3 h-3" />
                  <span>查看开发者文档</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {createdToken && (
                <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                    <Check className="w-4 h-4" />
                    <span>令牌已创建 — 请立即复制，关闭后将无法再次查看明文</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded bg-black/90 border border-white/10">
                    <Terminal className="w-3.5 h-3.5 text-white/60 shrink-0" />
                    <code className="flex-1 font-mono text-xs text-emerald-300 break-all">{createdToken}</code>
                    <button onClick={() => copyToken(createdToken)} className="shrink-0 inline-flex items-center gap-1 px-2.5 h-7 rounded bg-white text-black text-xs font-semibold hover:bg-gray-100">
                      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? "已复制" : "复制"}</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10">前缀: {createdTokenMeta?.prefix}</span>
                    <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10">scopes: {(createdTokenMeta?.scopes || []).join(", ")}</span>
                  </div>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300/80">提示：请将此令牌存入环境变量 MF_PAT，切勿提交到仓库。</p>
                </div>
              )}

              {tokenError && (
                <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 font-mono text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{tokenError}</span>
                </div>
              )}

              <form onSubmit={handleCreateToken} className="p-3 rounded-md bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/[0.06] space-y-3">
                <div className="space-y-1">
                  <label className="font-mono text-xs text-gray-500">令牌名称</label>
                  <input value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} placeholder="例如：my-agent / obsidian-sync" maxLength={64} className="w-full h-8.5 px-3 bg-background border border-black/10 dark:border-white/10 rounded-md text-xs focus:outline-none focus:border-primary/50" />
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-xs text-gray-500">权限范围（scopes）</label>
                  <div className="flex flex-wrap gap-1.5">
                    {["read", "write", "edit", "upload", "community"].map((sc) => {
                      const active = newTokenScopes.includes(sc);
                      return (
                        <button key={sc} type="button" onClick={() => setNewTokenScopes((prev) => (active ? prev.filter((x) => x !== sc) : [...prev, sc]))} className={`px-2.5 h-7 rounded-md text-xs font-mono border transition-colors ${active ? "bg-primary text-white border-primary" : "bg-white dark:bg-white/5 border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:border-primary/30"}`}>
                          {sc}
                        </button>
                      );
                    })}
                  </div>
                  <p className="font-mono text-[11px] text-gray-500">read 默认必选；write 隐含 edit/upload/community。Agent 建议 read+write。</p>
                </div>
                <button type="submit" disabled={creatingToken || !newTokenName.trim()} className="w-full h-8.5 rounded-md bg-primary text-white keep-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50 shadow-xs">
                  {creatingToken ? <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                  <span>{creatingToken ? "创建中…" : "创建令牌"}</span>
                </button>
                <p className="font-mono text-[11px] text-gray-500 text-center">每用户最多 10 个令牌，创建需 JWT 登录态（PAT 不可再创建 PAT）。</p>
              </form>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">已颁发令牌</h4>
                  <button onClick={loadTokens} className="text-xs text-primary hover:underline">刷新</button>
                </div>
                {tokensLoading ? (
                  <div className="p-4 text-center font-mono text-xs text-gray-500">加载中…</div>
                ) : tokens.length === 0 ? (
                  <div className="p-4 rounded-md bg-black/[0.02] dark:bg-white/[0.03] border border-dashed border-black/10 dark:border-white/10 text-center font-mono text-xs text-gray-500">
                    暂无令牌。创建后可用于 curl / SDK / Agent 接入。
                    <div className="mt-2">
                      <Link href="/developers" className="text-primary hover:underline inline-flex items-center gap-1">
                        <Terminal className="w-3 h-3" />
                        <span>查看接入示例</span>
                      </Link>
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
                            <span className="font-mono text-[10px] text-gray-500">scopes: {tk.scopes.join(", ")}</span>
                          </div>
                          <div className="font-mono text-[11px] text-gray-500 flex flex-wrap gap-2">
                            <span>创建: {new Date(tk.created_at).toLocaleString()}</span>
                            {tk.last_used_at && <span>最近使用: {new Date(tk.last_used_at).toLocaleString()}</span>}
                            {!tk.last_used_at && <span className="text-amber-600 dark:text-amber-400">未使用</span>}
                          </div>
                        </div>
                        <button onClick={() => handleDeleteToken(tk.id)} className="shrink-0 inline-flex items-center gap-1 px-2.5 h-7 rounded-md bg-red-500/10 text-red-600 dark:text-red-300 border border-red-500/20 hover:bg-red-500/15 text-xs font-medium self-start sm:self-auto">
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>撤销</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3 rounded-md bg-sky-500/10 border border-sky-500/20 space-y-1.5">
                <div className="font-mono text-xs font-semibold text-sky-900 dark:text-sky-100 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>快速校验</span>
                </div>
                <code className="block p-2 rounded bg-black/90 text-emerald-300 font-mono text-xs break-all">
                  curl /api/v1/catalog/works?inc=artists -H &quot;Authorization: Bearer mfp_...&quot; -H &quot;User-Agent: MyApp/1.0 (you@example.com)&quot;
                </code>
                <p className="text-[11px] text-sky-800 dark:text-sky-200/80">限流信息见响应头 X-RateLimit-*，超限返回 429。</p>
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
            <form onSubmit={handlePasswordChange} className="p-4 sm:p-5 space-y-3.5">
              {error && (
                <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 font-mono text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-xs flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{success}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-mono text-xs text-gray-500 dark:text-gray-400">{t("settings.oldPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    placeholder={t("settings.oldPasswordPlaceholder")}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full pl-8 pr-3 h-8.5 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white text-xs placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-xs text-gray-500 dark:text-gray-400">{t("settings.newPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder={t("settings.newPasswordPlaceholder")}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-8 pr-3 h-8.5 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white text-xs placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-xs text-gray-500 dark:text-gray-400">{t("settings.confirmPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder={t("settings.confirmPasswordPlaceholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-8 pr-3 h-8.5 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white text-xs placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-8.5 rounded-md bg-primary text-white keep-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50 mt-1 shadow-xs"
              >
                {submitting ? <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : t("settings.confirmChange")}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
