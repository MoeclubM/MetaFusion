"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchSetupStatus,
  performInitialSetup,
  SetupStatusResponse,
} from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
import { ThemePicker } from "@/components/ThemePicker";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import {
  ShieldCheck,
  Server,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Globe,
  Users,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Loader2,
  Sparkles,
  Sliders,
} from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useI18n();

  const [status, setStatus] = useState<SetupStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Form State
  const [username, setUsername] = useState("admin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [siteName, setSiteName] = useState("MetaFusion");
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [inviteRequired, setInviteRequired] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<any | null>(null);

  useEffect(() => {
    fetchSetupStatus()
      .then((res) => {
        setStatus(res);
      })
      .catch(() => {
        setStatus({
          is_initialized: false,
          has_admin: false,
          site_name: "MetaFusion",
          total_users: 0,
        });
      })
      .finally(() => {
        setLoadingStatus(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = username.trim();
    const trimmedEmail = email.trim();

    if (!trimmedUser || !trimmedEmail) {
      setError(t("setup.usernameLabel") + " / " + t("setup.emailLabel") + "不能为空");
      return;
    }

    if (password.length < 8) {
      setError(t("setup.passwordTooShort"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("setup.passwordsMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await performInitialSetup({
        username: trimmedUser,
        display_name: displayName.trim() || undefined,
        email: trimmedEmail,
        password,
        site_name: siteName.trim() || undefined,
        registration_enabled: registrationEnabled,
        invite_required: inviteRequired,
      });

      login(res.access_token || res.token, res.user, res.refresh_token);
      setSuccessResult(res);
    } catch (err: any) {
      setError(err?.message || "初始化失败，请检查网络或后端日志");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center font-mono text-sm text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
        <span>{t("common.loading")}</span>
      </div>
    );
  }

  // If already initialized and not currently showing success state
  if (status?.is_initialized && !successResult) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col items-center justify-center p-6 selection:bg-primary selection:text-white">
        <div className="absolute top-5 right-5 z-20 flex items-center gap-2">
          <ThemePicker />
          <LocaleSwitcher compact />
        </div>

        <div className="w-full max-w-md p-8 rounded-2xl bg-card border border-border shadow-2xl text-center space-y-6 animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary grid place-items-center mx-auto">
            <ShieldCheck className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
              {t("setup.alreadyInitTitle")}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {t("setup.alreadyInitDesc")}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              href="/login"
              className="flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-white keep-white font-semibold text-sm hover:opacity-90 transition-all shadow-md"
            >
              <span>{t("setup.goToLogin")}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/"
              className="flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-black/5 dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white hover:bg-black/10 dark:hover:bg-white/[0.12] font-medium text-sm transition-all"
            >
              <span>{t("setup.goToHome")}</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Success State
  if (successResult) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col items-center justify-center p-6 selection:bg-primary selection:text-white">
        <div className="absolute top-5 right-5 z-20 flex items-center gap-2">
          <ThemePicker />
          <LocaleSwitcher compact />
        </div>

        <div className="w-full max-w-lg p-8 rounded-3xl bg-card border border-emerald-500/30 shadow-2xl text-center space-y-6 animate-scale-up relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="w-20 h-20 rounded-3xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 grid place-items-center mx-auto shadow-lg shadow-emerald-500/10">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-mono text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>OOBE READY</span>
            </div>
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              {t("setup.successTitle")}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed max-w-md mx-auto">
              {t("setup.successDesc")}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/10 dark:border-white/10 font-mono text-xs text-left space-y-2">
            <div className="flex justify-between items-center text-gray-500">
              <span>Admin Username:</span>
              <span className="font-bold text-gray-900 dark:text-white">{successResult.user.username}</span>
            </div>
            <div className="flex justify-between items-center text-gray-500">
              <span>Admin Role:</span>
              <span className="text-primary font-bold">{successResult.user.role}</span>
            </div>
            <div className="flex justify-between items-center text-gray-500">
              <span>Genesis Invite Code:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">{successResult.user.invite_code || "MF-ADMIN-2026"}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              href="/admin"
              className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-primary text-white keep-white font-semibold text-sm hover:opacity-90 transition-all shadow-lg shadow-primary/25 cursor-pointer"
            >
              <span>{t("setup.enterAdmin")}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/home"
              className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-black/5 dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-900 dark:text-white hover:bg-black/10 dark:hover:bg-white/[0.12] font-medium text-sm transition-all cursor-pointer"
            >
              <span>{t("setup.enterHome")}</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Active Setup Form
  return (
    <div className="min-h-screen bg-background relative flex flex-col justify-between p-4 sm:p-8 selection:bg-primary selection:text-white">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/8 rounded-full blur-[140px] pointer-events-none" />

      {/* Floating Top-Right Controls */}
      <aside className="absolute top-5 right-5 z-20 flex items-center gap-2">
        <ThemePicker />
        <LocaleSwitcher compact />
      </aside>

      {/* Header */}
      <header className="relative z-10 w-full max-w-2xl mx-auto pt-6 text-center space-y-4">
        <div className="inline-block relative">
          <BrandMark size={56} withGlow={true} idSuffix="setup-header" className="mx-auto drop-shadow-md" />
        </div>
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary font-semibold">
            <Server className="w-3.5 h-3.5" />
            <span>{t("setup.tagline")}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            {t("setup.title")}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-lg mx-auto">
            {t("setup.subtitle")}
          </p>
        </div>
      </header>

      {/* Main Form Box */}
      <main className="relative z-10 w-full max-w-2xl mx-auto my-8">
        <form
          onSubmit={handleSubmit}
          className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-2xl space-y-8"
        >
          {/* Infrastructure Banner */}
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 flex items-start gap-3.5">
            <Server className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-bold text-gray-900 dark:text-white">
                {t("setup.instanceHealthy")}
              </div>
              <div className="text-gray-500 dark:text-gray-400">
                {t("setup.instanceHealthyDesc")}
              </div>
            </div>
          </div>

          {/* Section 1: Super Administrator */}
          <div className="space-y-4">
            <div className="border-b border-border pb-2.5 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              <h2 className="font-bold text-sm text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                {t("setup.adminSectionTitle")}
              </h2>
            </div>
            <p className="text-xs text-gray-500">
              {t("setup.adminSectionDesc")}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("setup.usernameLabel")} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t("setup.usernamePlaceholder")}
                    className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("setup.displayNameLabel")}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("setup.displayNamePlaceholder")}
                  className="w-full h-11 px-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("setup.emailLabel")} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("setup.emailPlaceholder")}
                    className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("setup.passwordLabel")} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("setup.passwordPlaceholder")}
                    className="w-full h-11 pl-10 pr-10 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("setup.confirmPasswordLabel")} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("setup.confirmPasswordPlaceholder")}
                    className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Instance Preferences */}
          <div className="space-y-4">
            <div className="border-b border-border pb-2.5 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" />
              <h2 className="font-bold text-sm text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                {t("setup.siteSettingsTitle")}
              </h2>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                {t("setup.siteNameLabel")}
              </label>
              <div className="relative">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder={t("setup.siteNamePlaceholder")}
                  className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <label className="p-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/10 dark:border-white/10 flex items-start gap-3 cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors">
                <input
                  type="checkbox"
                  checked={registrationEnabled}
                  onChange={(e) => setRegistrationEnabled(e.target.checked)}
                  className="mt-0.5 rounded text-primary focus:ring-primary h-4 w-4"
                />
                <div className="text-xs space-y-0.5">
                  <div className="font-bold text-gray-900 dark:text-white">
                    {t("setup.registrationLabel")}
                  </div>
                  <div className="text-gray-500">
                    {t("setup.registrationDesc")}
                  </div>
                </div>
              </label>

              <label className="p-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/10 dark:border-white/10 flex items-start gap-3 cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors">
                <input
                  type="checkbox"
                  checked={inviteRequired}
                  onChange={(e) => setInviteRequired(e.target.checked)}
                  className="mt-0.5 rounded text-primary focus:ring-primary h-4 w-4"
                />
                <div className="text-xs space-y-0.5">
                  <div className="font-bold text-gray-900 dark:text-white">
                    {t("setup.inviteLabel")}
                  </div>
                  <div className="text-gray-500">
                    {t("setup.inviteDesc")}
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-mono flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Action */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-2xl bg-primary text-white keep-white font-semibold text-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-xl shadow-primary/25 disabled:opacity-50 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("setup.submitting")}</span>
              </>
            ) : (
              <>
                <span>{t("setup.submitBtn")}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </main>

      {/* Minimal Footer */}
      <footer className="relative z-10 w-full max-w-2xl mx-auto text-center font-mono text-xs text-gray-400 dark:text-white/30 py-4">
        © 2026 MetaFusion · Out-of-Box Initialization Wizard
      </footer>
    </div>
  );
}
