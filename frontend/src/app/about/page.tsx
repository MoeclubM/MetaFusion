"use client";
import Link from "next/link";
import { ArrowRight, Library, Search, PenLine } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
export default function AboutPage() {
  const { t } = useI18n();
  const entries = [{ key: "browse", href: "/", icon: Library }, { key: "explore", href: "/explore", icon: Search }, { key: "contribute", href: "/new", icon: PenLine }];
  return <div className="min-h-screen bg-background text-gray-100"><Navbar />
    <main className="max-w-5xl mx-auto px-5 sm:px-8 py-12 sm:py-20">
      <p className="text-primary text-sm mb-4">MetaFusion</p>
      <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-tight">{t("landing.title")}</h1>
      <p className="text-gray-400 leading-8 max-w-2xl mt-6">{t("landing.description")}</p>
      <Link href="/" className="inline-flex items-center gap-3 rounded-xl bg-primary px-6 py-3 text-white mt-8">{t("landing.enter")}<ArrowRight className="w-4 h-4" /></Link>
      <section className="grid sm:grid-cols-3 gap-5 mt-14" aria-label={t("landing.start")}>
        {entries.map(({ key, href, icon: Icon }) => <Link key={key} href={href} className="rounded-2xl border border-white/10 bg-surface p-6 hover:border-primary/50 transition-colors"><Icon className="w-6 h-6 text-primary mb-5" /><h2 className="text-lg font-medium">{t(`landing.${key}`)}</h2><p className="text-sm text-gray-400 leading-7 mt-3">{t(`landing.${key}Description`)}</p></Link>)}
      </section>
      <div className="mt-12 pt-6 border-t border-white/10 flex flex-wrap gap-6 text-sm text-gray-400"><a href="/docs/catalog" className="hover:text-primary">{t("landing.guide")}</a><a href="/api/docs" className="hover:text-primary">{t("landing.api")}</a><Link href="/account" className="hover:text-primary">{t("landing.account")}</Link></div>
    </main>
  </div>;
}
