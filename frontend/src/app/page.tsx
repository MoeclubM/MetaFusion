"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, ArrowRight, BookOpen } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { Definition, Entity, local, title } from "@/components/catalog-v2/api";
type Shelf = { code: string; names: Record<string, string>; items: Entity[]; failed?: boolean };
export default function HomePage() {
  const { t, locale } = useI18n();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setFailed(false);
      try {
        const response = await fetch("/api/catalog/definitions", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const definitions: Definition = await response.json();
        const types = Object.entries(definitions.document.types).filter(([, type]) => type.enabled && type.kinds.includes("work"));
        const next: Shelf[] = [];
        // Bound concurrency as administrators add more work types.
        for (let i = 0; i < types.length; i += 4) {
          next.push(...await Promise.all(types.slice(i, i + 4).map(async ([code, type]) => {
            const query = new URLSearchParams({ kind: "work", type: code, status: "published", limit: "6" });
            try {
              const res = await fetch(`/api/catalog/entities?${query}`, { signal: controller.signal });
              if (!res.ok) throw new Error();
              const data = await res.json();
              return { code, names: type.names, items: data.items || [] };
            } catch (error) {
              if (controller.signal.aborted) throw error;
              return { code, names: type.names, items: [], failed: true };
            }
          })));
        }
        if (!controller.signal.aborted) setShelves(next);
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [attempt]);
  return <div className="min-h-screen bg-background text-gray-100">
    <Navbar />
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <h1 className="sr-only">{t("browseHome.title")}</h1>
      <form action="/explore" className="relative max-w-2xl">
        <Search className="absolute left-4 top-3.5 w-5 h-5 text-gray-500" aria-hidden="true" />
        <input name="q" aria-label={t("browseHome.search")} placeholder={t("browseHome.search")} className="w-full bg-surface border border-white/10 rounded-xl py-3 pl-12 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        <button className="absolute right-2 top-2 rounded-lg px-4 py-1.5 bg-primary text-white text-sm">{t("browseHome.searchAction")}</button>
      </form>
      {loading ? <div role="status" className="py-16 text-gray-400">{t("browseHome.loading")}</div> : failed ? <div role="alert" className="py-12 space-y-3"><p>{t("browseHome.failed")}</p><button onClick={() => setAttempt(attempt + 1)} className="text-primary">{t("browseHome.retry")}</button></div> : <>
        <nav aria-label={t("browseHome.title")} className="flex flex-wrap gap-2">
          {shelves.map(shelf => <a key={shelf.code} href={`#shelf-${shelf.code}`} className="rounded-full border border-white/10 px-4 py-2 text-sm text-gray-300 hover:border-primary hover:text-primary">{local(shelf.names, locale, "", shelf.code)}</a>)}
        </nav>
        {shelves.length === 0 && <p className="text-gray-400">{t("browseHome.noTypes")}</p>}
        {shelves.map(shelf => <section key={shelf.code} id={`shelf-${shelf.code}`} className="scroll-mt-36 space-y-4">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
            <h2 className="text-lg font-semibold">{local(shelf.names, locale, "", shelf.code)}</h2>
            <Link href={`/explore?kind=work&type=${encodeURIComponent(shelf.code)}`} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-primary">{t("browseHome.viewAll")}<ArrowRight className="w-4 h-4" /></Link>
          </div>
          {shelf.failed ? <p role="alert" className="text-sm text-gray-400">{t("browseHome.failed")} <button className="text-primary" onClick={() => setAttempt(attempt + 1)}>{t("browseHome.retry")}</button></p> : shelf.items.length === 0 ? <p className="text-sm text-gray-500 py-5">{t("browseHome.empty")}</p> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5">
            {shelf.items.map(item => <Link key={item.id} href={`/catalog/${item.id}`} className="group min-w-0">
              <div className="aspect-[3/4] rounded-xl overflow-hidden bg-surface border border-white/10 flex items-center justify-center group-hover:border-primary/60 transition-colors">
                {item.pictures?.[0]?.url ? <img src={item.pictures[0].url} alt="" loading="lazy" className="w-full h-full object-contain" /> : <BookOpen className="w-9 h-9 text-gray-600" />}
              </div>
              <h3 className="text-sm leading-6 font-medium mt-3 line-clamp-2 group-hover:text-primary">{title(item, locale)}</h3>
            </Link>)}
          </div>}
        </section>)}
      </>}
    </main>
    <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-8 text-sm text-gray-500 border-t border-white/10 flex justify-between gap-4"><span>MetaFusion</span><Link href="/about" className="hover:text-primary">{t("browseHome.about")}</Link></footer>
  </div>;
}
