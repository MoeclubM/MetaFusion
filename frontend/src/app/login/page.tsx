"use client";

import React, { useEffect, useState, Suspense } from "react";
import { LoadingFallback } from "@/components/common/LoadingFallback";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/authContext";
import {
  fetchSetupStatus,
  fetchAuthSettings,
  registerAccount,
  normalizeSessionUser,
  PublicAuthSettings,
} from "@/lib/api";
import { authErrorText, httpStatusOf } from "@/lib/authErrors";
import { useI18n } from "@/i18n/I18nProvider";
import { getAuthLoginUrl, getAuthRegisterUrl, AUTH_SERVICE_URL } from "@/lib/services";
import { BrandMark } from "@/components/Logo";
import { PageContainer } from "@/components/ui/PageShell";
import { ThemePicker } from "@/components/ThemePicker";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import {
  User,
  Mail,
  Lock,
  KeyRound,
  ArrowRight,
  AlertCircle,
  Sparkles,
} from "lucide-react";

type AuthMode = "login" | "register";

// ?notice= 只认白名单里的稳定码：URL 里的文本绝不直接渲染。（改密成功后账号服务已删掉该账号
// 全部会话与 OAuth 令牌，设置页只能把用户送回这里，并说明为什么需要重新登录。）
const LOGIN_NOTICES: Record<string, string> = {
  password_changed: "auth.passwordChangedSignedOut",
  sessions_revoked: "auth.sessionsRevokedSignedOut",
};

