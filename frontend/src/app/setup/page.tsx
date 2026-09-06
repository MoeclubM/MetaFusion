"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
export default function SetupPage() {
  const { t } = useI18n();
  const { refreshProfile } = useAuth();
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/setup").then(async res => { if (!res.ok) throw new Error(); setNeeded((await res.json()).needed); }).catch(() => setError(t("browseHome.failed"))); }, [t]);
  return <main className="max-w-lg mx-auto w-full px-5 py-16">
    <div className="flex justify-between items-center mb-10"><Link href="/about">MetaFusion</Link><LocaleSwitcher /></div>
    <h1 className="text-2xl font-semibold mb-4">{t("onboarding.title")}</h1>
    <p className="text-gray-400 text-sm leading-7 mb-8">{t("onboarding.description")}</p>
    {error && <p role="alert" className="text-rose-400 mb-5">{error}</p>}
    {needed === false ? <Link href="/account" className="text-primary">{t("landing.account")}</Link> : needed === null ? <p>{t("browseHome.loading")}</p> : <form className="space-y-5" onSubmit={async event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const username = String(data.get("username") || "").trim();
      const password = String(data.get("password") || "");
      if (password !== data.get("confirm")) { setError(t("onboarding.mismatch")); return; }
      setBusy(true); setError("");
      try {
        if (!created) {
          const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
          if (!res.ok) throw new Error(t("onboarding.failed"));
          setCreated(true);
        }
        const res = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
        if (!res.ok) throw new Error(t("onboarding.loginFailed"));
        await refreshProfile(); window.location.assign("/");
      } catch (err) { setError(err instanceof Error ? err.message : t("onboarding.failed")); }
      finally { setBusy(false); }
    }}>
      {[{ name: "username", type: "text", min: 2, max: 80 }, { name: "password", type: "password", min: 12, max: 72 }, { name: "confirm", type: "password", min: 12, max: 72 }].map(field => <label key={field.name} className="block text-sm space-y-2"><span>{t(`onboarding.${field.name}`)}</span><input name={field.name} type={field.type} minLength={field.min} maxLength={field.max} required autoComplete={field.type === "password" ? "new-password" : "username"} readOnly={created && field.name === "username"} className="block w-full rounded-lg border border-white/15 bg-surface px-3 py-3 focus:ring-2 focus:ring-primary outline-none" /></label>)}
      <p className="text-xs text-gray-400">{t("onboarding.passwordHelp")}</p><button disabled={busy} className="w-full rounded-lg bg-primary text-white py-3 disabled:opacity-50">{t(busy ? "browseHome.loading" : created ? "onboarding.signIn" : "onboarding.create")}</button>
    </form>}
  </main>;
}
