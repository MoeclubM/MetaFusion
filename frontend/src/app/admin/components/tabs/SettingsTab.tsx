"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchApi, testSendEmail } from "@/lib/api";
import {
  KeyRound,
  RefreshCw,
  Save,
  UserPlus,
  Shield,
  ShieldAlert,
  Mail,
  MailCheck,
  Send,
  Lock,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Sliders,
  Server,
  Sparkles,
} from "lucide-react";

export type SystemSettings = {
  registration_enabled: boolean;
  invite_required: boolean;
  require_email_verification: boolean;
  email_verification_enabled: boolean;
  rate_limit_enabled: boolean;
  auth_rate_limit_enabled: boolean;
  rate_limit_anon_per_min: number;
  rate_limit_auth_per_min: number;
  rate_limit_auth_endpoint_per_min: number;
  smtp_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_from_name: string;
  smtp_from_email: string;
  smtp_encryption: string;
};

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-surface border border-surfaceBorder transition-colors hover:border-black/15 dark:hover:border-white/15">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">{title}</div>
          <div className="text-[11px] text-gray-500 font-mono mt-0.5 leading-relaxed">{desc}</div>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 ${
          checked ? "bg-emerald-500" : "bg-black/[0.12] dark:bg-white/[0.12]"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
            checked ? "left-[21px]" : "left-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsTab() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string>("");

  // SMTP 密码显示与测试邮件
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [testEmailTarget, setTestEmailTarget] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailSuccess, setTestEmailSuccess] = useState("");
  const [testEmailError, setTestEmailError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetchApi<SystemSettings>("/admin/settings");
      setSettings({
        registration_enabled: r.registration_enabled !== false,
        invite_required: r.invite_required !== false,
        require_email_verification: r.require_email_verification === true,
        email_verification_enabled: r.email_verification_enabled !== false,
        rate_limit_enabled: r.rate_limit_enabled !== false,
        auth_rate_limit_enabled: r.auth_rate_limit_enabled !== false,
        rate_limit_anon_per_min: r.rate_limit_anon_per_min || 60,
        rate_limit_auth_per_min: r.rate_limit_auth_per_min || 600,
        rate_limit_auth_endpoint_per_min: r.rate_limit_auth_endpoint_per_min || 15,
        smtp_enabled: r.smtp_enabled === true,
        smtp_host: r.smtp_host || "",
        smtp_port: r.smtp_port || 587,
        smtp_username: r.smtp_username || "",
        smtp_password: r.smtp_password || "",
        smtp_from_name: r.smtp_from_name || "",
        smtp_from_email: r.smtp_from_email || "",
        smtp_encryption: r.smtp_encryption || "starttls",
      });
    } catch {
      setError(t("admin.settings.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetchApi<SystemSettings>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings({
        registration_enabled: r.registration_enabled !== false,
        invite_required: r.invite_required !== false,
        require_email_verification: r.require_email_verification === true,
        email_verification_enabled: r.email_verification_enabled !== false,
        rate_limit_enabled: r.rate_limit_enabled !== false,
        auth_rate_limit_enabled: r.auth_rate_limit_enabled !== false,
        rate_limit_anon_per_min: r.rate_limit_anon_per_min || 60,
        rate_limit_auth_per_min: r.rate_limit_auth_per_min || 600,
        rate_limit_auth_endpoint_per_min: r.rate_limit_auth_endpoint_per_min || 15,
        smtp_enabled: r.smtp_enabled === true,
        smtp_host: r.smtp_host || "",
        smtp_port: r.smtp_port || 587,
        smtp_username: r.smtp_username || "",
        smtp_password: r.smtp_password || "",
        smtp_from_name: r.smtp_from_name || "",
        smtp_from_email: r.smtp_from_email || "",
        smtp_encryption: r.smtp_encryption || "starttls",
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      setError(t("admin.settings.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleTestSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailTarget.trim()) return;
    setTestingEmail(true);
    setTestEmailSuccess("");
    setTestEmailError("");
    try {
      await testSendEmail(testEmailTarget.trim());
      setTestEmailSuccess(t("admin.settings.testEmailSuccess"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestEmailError(msg || t("admin.settings.testEmailFail"));
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 font-mono py-12 justify-center">
        <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-black/5 dark:border-white/5">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-500" />
            {t("admin.settings.title")}
          </h2>
          <p className="text-xs text-gray-500 font-mono mt-1">{t("admin.settings.subtitle")}</p>
        </div>

        {settings && (
          <div className="flex items-center gap-3 shrink-0">
            {savedAt && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {t("admin.settings.savedAt", { time: savedAt })}
              </span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 h-9 rounded-lg bg-amber-400 hover:bg-amber-300 dark:bg-amber-400 dark:hover:bg-amber-300 disabled:opacity-50 text-black text-xs font-semibold shadow-xs transition-colors"
            >
              {saving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saving ? t("admin.settings.saving") : t("admin.settings.save")}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-rose-600 dark:text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {settings && (
        <div className="space-y-8">
          {/* 1. 站点注册与准入控制 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1">
              <UserPlus className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-gray-800 dark:text-gray-200">
                {t("admin.settings.sectionAccess")}
              </h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed font-mono">
              {t("admin.settings.sectionAccessDesc")}
            </p>

            <div className="grid gap-2.5 pt-1">
              <ToggleRow
                icon={<UserPlus className="w-4 h-4 text-emerald-400" />}
                title={t("admin.settings.registration")}
                desc={t("admin.settings.registrationDesc")}
                checked={settings.registration_enabled}
                disabled={saving}
                onChange={(v) =>
                  setSettings((s) => (s ? { ...s, registration_enabled: v } : s))
                }
              />
              <ToggleRow
                icon={<KeyRound className="w-4 h-4 text-sky-400" />}
                title={t("admin.settings.inviteRequired")}
                desc={t("admin.settings.inviteRequiredDesc")}
                checked={settings.invite_required}
                disabled={saving}
                onChange={(v) =>
                  setSettings((s) => (s ? { ...s, invite_required: v } : s))
                }
              />
              <ToggleRow
                icon={<MailCheck className="w-4 h-4 text-purple-400" />}
                title={t("admin.settings.emailVerificationEnabled")}
                desc={t("admin.settings.emailVerificationEnabledDesc")}
                checked={settings.email_verification_enabled}
                disabled={saving}
                onChange={(v) =>
                  setSettings((s) => (s ? { ...s, email_verification_enabled: v } : s))
                }
              />
              <ToggleRow
                icon={<Shield className="w-4 h-4 text-amber-400" />}
                title={t("admin.settings.requireEmailVerification")}
                desc={t("admin.settings.requireEmailVerificationDesc")}
                checked={settings.require_email_verification}
                disabled={saving}
                onChange={(v) =>
                  setSettings((s) => (s ? { ...s, require_email_verification: v } : s))
                }
              />
            </div>
          </div>

          {/* 2. IP 限流与防刷控制 */}
          <div className="space-y-3 pt-4 border-t border-black/5 dark:border-white/5">
            <div className="flex items-center gap-2 pb-1">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-gray-800 dark:text-gray-200">
                {t("admin.settings.sectionRateLimit")}
              </h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed font-mono">
              {t("admin.settings.sectionRateLimitDesc")}
            </p>

            <div className="grid gap-2.5 pt-1">
              <ToggleRow
                icon={<Shield className="w-4 h-4 text-emerald-400" />}
                title={t("admin.settings.rateLimitEnabled")}
                desc={t("admin.settings.rateLimitEnabledDesc")}
                checked={settings.rate_limit_enabled}
                disabled={saving}
                onChange={(v) =>
                  setSettings((s) => (s ? { ...s, rate_limit_enabled: v } : s))
                }
              />
              <ToggleRow
                icon={<ShieldAlert className="w-4 h-4 text-rose-400" />}
                title={t("admin.settings.authRateLimitEnabled")}
                desc={t("admin.settings.authRateLimitEnabledDesc")}
                checked={settings.auth_rate_limit_enabled}
                disabled={saving}
                onChange={(v) =>
                  setSettings((s) => (s ? { ...s, auth_rate_limit_enabled: v } : s))
                }
              />
            </div>

            {/* 限流参数配置面板 */}
            <div className="p-4 rounded-xl bg-surface border border-surfaceBorder space-y-4 mt-2">
              <div className="text-xs font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-sky-400" />
                <span>限流阈值参数设置</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.rateLimitAnon")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={settings.rate_limit_anon_per_min}
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, rate_limit_anon_per_min: parseInt(e.target.value) || 60 } : s
                      )
                    }
                    className="w-full h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:border-primary/50"
                  />
                  <p className="text-[10px] text-gray-400 font-mono">
                    {t("admin.settings.rateLimitAnonDesc")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.rateLimitAuth")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50000}
                    value={settings.rate_limit_auth_per_min}
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, rate_limit_auth_per_min: parseInt(e.target.value) || 600 } : s
                      )
                    }
                    className="w-full h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:border-primary/50"
                  />
                  <p className="text-[10px] text-gray-400 font-mono">
                    {t("admin.settings.rateLimitAuthDesc")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.rateLimitAuthEndpoint")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={settings.rate_limit_auth_endpoint_per_min}
                    onChange={(e) =>
                      setSettings((s) =>
                        s
                          ? { ...s, rate_limit_auth_endpoint_per_min: parseInt(e.target.value) || 15 }
                          : s
                      )
                    }
                    className="w-full h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:border-primary/50"
                  />
                  <p className="text-[10px] text-gray-400 font-mono">
                    {t("admin.settings.rateLimitAuthEndpointDesc")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 3. SMTP 邮件服务配置 */}
          <div className="space-y-3 pt-4 border-t border-black/5 dark:border-white/5">
            <div className="flex items-center gap-2 pb-1">
              <Mail className="w-4 h-4 text-sky-500" />
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-gray-800 dark:text-gray-200">
                {t("admin.settings.sectionSmtp")}
              </h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed font-mono">
              {t("admin.settings.sectionSmtpDesc")}
            </p>

            <div className="grid gap-2.5 pt-1">
              <ToggleRow
                icon={<Server className="w-4 h-4 text-sky-400" />}
                title={t("admin.settings.smtpEnabled")}
                desc={t("admin.settings.smtpEnabledDesc")}
                checked={settings.smtp_enabled}
                disabled={saving}
                onChange={(v) =>
                  setSettings((s) => (s ? { ...s, smtp_enabled: v } : s))
                }
              />
            </div>

            <div className="p-4 sm:p-5 rounded-xl bg-surface border border-surfaceBorder space-y-4 mt-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.smtpHost")}
                  </label>
                  <input
                    type="text"
                    value={settings.smtp_host}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, smtp_host: e.target.value } : s))
                    }
                    placeholder={t("admin.settings.smtpHostPlaceholder")}
                    className="w-full h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.smtpPort")}
                  </label>
                  <input
                    type="number"
                    value={settings.smtp_port}
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, smtp_port: parseInt(e.target.value) || 587 } : s
                      )
                    }
                    placeholder={t("admin.settings.smtpPortPlaceholder")}
                    className="w-full h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.smtpEncryption")}
                  </label>
                  <select
                    value={settings.smtp_encryption}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, smtp_encryption: e.target.value } : s))
                    }
                    className="w-full h-9 px-2.5 bg-background border border-black/10 dark:border-white/10 rounded-lg text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:border-primary/50 cursor-pointer"
                  >
                    <option value="starttls">{t("admin.settings.smtpEncStarttls")}</option>
                    <option value="ssl">{t("admin.settings.smtpEncSsl")}</option>
                    <option value="none">{t("admin.settings.smtpEncNone")}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.smtpUsername")}
                  </label>
                  <input
                    type="text"
                    value={settings.smtp_username}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, smtp_username: e.target.value } : s))
                    }
                    placeholder={t("admin.settings.smtpUsernamePlaceholder")}
                    className="w-full h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.smtpPassword")}
                  </label>
                  <div className="relative">
                    <input
                      type={showSmtpPassword ? "text" : "password"}
                      value={settings.smtp_password}
                      onChange={(e) =>
                        setSettings((s) => (s ? { ...s, smtp_password: e.target.value } : s))
                      }
                      placeholder={t("admin.settings.smtpPasswordPlaceholder")}
                      className="w-full h-9 pl-3 pr-8 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    >
                      {showSmtpPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.smtpFromName")}
                  </label>
                  <input
                    type="text"
                    value={settings.smtp_from_name}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, smtp_from_name: e.target.value } : s))
                    }
                    placeholder={t("admin.settings.smtpFromNamePlaceholder")}
                    className="w-full h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {t("admin.settings.smtpFromEmail")}
                  </label>
                  <input
                    type="email"
                    value={settings.smtp_from_email}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, smtp_from_email: e.target.value } : s))
                    }
                    placeholder={t("admin.settings.smtpFromEmailPlaceholder")}
                    className="w-full h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-sm font-mono text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              {/* 发信测试子区域 */}
              <div className="pt-4 mt-2 border-t border-black/5 dark:border-white/5 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 dark:text-white">
                  <Send className="w-3.5 h-3.5 text-sky-500" />
                  <span>{t("admin.settings.testEmailTitle")}</span>
                </div>
                <p className="text-xs text-gray-500 font-mono">
                  {t("admin.settings.testEmailDesc")}
                </p>

                {testEmailSuccess && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-xs flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{testEmailSuccess}</span>
                  </div>
                )}

                {testEmailError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-300 font-mono text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{testEmailError}</span>
                  </div>
                )}

                <form onSubmit={handleTestSendEmail} className="flex gap-2">
                  <input
                    type="email"
                    value={testEmailTarget}
                    onChange={(e) => setTestEmailTarget(e.target.value)}
                    placeholder={t("admin.settings.testEmailTargetPlaceholder")}
                    className="flex-1 h-9 px-3 bg-background border border-black/10 dark:border-white/10 rounded-lg text-xs font-mono text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary/50"
                  />
                  <button
                    type="submit"
                    disabled={testingEmail || !testEmailTarget.trim()}
                    className="shrink-0 px-4 h-9 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white keep-white font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-xs"
                  >
                    {testingEmail ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {testingEmail
                        ? t("admin.settings.sendingTestEmail")
                        : t("admin.settings.sendTestEmailBtn")}
                    </span>
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* 底部保存条 */}
          <div className="flex items-center gap-3 pt-4 border-t border-black/5 dark:border-white/5">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-black text-xs font-semibold transition-colors shadow-xs"
            >
              {saving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saving ? t("admin.settings.saving") : t("admin.settings.save")}
            </button>
            {savedAt && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">
                {t("admin.settings.savedAt", { time: savedAt })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
