"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { fetchApi, Work } from "@/lib/api";
import { Entity, fetchAllPages, mapLimit, title as entityTitle } from "@/components/catalog/api";
import { useDefinitions, getTermName } from "@/lib/definitions";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, Search, ChevronLeft, ChevronRight, ArrowRightLeft, ArrowUpRight, X } from "lucide-react";

export default function WorkReleasesPage() {
  const params = useParams();
  const workId = params.id as string;
  const { t, locale } = useI18n();
  const { definitions } = useDefinitions();
  const [work, setWork] = useState<Work | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  // 每个发行版的介质格式计数（按实际 Medium 聚合），供筛选与规格列展示。
  const [formatCounts, setFormatCounts] = useState<Record<string, Record<string, number>>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [editionFilter, setEditionFilter] = useState("");
  const [formatFilter, setFormatFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [compareSelected, setCompareSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workId) return;
    fetchApi<Work>(`/catalog/works/${workId}`).then(setWork).catch(()=>{});
  }, [workId]);

  const load = async (keyword: string) => {
    setLoading(true);
    try {
      const fetched = await fetchAllPages<Entity>(`/catalog/entities?kind=release&work_id=${encodeURIComponent(workId)}`);
      let items = fetched;
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        items = items.filter((e) => (e.title || "").toLowerCase().includes(kw) || JSON.stringify(e.attributes || {}).toLowerCase().includes(kw));
      }
      // 介质格式按实际 Medium 全量聚合（并发受控），不再截断首屏/首格式。
      const counts = await mapLimit(items, 8, async (e) => {
        try {
          const ms = await fetchAllPages<Entity>(`/catalog/entities?kind=medium&release_id=${encodeURIComponent(e.id!)}`);
          const c: Record<string, number> = {};
          for (const m of ms) {
            const f = String(m.attributes?.format || "").trim();
            if (f) c[f] = (c[f] || 0) + 1;
          }
          return c;
        } catch { return {}; }
      });
      const fmtMap: Record<string, Record<string, number>> = {};
      items.forEach((e, i) => { fmtMap[e.id!] = counts[i] || {}; });
      setEntities(items);
      setFormatCounts(fmtMap);
      setTotal(items.length);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { if (!workId) return; load(q); }, [workId, q]);

  const onSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); setQ(qInput); };
  // format 候选来自实际 Medium 聚合：多介质发行版（CD＋BD）可被任一组成格式筛中。
  const formatCodesOf = (e: Entity): string[] => Object.keys(formatCounts[e.id!] || {});
  const formatSummaryOf = (e: Entity): string => {
    const entries = Object.entries(formatCounts[e.id!] || {});
    if (entries.length === 0) return "";
    const joiner = locale.startsWith("zh") ? "＋" : " + ";
    return entries
      .map(([code, n]) => {
        const label = getTermName(definitions, "format", code, locale);
        return `${label !== code ? label : code}×${n}`;
      })
      .join(joiner);
  };
  const filtered = useMemo(() => entities.filter((e) => {
    const edition = String(e.attributes?.edition_type || "").trim();
    const country = String(e.attributes?.country || "").trim();
    if (editionFilter && edition !== editionFilter) return false;
    if (formatFilter && !formatCodesOf(e).includes(formatFilter)) return false;
    if (countryFilter && country !== countryFilter) return false;
    return true;
  }), [entities, formatCounts, editionFilter, formatFilter, countryFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const editionOptions = useMemo(() => Array.from(new Set(entities.map((e) => String(e.attributes?.edition_type || "").trim()).filter(Boolean))), [entities]);
  const formatOptions = useMemo(() => Array.from(new Set(entities.flatMap(formatCodesOf).filter(Boolean))), [entities, formatCounts]);
  const countryOptions = useMemo(() => Array.from(new Set(entities.map((e) => String(e.attributes?.country || "").trim()).filter(Boolean))), [entities]);

  const toggleCompare = (id: string) => {
    setCompareSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 6) return prev;
      const next = [...prev, id];
      try {
        const basket: string[] = JSON.parse(window.localStorage.getItem("metafusion_compare_basket") || "[]");
        const merged = Array.from(new Set([...(Array.isArray(basket) ? basket : []), ...next])).slice(0, 6);
        window.localStorage.setItem("metafusion_compare_basket", JSON.stringify(merged));
      } catch { /* ignore */ }
      return next;
    });
  };

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

          <div className="px-4 md:px-5 py-2.5 border-b border-white/[0.06] flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
              <span className="font-mono">{t("work.detail.filterEdition")}</span>
              <select value={editionFilter} onChange={(e) => { setEditionFilter(e.target.value); setPage(1); }} className="h-9 px-2 rounded-md bg-white/[0.04] border border-white/10 text-xs text-white">
                <option value="">{t("common.all")}</option>
                {editionOptions.map((o) => <option key={o} value={o}>{getTermName(definitions, "edition_type", o, locale) !== o ? getTermName(definitions, "edition_type", o, locale) : o}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
              <span className="font-mono">{t("work.detail.filterFormat")}</span>
              <select value={formatFilter} onChange={(e) => { setFormatFilter(e.target.value); setPage(1); }} className="h-9 px-2 rounded-md bg-white/[0.04] border border-white/10 text-xs text-white">
                <option value="">{t("common.all")}</option>
                {formatOptions.map((o) => <option key={o} value={o}>{getTermName(definitions, "format", o, locale) !== o ? getTermName(definitions, "format", o, locale) : o}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
              <span className="font-mono">{t("work.detail.filterCountry")}</span>
              <select value={countryFilter} onChange={(e) => { setCountryFilter(e.target.value); setPage(1); }} className="h-9 px-2 rounded-md bg-white/[0.04] border border-white/10 text-xs text-white">
                <option value="">{t("common.all")}</option>
                {countryOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            {(editionFilter || formatFilter || countryFilter) && (
              <button onClick={() => { setEditionFilter(""); setFormatFilter(""); setCountryFilter(""); setPage(1); }} className="inline-flex items-center gap-1 h-9 px-2.5 rounded-md text-xs text-gray-400 hover:text-primary">
                <X className="w-3.5 h-3.5" strokeWidth={1.6} /><span>{t("work.detail.clearFilters")}</span>
              </button>
            )}
            {compareSelected.length > 0 && (
              <Link href={`/compare?ids=${encodeURIComponent(compareSelected.join(","))}`} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-white text-xs font-semibold hover:opacity-90">
                <ArrowRightLeft className="w-3.5 h-3.5" strokeWidth={1.6} /><span>{t("work.detail.compareOpenCount", { count: compareSelected.length })}</span>
              </Link>
            )}
          </div>

          {loading ? (
            <div className="p-10 text-center font-mono text-xs text-gray-500">{t("common.loading")}</div>
          ) : pageItems.length === 0 ? (
            <div className="p-10 text-center font-mono text-xs text-gray-500">{entities.length === 0 ? t("work.releases.noReleases") : t("work.detail.noFilterResult")}</div>
          ) : (
            <>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.03] border-b border-white/[0.06] font-mono text-[11px] tracking-wide text-gray-500">
                    <tr>
                      <th className="py-3 px-2 font-medium w-10" aria-label={t("work.detail.compareSelect")} />
                      <th className="py-3 px-4 font-medium">{t("work.detail.tableRelease")}</th>
                      <th className="py-3 px-4 font-medium">{t("work.detail.tableEdition")}</th>
                      <th className="py-3 px-4 font-medium">{t("work.detail.tableRegion")}</th>
                      <th className="py-3 px-4 font-medium">{t("work.detail.tablePackaging")}</th>
                      <th className="py-3 px-4 font-medium">{t("work.detail.tableSpec")}</th>
                      <th className="py-3 px-4 text-right font-medium">{t("work.detail.tableDate")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {pageItems.map((rel)=>{
                      const edition = String(rel.attributes?.edition_type || "").trim();
                      const country = String(rel.attributes?.country || "").trim();
                      const packaging = String(rel.attributes?.packaging || "").trim();
                      const catalogNo = String(rel.attributes?.catalog_number || "").trim();
                      const editionDate = String(rel.attributes?.edition_date || "").trim();
                      const fmt = formatSummaryOf(rel);
                      return (
                      <tr key={rel.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-2"><input type="checkbox" aria-label={t("work.detail.compareSelectName", { name: entityTitle(rel, locale) })} checked={compareSelected.includes(rel.id!)} onChange={() => toggleCompare(rel.id!)} className="w-4 h-4 rounded accent-primary cursor-pointer" /></td>
                        <td className="py-3 px-4"><Link href={`/releases/${rel.id}`} className="font-semibold text-white hover:text-sky-200 inline-flex items-center gap-1">{entityTitle(rel, locale)} <ArrowUpRight className="w-3 h-3 text-gray-500" strokeWidth={1.5} /></Link></td>
                        <td className="py-3 px-4 text-gray-400">{edition ? (getTermName(definitions, "edition_type", edition, locale) !== edition ? getTermName(definitions, "edition_type", edition, locale) : edition) : "—"}</td>
                        <td className="py-3 px-4 text-gray-400">{country || "—"}</td>
                        <td className="py-3 px-4 text-gray-400">{packaging || "—"}</td>
                        <td className="py-3 px-4 font-mono text-gray-500">{[fmt, catalogNo].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="py-3 px-4 font-mono text-gray-400 text-right whitespace-nowrap">{editionDate || "—"}</td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
              <div className="sm:hidden divide-y divide-white/[0.06]">
                {pageItems.map((rel)=>{
                  const edition = String(rel.attributes?.edition_type || "").trim();
                  const country = String(rel.attributes?.country || "").trim();
                  const packaging = String(rel.attributes?.packaging || "").trim();
                  const catalogNo = String(rel.attributes?.catalog_number || "").trim();
                  const editionDate = String(rel.attributes?.edition_date || "").trim();
                  const fmt = formatSummaryOf(rel);
                  return (
                  <div key={rel.id} className="px-4 py-3.5 flex items-start gap-2.5">
                    <input type="checkbox" aria-label={t("work.detail.compareSelectName", { name: entityTitle(rel, locale) })} checked={compareSelected.includes(rel.id!)} onChange={() => toggleCompare(rel.id!)} className="mt-1 w-5 h-5 rounded accent-primary cursor-pointer shrink-0" />
                    <Link href={`/releases/${rel.id}`} className="min-w-0 flex-1 space-y-1">
                      <div className="font-semibold text-white text-sm line-clamp-2">{entityTitle(rel, locale)}</div>
                      <div className="font-mono text-[11px] text-gray-400 truncate">{[edition, country, packaging].filter(Boolean).join(" · ") || t("work.detail.noEditionMeta")}</div>
                      <div className="font-mono text-[11px] text-gray-500 truncate">{[fmt, catalogNo, editionDate].filter(Boolean).join(" · ") || "—"}</div>
                    </Link>
                  </div>
                );})}
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
