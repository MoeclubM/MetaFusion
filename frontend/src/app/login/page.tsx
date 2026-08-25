"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/authContext";
import { fetchApi, fetchSetupStatus } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
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

function LoginInner() {
 const router = useRouter();
 const searchParams = useSearchParams();
 const { user, loading, login } = useAuth();
 const { t } = useI18n();

 const tabParam = searchParams.get("tab");
 const [isRegister, setIsRegister] = useState(tabParam === "register");
 const [username, setUsername] = useState("");
 const [email, setEmail] = useState("");
 const [password, setPassword] = useState("");
 const [inviteCode, setInviteCode] = useState(searchParams.get("invite") || "");
 const [error, setError] = useState<string | null>(null);
 const [submitting, setSubmitting] = useState(false);
 const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);

 useEffect(() => {
   fetchSetupStatus()
     .then((s) => setHasAdmin(s.has_admin))
     .catch(() => setHasAdmin(true));
 }, []);

 // 等鉴权状态初始化完成再判断，避免 /auth/me 未返回时误判为未登录而闪跳
 useEffect(() => {
 if (!loading && user) {
 const redirectUrl = searchParams.get("redirect") || "/";
 router.replace(redirectUrl);
 }
 }, [loading, user, router, searchParams]);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setError(null);
 setSubmitting(true);
 try {
 const redirectUrl = searchParams.get("redirect") || "/";
      if (isRegister) {
        const res = await fetchApi<{ user: any; token: string; access_token?: string; refresh_token?: string }>("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            username: username.trim(),
            email: email.trim(),
            password,
            invite_code: inviteCode.trim() || undefined,
          }),
        });
        login(res.access_token || res.token, res.user, res.refresh_token);
        router.replace(redirectUrl);
      } else {
        const res = await fetchApi<{ user: any; token: string; access_token?: string; refresh_token?: string }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email_or_username: username.trim() || email.trim(),
            password,
          }),
        });
        login(res.access_token || res.token, res.user, res.refresh_token);
        router.replace(redirectUrl);
      }
 } catch (err: any) {
 setError(err.message || t("auth.requestFailed"));
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-background relative flex flex-col p-4 sm:p-5">
 <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" />
 <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
 <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none" />

 <header className="relative z-10 w-full max-w-5xl mx-auto flex items-center justify-between shrink-0">
 <Link href="/" className="flex items-center gap-2.5 group">
 <BrandMark size={28} withGlow idSuffix="login" />
 <span className="flex flex-col leading-none">
 <span className="font-display text-xl tracking-[-0.03em] text-gray-900 dark:text-white">MetaFusion</span>
 <span className="font-mono text-[8px] tracking-[0.16em] text-gray-500 dark:text-white/35 mt-[2px]">SINCE 2026</span>
 </span>
 </Link>
 <div className="flex items-center gap-2">
 <ThemePicker />
 <LocaleSwitcher compact />
 </div>
 </header>

 <main className="relative z-10 flex-1 min-h-0 grid place-items-center py-3">
 <div className="w-full max-w-md max-h-full overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-3">
 {hasAdmin === false && (
   <Link
     href="/setup"
     className="p-3.5 rounded-xl bg-primary/10 border border-primary/25 text-primary text-xs font-mono font-medium flex items-center justify-between gap-2 hover:bg-primary/15 transition-all group"
   >
     <div className="flex items-center gap-2 min-w-0">
       <Sparkles className="w-4 h-4 shrink-0 text-primary animate-pulse" />
       <span className="truncate">{t("login.oobeBanner")}</span>
     </div>
     <ArrowRight className="w-4 h-4 shrink-0 group-hover:translate-x-0.5 transition-transform" />
   </Link>
 )}
 <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden animate-scale-in">
	 <div className="p-4 sm:p-5 pb-3 border-b border-black/[0.06] dark:border-white/[0.06]">
	 <div className="min-w-0">
	 <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
	 {isRegister ? t("auth.joinTitle") : t("auth.welcomeBack")}
	 </h1>
	 <p className="font-mono text-sm text-gray-500 dark:text-gray-400 mt-0.5">
	 {isRegister ? t("auth.joinSubtitle") : t("auth.loginSubtitle")}
	 </p>
	 </div>

 <div className="flex gap-2 mt-3.5 bg-black/[0.04] dark:bg-white/[0.04] p-1 rounded-lg border border-black/[0.06] dark:border-white/[0.06]">
 <button
 type="button"
 onClick={() => {
 setIsRegister(false);
 setError(null);
 }}
 className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
 !isRegister
 ? "bg-surface text-gray-900 dark:text-white shadow-xs font-semibold"
 : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
 }`}
 >
 {t("nav.login")}
 </button>
 <button
 type="button"
 onClick={() => {
 setIsRegister(true);
 setError(null);
 }}
 className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
 isRegister
 ? "bg-surface text-gray-900 dark:text-white shadow-xs font-semibold"
 : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
 }`}
 >
 {t("auth.gate.genesisRegister")}
 </button>
 </div>
 </div>

 {error && (
 <div className="mx-4 sm:mx-5 mt-3.5 p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-300 font-mono text-sm flex items-center gap-2">
 <AlertCircle className="w-4 h-4 shrink-0" />
 <span>{error}</span>
 </div>
 )}

 <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
 <div className="space-y-1.5">
 <label className="font-mono text-xs sm:text-sm text-gray-600 dark:text-gray-400">
 {isRegister ? t("auth.username") : t("auth.gate.emailOrUsername")}
 </label>
 <div className="relative">
 <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
 <input
 type="text"
 required
 placeholder={isRegister ? t("auth.gate.usernamePlaceholderRegister") : t("auth.gate.usernamePlaceholderLogin")}
 value={username}
 onChange={(e) => setUsername(e.target.value)}
 className="w-full pl-11 pr-3.5 h-11 max-sm:min-h-[44px] bg-black/[0.03] dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary"
 />
 </div>
 </div>

 {isRegister && (
 <div className="space-y-1.5 animate-fade-in">
 <label className="font-mono text-xs sm:text-sm text-gray-600 dark:text-gray-400">
 {t("auth.email")} <span className="text-rose-500">*</span>
 </label>
 <div className="relative">
 <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
 <input
 type="email"
 required
 placeholder={t("auth.emailPlaceholder")}
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 className="w-full pl-11 pr-3.5 h-11 max-sm:min-h-[44px] bg-black/[0.03] dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary"
 />
 </div>
 </div>
 )}

 <div className="space-y-1.5">
 <label className="font-mono text-xs sm:text-sm text-gray-600 dark:text-gray-400">
 {t("auth.password")}
 </label>
 <div className="relative">
 <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" strokeWidth={1.5} />
 <input
 type="password"
 required
 placeholder="••••••••"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 className="w-full pl-11 pr-3.5 h-11 max-sm:min-h-[44px] bg-black/[0.03] dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:border-primary"
 />
 </div>
 </div>

 {isRegister && (
 <div className="space-y-1.5 animate-fade-in">
 <label className="font-mono text-xs sm:text-sm text-amber-600 dark:text-amber-300 flex items-center justify-between">
 <span>{t("auth.inviteCode")}</span>
 <span className="text-xs text-gray-500 font-normal">{t("auth.required")}</span>
 </label>
 <div className="relative">
 <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500" strokeWidth={1.5} />
 <input
 type="text"
 required
 placeholder={t("auth.inviteCodePlaceholder")}
 value={inviteCode}
 onChange={(e) => setInviteCode(e.target.value)}
 className="w-full pl-11 pr-3.5 h-11 max-sm:min-h-[44px] bg-black/[0.03] dark:bg-black/20 border border-amber-500/30 rounded-lg text-amber-600 dark:text-amber-300 font-mono text-sm placeholder:text-gray-500 focus:outline-none focus:border-amber-400"
 />
 </div>
 </div>
 )}

 <button
 type="submit"
 disabled={submitting}
 className="w-full h-11 max-sm:min-h-[44px] rounded-lg bg-primary text-white keep-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-xs disabled:opacity-50 mt-2"
 >
 {submitting ? (
 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
 ) : (
 <>
 <span>{isRegister ? t("auth.gate.activateAccount") : t("auth.gate.secureLogin")}</span>
 <ArrowRight className="w-4 h-4" />
 </>
 )}
 </button>
 </form>
 </div>
 </div>
 </main>
 </div>
 );
}

export default function LoginPage() {
 return (
 <Suspense fallback={<div className="h-[100dvh] bg-background grid place-items-center font-mono text-sm text-gray-500">Loading…</div>}>
 <LoginInner />
 </Suspense>
 );
}