const inputClass =
  "w-full pl-11 pr-3.5 h-11 max-sm:min-h-[44px] bg-black/[0.03] dark:bg-black/20 border border-line rounded-control text-text-strong text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, login } = useAuth();
  const { t } = useI18n();

  const tabParam = searchParams.get("tab");
  const inviteParam = searchParams.get("invite") || "";

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(inviteParam);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  // 实例准入能力由 GET /auth/settings 决定（开放注册 / 是否要邀请码 / 是否要邮箱验证），
  // 不写死在前端：未取到时按"未知"处理，提交结果以服务端为准。
  const [authSettings, setAuthSettings] = useState<PublicAuthSettings | null>(null);
  const [settingsState, setSettingsState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const tokenParam = searchParams.get("token") || searchParams.get("auth_token");
    if (tokenParam) {
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${tokenParam}` },
        credentials: "same-origin",
      })
        .then((r) => r.json())
        .then((u) => {
          if (u && u.id) {
            // 组与权限码必须一起进会话：只带 id/username/role 的话，can() 会静默退回
            // 角色兜底，持权限码但角色普通的管理员组在这里就被判成没权限。
            login(tokenParam, normalizeSessionUser(u));
            const redirectUrl = searchParams.get("redirect") || "/";
            router.replace(redirectUrl);
          }
        })
        .catch(() => {});
    }
  }, [searchParams, login, router]);

  useEffect(() => {
    fetchSetupStatus()
      .then((s) => setHasAdmin(s.has_admin))
      .catch(() => setHasAdmin(true));
  }, []);

  // 注册入口的可用性以实例设置为准：读不到时不禁用入口，但如实提示结果以服务端为准。
  useEffect(() => {
    let cancelled = false;
    fetchAuthSettings()
      .then((s) => {
        if (cancelled) return;
        setAuthSettings(s);
        setSettingsState("ready");
        const wantsRegister = tabParam === "register" || inviteParam !== "";
        if (!wantsRegister) return;
        if (s.registration_enabled === false) {
          setNotice(t("auth.registrationClosed"));
          return;
        }
        setMode("register");
      })
      .catch(() => {
        if (cancelled) return;
        setSettingsState("unavailable");
        if (tabParam === "register" || inviteParam !== "") setMode("register");
      });
    return () => {
      cancelled = true;
    };
    // tabParam/inviteParam 来自 URL，只在挂载时读一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // 带 ?notice=<稳定码> 进来时给出说明（未识别的码忽略：不拿 URL 文案直接渲染）
  useEffect(() => {
    const code = searchParams.get("notice");
    const key = code ? LOGIN_NOTICES[code] : undefined;
    if (key) setNotice(t(key));
  }, [searchParams, t]);

  // 等鉴权状态初始化完成再判断，避免 /auth/me 未返回时误判为未登录而闪跳
  useEffect(() => {
    if (!loading && user) {
      const redirectUrl = searchParams.get("redirect") || "/";
      router.replace(redirectUrl);
    }
  }, [loading, user, router, searchParams]);

  const registrationClosed = authSettings?.registration_enabled === false;
  const inviteRequired = authSettings?.invite_required === true;
  const showInviteField = inviteRequired || inviteCode !== "";

  const switchTo = (next: AuthMode) => {
    setError(null);
    setNotice(null);
    if (next === "register" && hasAdmin === false) {
      // 实例还没有管理员时注册入口就是首次初始化，交给 /setup。
      router.push("/setup");
      return;
    }
    if (next === "register" && registrationClosed) {
      // 关闭注册是实例设置，不是前端故障：如实说明并留在登录表单。
      setNotice(t("auth.registrationClosed"));
      return;
    }
    setMode(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const redirectUrl = searchParams.get("redirect") || "/";

      if (mode === "register") {
        const res = await registerAccount({
          username: username.trim(),
          email: email.trim(),
          password,
          invite_code: inviteCode.trim() || undefined,
        });
        // 服务端注册成功即签发令牌，这里直接进入已登录态。
        login(res.access_token || res.token, normalizeSessionUser(res.user));
        router.replace(redirectUrl);
        return;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const res = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failed = new Error(res.error || "invalid_credentials") as Error & { status?: number };
        failed.status = response.status;
        throw failed;
      }
      login(res.token, normalizeSessionUser(res.user));
      router.replace(redirectUrl);
    } catch (err: any) {
      setError(authErrorText(err?.message, t, httpStatusOf(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-background relative flex flex-col p-4 sm:p-5">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" />
      <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none" />

      <PageContainer as="header" width="narrow" className="relative z-10 flex items-center justify-between shrink-0">
        <Link href="/landing" title="MetaFusion" className="flex items-center gap-2.5 group">
          <BrandMark size={28} withGlow idSuffix="login" />
          <span className="flex flex-col leading-none">
            <span className="font-display text-xl tracking-[-0.03em] text-text-strong">MetaFusion</span>
            <span className="font-mono text-[8px] tracking-[0.16em] text-gray-500 dark:text-white/35 mt-[2px]">SINCE 2026</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemePicker />
          <LocaleSwitcher compact />
        </div>
      </PageContainer>

      <PageContainer as="main" width="narrow" className="mf-enter relative z-10 flex-1 min-h-0 grid place-items-center py-3">
        <div className="w-full max-w-md max-h-full overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-3">
          {AUTH_SERVICE_URL.startsWith("http") && (
            <a
              href={
                mode === "register"
                  ? getAuthRegisterUrl(searchParams.get("redirect") || "/")
                  : getAuthLoginUrl(searchParams.get("redirect") || "/")
              }
              className="p-3.5 rounded-panel bg-primary text-white text-xs font-semibold flex items-center justify-between gap-2 hover:opacity-95 transition-opacity duration-fast shadow-md mf-focus"
            >
              <span>{t("auth.continueSso")}</span>
              <ArrowRight className="w-4 h-4" />
            </a>
          )}
          {hasAdmin === false && (
            <Link
              href="/setup"
              className="p-3.5 rounded-panel bg-primary/10 border border-primary/25 text-primary text-xs font-mono font-medium flex items-center justify-between gap-2 hover:bg-primary/15 transition-colors duration-fast group mf-focus"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 shrink-0 text-primary animate-pulse" />
                <span className="truncate">{t("login.oobeBanner")}</span>
              </div>
              <ArrowRight className="w-4 h-4 shrink-0 group-hover:translate-x-0.5 transition-transform duration-base ease-soft" />
            </Link>
          )}
          <div className="rounded-card border border-line bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden animate-scale-in">
            <div className="p-4 sm:p-5 pb-3 border-b border-line-subtle">
              <div className="min-w-0">
                <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-text-strong">
                  {mode === "register" ? t("auth.joinTitle") : t("auth.welcomeBack")}
                </h1>
                <p className="font-mono text-sm text-text-muted mt-0.5">
                  {mode === "register" ? t("auth.joinSubtitle") : t("auth.loginSubtitle")}
                </p>
              </div>

              <div className="flex gap-2 mt-3.5 bg-black/[0.04] dark:bg-white/[0.04] p-1 rounded-lg border border-line-subtle">
                <button
                  type="button"
                  onClick={() => switchTo("login")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors duration-fast mf-focus ${
                    mode === "login"
                      ? "bg-surface text-text-strong shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-strong"
                  }`}
                >
                  {t("nav.login")}
                </button>
                <button
                  type="button"
                  onClick={() => switchTo("register")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors duration-fast mf-focus ${
                    mode === "register"
                      ? "bg-surface text-text-strong shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-strong"
                  } ${registrationClosed ? "opacity-60" : ""}`}
                >
                  {t("auth.gate.genesisRegister")}
                </button>
              </div>
            </div>

            {error && (
              <div className="mx-4 sm:mx-5 mt-3.5 p-3.5 rounded-control bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-300 font-mono text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div className="mx-4 sm:mx-5 mt-3.5 p-3.5 rounded-control bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-300 font-mono text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="min-w-0">{notice}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-xs sm:text-sm text-text-muted">
                  {mode === "register" ? t("auth.username") : t("auth.gate.emailOrUsername")}
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    placeholder={
                      mode === "register"
                        ? t("auth.gate.usernamePlaceholderRegister")
                        : t("auth.gate.usernamePlaceholderLogin")
                    }
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {mode === "register" && (
                <div className="space-y-1.5 animate-fade-in">
                  <label className="font-mono text-xs sm:text-sm text-text-muted">{t("auth.email")}</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder={t("auth.emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="font-mono text-xs sm:text-sm text-text-muted flex items-center justify-between gap-2">
                  <span>{t("auth.password")}</span>
                  {mode === "register" && (
                    <span className="text-xs text-text-faint font-normal">{t("auth.registerPasswordHint")}</span>
                  )}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <input
                    type="password"
                    required
                    minLength={mode === "register" ? 12 : undefined}
                    maxLength={72}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {mode === "register" && showInviteField && (
                <div className="space-y-1.5 animate-fade-in">
                  <label className="font-mono text-xs sm:text-sm text-amber-600 dark:text-amber-300 flex items-center justify-between gap-2">
                    <span>{t("auth.inviteCode")}</span>
                    <span className="text-xs text-text-faint font-normal">
                      {inviteRequired ? t("auth.required") : t("auth.optional")}
                    </span>
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500" strokeWidth={1.5} />
                    <input
                      type="text"
                      required={inviteRequired}
                      placeholder={t("auth.inviteCodePlaceholder")}
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      className="w-full pl-11 pr-3.5 h-11 max-sm:min-h-[44px] bg-black/[0.03] dark:bg-black/20 border border-amber-500/30 rounded-control text-amber-600 dark:text-amber-300 font-mono text-sm placeholder:text-gray-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>
              )}

              {mode === "register" && settingsState === "unavailable" && (
                <p className="font-mono text-xs text-text-faint">{t("auth.settingsUnavailable")}</p>
              )}

              {mode === "register" && authSettings?.require_email_verification && (
                <p className="font-mono text-xs text-text-faint">{t("auth.emailVerificationRequired")}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-11 max-sm:min-h-[44px] rounded-control bg-primary text-white keep-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity duration-fast shadow-xs disabled:opacity-50 mt-2 mf-focus"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>
                      {mode === "register" ? t("auth.gate.createAccount") : t("auth.gate.secureLogin")}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingFallback className="h-[100dvh] bg-background grid place-items-center font-mono text-sm text-gray-500" />}>
      <LoginInner />
    </Suspense>
  );
}
