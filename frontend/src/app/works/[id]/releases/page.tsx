"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { fetchApi, Work, Release } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, Search, ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";

export default function WorkReleasesPage() {
  const params = useParams();
  const workId = params.id as string;
  const { t } = useI18n();
  const [work, setWork] = useState<Work | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workId) return;
    fetchApi<Work>(`/catalog/works/${workId}`).then(setWork).catch(()=>{});
  }, [workId]);

  const load = async (p: number, keyword: string) => {
    setLoading(true);
    const qs = new URLSearchParams();
    qs.set("work_id", workId);
    qs.set("page", String(p));
    qs.set("page_size", String(pageSize));
    if (keyword.trim()) qs.set("q", keyword.trim());
    try {
      const res = await fetchApi<{ items: Release[]; total: number }>(`/catalog/releases?${qs.toString()}`);
      setReleases(res.items || []);
      setTotal(res.total || 0);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { if (!workId) return; load(page, q); }, [workId, page, q]);

  const onSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); setQ(qInput); };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6 w-full space-y-5 flex-1">
        <div className="flex items-center gap-2 font-mono text-[11px] text-gray-500">
          <Link href={`/works/${workId}`} className="hover:text-white inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" strokeWidth={1.6} />
            {work?.title || t("work.releases.backToWork")}
          </Link>
          <span className="text-white/20">/</span>
          <span className="text-white">{t("work.releases.allReleases")}</span>
        </div>

        <div className="rounded-card border border-white/[0.06] bg-surface/70 backdrop-blur overflow-hidden">
          <div className="px-4 md:px-5 py-4 border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h1 className="font-display text-xl tracking-tight text-white">{t("work.releases.releaseCount", { count: total })}</h1>
            <form onSubmit={onSearch} className="relative w-full sm:w-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" strokeWidth={1.5} />
              <input value={qInput} onChange={(e)=>setQInput(e.target.value)} placeholder={t("work.detail.searchPlaceholder")} className="pl-9 pr-3 h-10 sm:h-9 w-full sm:w-56 bg-white/[0.04] border border-white/10 rounded-full text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-primary/40" />
            </form>
          </div>

          {loading ? (
            <div className="p-10 text-center font-mono text-xs text-gray-500">{t("common.loading")}</div>
          ) : releases.length === 0 ? (
            <div className="p-10 text-center font-mono text-xs text-gray-500">{t("work.releases.noReleases")}</div>
          ) : (
            <>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.03] border-b border-white/[0.06] font-mono text-[11px] tracking-wide text-gray-500">
                    <tr>
                      <th className="py-3 px-4 font-medium">{t("work.detail.tableRelease")}</th>
                      <th className="py-3 px-4 font-medium">{t("work.detail.tablePublisher")}</th>
                      <th className="py-3 px-4 font-medium">{t("work.detail.tableCatalogNo")}</th>
                      <th className="py-3 px-4 text-right font-medium">{t("work.detail.tableDate")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {releases.map((rel)=>(
                      <tr key={rel.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-4"><Link href={`/releases/${rel.id}`} className="font-semibold text-white hover:text-sky-200 inline-flex items-center gap-1">{rel.edition_name} <ArrowUpRight className="w-3 h-3 text-gray-500" strokeWidth={1.5} /></Link></td>
                        <td className="py-3 px-4 text-gray-400">{rel.publisher || "—"}</td>
                        <td className="py-3 px-4 font-mono text-gray-500">{rel.catalog_number || "—"}</td>
                        <td className="py-3 px-4 font-mono text-gray-400 text-right">{rel.edition_date ? new Date(rel.edition_date).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sm:hidden divide-y divide-white/[0.06]">
                {releases.map((rel)=>(<a key={rel.id} href={`/releases/${rel.id}`} className="block px-4 py-3.5 active:bg-white/[0.04]"><div className="flex items-start justify-between gap-3"><div className="min-w-0 space-y-1"><div className="font-semibold text-white text-sm line-clamp-2 inline-flex items-center gap-1">{rel.edition_name} <ArrowUpRight className="w-3 h-3 text-gray-500 shrink-0" strokeWidth={1.5} /></div><div className="font-mono text-[11px] text-gray-400 truncate">{rel.publisher || "—"} {rel.catalog_number ? "· " + rel.catalog_number : ""}</div><div className="font-mono text-[11px] text-gray-500">{rel.edition_date ? new Date(rel.edition_date).toLocaleDateString() : "—"}</div></div></div></a>))}
              </div>
              <div className="px-4 py-3 border-t border-white/[0.06] bg-white/[0.02] flex items-center justify-between">
                <span className="font-mono text-[11px] text-gray-500">{t("common.pagination", { page, total: totalPages })}</span>
                <div className="flex items-center gap-2">
                  <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="w-8 h-8 grid place-items-center rounded-full bg-white/[0.06] border border-white/10 disabled:opacity-40 hover:bg-white/[0.10]"><ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.6} /></button>
                  <button disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} className="w-8 h-8 grid place-items-center rounded-full bg-white/[0.06] border border-white/10 disabled:opacity-40 hover:bg-white/[0.10]"><ChevronRight className="w-3.5 h-3.5" strokeWidth={1.6} /></button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
