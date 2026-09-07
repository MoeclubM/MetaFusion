"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { api, Entity, local, title as entityTitle } from "@/components/catalog/api";
import { useCatalog } from "@/components/catalog/CatalogProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  useDefinitions,
  getFieldName,
  getTermName,
} from "@/lib/definitions";
import { entryLabel, mediumLabel, entryRowHeader } from "@/lib/mediaLabels";
import { AdaptiveCardCover } from "@/components/common/AdaptiveCardCover";
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  ChevronDown,
  Disc,
  ExternalLink,
  Film,
  Layers,
  Plus,
} from "lucide-react";

const COMPARE_MIN_SLOTS = 2;
const COMPARE_MAX_SLOTS = 6;
const COMPARE_BASKET_KEY = "metafusion_compare_basket";
const EDITION_TYPES = ["standard", "limited", "first_press", "regional", "reissue", "digital"] as const;

function readBasket(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COMPARE_BASKET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string" && x.trim() !== "");
  } catch {
    return [];
  }
}

function toggleBasket(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return readBasket();
  const current = readBasket();
  const next = current.includes(trimmed)
    ? current.filter((x) => x !== trimmed)
    : [...current, trimmed].slice(0, COMPARE_MAX_SLOTS);
  try {
    window.localStorage.setItem(COMPARE_BASKET_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}

function compareHref(ids: string[]): string {
  const cleaned = ids.map((x) => x.trim()).filter(Boolean);
  if (cleaned.length === 0) return "/compare";
  return `/compare?ids=${encodeURIComponent(cleaned.join(","))}`;
}

function formatDuration(totalSeconds?: number | null): string {
  if (!totalSeconds || totalSeconds <= 0) return "—";
  const s = Math.round(totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function attrText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function attrList(v: unknown): Record<string, any>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object") as Record<string, any>[];
}

function localizedText(v: unknown, locale: string): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const rec = v as Record<string, string>;
    return rec[locale] || rec[locale.split("-")[0]] || rec["zh-CN"] || rec["en-US"] || rec["en"] || "";
  }
  return "";
}

function workMediaType(work?: Entity | null): string {
  const names = [
    ...((work?.title || "") ? [work!.title] : []),
    ...(work?.types || []),
    ...Object.values(work?.translations || {}).map((x) => x?.title || ""),
  ]
    .join(" ")
    .toLowerCase();
  if (/anime|动画|animation/.test(names)) return "anime";
  if (/movie|film|电影|映画/.test(names)) return "movie";
  if (/(^|[^a-z])tv([^a-z]|$)|series|剧集|电视剧|drama/.test(names)) return "tv_series";
  if (/novel|book|小说|轻小说|light novel/.test(names)) return "novel";
  if (/comic|manga|漫画/.test(names)) return "comic";
  if (/audiobook|有声书|朗读/.test(names)) return "audiobook";
  if (/gallery|photobook|写真|画集|artbook/.test(names)) return "gallery";
  if (/music|album|single|音乐|专辑|单曲|song|ost|原声/.test(names)) return "music";
  return "";
}

type Occurrence = {
  release: Entity;
  medium: Entity;
  track: Entity;
  expression_id: string;
  position: number;
  locator?: Record<string, any> | null;
};

function Collapsible({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-3.5 sm:px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors min-h-[44px]"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-gray-900 dark:text-white">
          <span>{title}</span>
          {typeof count === "number" && (
            <span className="px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary font-mono text-[10px] font-bold">
              {count}
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          <span className="hidden sm:inline">{open ? t("common.collapse") : t("common.expand")}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.6} />
        </span>
      </button>
      {open && <div className="px-3.5 sm:px-4 py-3 border-t border-black/5 dark:border-white/[0.06]">{children}</div>}
    </section>
  );
}

export default function ReleaseDetailPage() {
  const params = useParams();
  const releaseId = params.id as string;
  const { t, locale } = useI18n();
  const { definition: catalogDef } = useCatalog();
  const { definitions: dynamicDefs } = useDefinitions();

  const [release, setRelease] = useState<Entity | null>(null);
  const [media, setMedia] = useState<{ medium: Entity; tracks: Entity[] }[]>([]);
  const [works, setWorks] = useState<Record<string, Entity>>({});
  const [expressions, setExpressions] = useState<Record<string, Entity>>({});
  const [occurrences, setOccurrences] = useState<Record<string, Occurrence[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [showBonus, setShowBonus] = useState(false);
  const [basket, setBasket] = useState<string[]>([]);
  const [basketNotice, setBasketNotice] = useState("");

  useEffect(() => {
    setBasket(readBasket());
  }, []);

  useEffect(() => {
    if (!releaseId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const rel = await api<Entity>(`/catalog/entities/${releaseId}/resolve`);
        if (rel.kind !== "release") throw new Error("invalid_kind");
        const mediums = await api<{ items: Entity[] }>(
          `/catalog/entities?kind=medium&release_id=${encodeURIComponent(String(rel.id || ""))}&limit=100`
        );
        const rows: { medium: Entity; tracks: Entity[] }[] = [];
        for (const m of mediums.items || []) {
          const tr = await api<{ items: Entity[] }>(
            `/catalog/entities?kind=track&medium_id=${encodeURIComponent(m.id!)}&limit=100`
          );
          rows.push({ medium: m, tracks: tr.items || [] });
        }
        rows.sort((a, b) => (a.medium.position || 0) - (b.medium.position || 0));
        rows.forEach((r) => r.tracks.sort((a, b) => (a.position || 0) - (b.position || 0)));
        const workIds = Array.from(new Set((rel.subjects || []).map((s) => s.work_id).filter(Boolean)));
        const workMap: Record<string, Entity> = {};
        await Promise.all(
          workIds.map(async (id) => {
            try {
              workMap[id] = await api<Entity>(`/catalog/entities/${id}`);
            } catch {
              /* ignore */
            }
          })
        );
        if (cancelled) return;
        setRelease(rel);
        setMedia(rows);
        setWorks(workMap);
        setActiveTab("all");
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "load_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [releaseId]);

  const expressionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of media) {
      for (const tr of row.tracks) {
        for (const c of tr.contents || []) {
          if (c.expression_id) ids.add(c.expression_id);
        }
      }
    }
    return Array.from(ids);
  }, [media]);

  useEffect(() => {
    if (expressionIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const exprMap: Record<string, Entity> = {};
      await Promise.all(
        expressionIds.slice(0, 200).map(async (id) => {
          try {
            exprMap[id] = await api<Entity>(`/catalog/entities/${id}`);
          } catch {
            /* ignore */
          }
        })
      );
      if (cancelled) return;
      setExpressions(exprMap);
      const occMap: Record<string, Occurrence[]> = {};
      await Promise.all(
        expressionIds.slice(0, 60).map(async (id) => {
          try {
            const r = await api<{ items: Occurrence[] }>(`/catalog/entities/${id}/occurrences`);
            occMap[id] = r.items || [];
          } catch {
            occMap[id] = [];
          }
        })
      );
      if (!cancelled) setOccurrences(occMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [expressionIds.join(",")]);

  const crossDurations = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of media) {
      for (const tr of row.tracks) {
        const dur = Number(tr.attributes?.duration);
        if (!dur || dur <= 0) continue;
        for (const c of tr.contents || []) {
          if (!c.expression_id) continue;
          if (!map.has(c.expression_id)) map.set(c.expression_id, new Map());
          map.get(c.expression_id)!.set(row.medium.id!, dur);
        }
      }
    }
    return map;
  }, [media]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <Navbar />
        <div className="relative z-10 min-h-screen grid place-items-center font-mono text-xs text-gray-500">{t("release.detail.loading")}</div>
      </div>
    );
  }

  if (!release) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <Navbar />
        <div className="relative z-10 max-w-7xl mx-auto px-4 py-20 text-center font-mono text-xs text-gray-500">
          {error || t("common.notFoundRelease")}
        </div>
      </div>
    );
  }

  const attrs = release.attributes || {};
  const editionType = attrText(attrs.edition_type);
  const country = attrText(attrs.country);
  const language = attrText(attrs.language);
  const channel = attrText((attrs as Record<string, any>).distribution_channel);
  const packaging = attrText(attrs.packaging);
  const catalogNo = attrText(attrs.catalog_number);
  const barcode = attrText(attrs.barcode);
  const editionDate = attrText(attrs.edition_date);
  const publisher = attrs.publisher;
  const publisherName =
    typeof publisher === "string" ? publisher : localizedText((publisher as any)?.name, locale) || attrText((publisher as any)?.id);
  const attachments = attrList(attrs.attachments);
  const storeBonuses = attrList(attrs.store_bonuses);
  const events = attrList(attrs.events);

  const primaryWorkId = release.subjects?.find((s) => s.role === "primary")?.work_id || release.subjects?.[0]?.work_id;
  const primaryWork = (primaryWorkId && works[primaryWorkId]) || null;
  const mediaType = workMediaType(primaryWork);
  const eLabel = entryLabel(mediaType, t);
  const mLabel = mediumLabel(mediaType, t);

  const editionLabel = editionType
    ? getTermName(dynamicDefs, "edition_type", editionType, locale) !== editionType
      ? getTermName(dynamicDefs, "edition_type", editionType, locale)
      : t(`release.editionType.${editionType}`) !== `release.editionType.${editionType}`
        ? t(`release.editionType.${editionType}`)
        : editionType
    : "";
  const packagingLabel =
    packaging && dynamicDefs
      ? getTermName(dynamicDefs, "packaging", packaging, locale) !== packaging
        ? getTermName(dynamicDefs, "packaging", packaging, locale)
        : packaging
      : packaging;

  const formatGroups = useMemo(() => {
    const groups = new Map<string, typeof media>();
    for (const row of media) {
      const fmt = attrText(row.medium.attributes?.format) || "unknown";
      if (!groups.has(fmt)) groups.set(fmt, []);
      groups.get(fmt)!.push(row);
    }
    return Array.from(groups.entries());
  }, [media]);

  const visibleGroups = activeTab === "all" ? formatGroups : formatGroups.filter(([fmt]) => fmt === activeTab);
  const bonusGroups = showBonus ? visibleGroups : visibleGroups.map(([fmt, rows]) => [fmt, rows.filter((r) => attrText(r.medium.attributes?.role) !== "supplement")] as [string, typeof media]);
  const supplementGroups = visibleGroups.map(([fmt, rows]) => [fmt, rows.filter((r) => attrText(r.medium.attributes?.role) === "supplement")] as [string, typeof media]);

  const inBasket = basket.includes(release.id!);
  const basketFull = !inBasket && basket.length >= COMPARE_MAX_SLOTS;

  const onToggleBasket = () => {
    if (basketFull) {
      setBasketNotice(t("release.detail.compareBasketFull"));
      return;
    }
    setBasketNotice("");
    setBasket(toggleBasket(release.id!));
  };

  const releaseTitle = entityTitle(release, locale);

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <Navbar />
      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full space-y-5 flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          {primaryWork && (
            <>
              <Link href={`/works/${primaryWork.id}`} className="hover:text-primary transition-colors inline-flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" strokeWidth={1.6} />
                {entityTitle(primaryWork, locale)}
              </Link>
              <span className="text-gray-400 dark:text-white/20">/</span>
            </>
          )}
          <span className="text-gray-900 dark:text-white truncate">{releaseTitle}</span>
        </div>

        <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-wide">
                <span className="px-2 py-0.5 rounded-sm bg-primary text-white font-semibold">{t("release.detail.badge")}</span>
                {editionLabel && (
                  <span className="px-2 py-0.5 rounded-sm bg-violet-500/10 text-violet-600 dark:text-violet-300 border border-violet-500/25 font-semibold">
                    {editionLabel}
                  </span>
                )}
                {country && (
                  <span className="px-2 py-0.5 rounded-sm bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20">{country}</span>
                )}
                {packagingLabel && (
                  <span className="text-gray-500">{t("release.detail.packagingLabel")}{packagingLabel}</span>
                )}
                {catalogNo && <span className="text-gray-500 font-mono">{catalogNo}</span>}
                {barcode && <span className="text-gray-500">{t("release.detail.barcode", { code: barcode })}</span>}
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">{releaseTitle}</h1>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-gray-500">
                {country && <div className="flex gap-1"><dt>{t("release.detail.countryLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{country}</dd></div>}
                {language && <div className="flex gap-1"><dt>{t("release.detail.languageLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{language}</dd></div>}
                {channel && <div className="flex gap-1"><dt>{t("release.detail.channelLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{channel}</dd></div>}
                {editionDate && <div className="flex gap-1"><dt>{t("release.detail.dateLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{editionDate}</dd></div>}
                {publisherName && <div className="flex gap-1"><dt>{t("release.detail.publisherLabel")}</dt><dd className="text-gray-700 dark:text-gray-300">{publisherName}</dd></div>}
              </dl>
              {(release.subjects || []).length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Layers className="w-3 h-3 text-primary" strokeWidth={1.5} />
                  {(release.subjects || []).map((s) => {
                    const w = works[s.work_id];
                    if (!w) return null;
                    return (
                      <Link
                        key={`${s.work_id}-${s.role}`}
                        href={`/works/${s.work_id}`}
                        className="px-1.5 py-0.5 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-[11px] text-gray-700 dark:text-gray-300 hover:text-primary"
                      >
                        {entityTitle(w, locale)}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
              {release.pictures?.[0]?.url && (
                <div className="w-24 aspect-square rounded-md overflow-hidden border border-black/10 dark:border-white/10">
                  <AdaptiveCardCover src={release.pictures[0].url} alt={releaseTitle} fallbackIcon={<Disc className="w-6 h-6 text-gray-400" />} aspectClassName="w-full h-full" />
                </div>
              )}
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleBasket}
                  disabled={basketFull}
                  aria-pressed={inBasket}
                  className={`inline-flex items-center gap-1.5 h-8 max-sm:min-h-[44px] px-3 rounded-md border text-xs font-mono transition-colors ${
                    inBasket
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300"
                      : "bg-black/[0.03] dark:bg-white/[0.06] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:text-primary hover:border-primary/40 disabled:opacity-40"
                  }`}
                >
                  {inBasket ? <Check className="w-3.5 h-3.5" strokeWidth={1.6} /> : <ArrowRightLeft className="w-3.5 h-3.5" strokeWidth={1.6} />}
                  <span>{inBasket ? t("release.detail.compareAdded") : t("release.detail.compareAdd")}</span>
                </button>
                {basket.length > 0 && (
                  <Link
                    href={compareHref(basket)}
                    className="inline-flex items-center h-8 max-sm:min-h-[44px] px-3 rounded-md bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-white transition-all text-xs font-mono"
                  >
                    {t("release.detail.compareOpen", { count: basket.length })}
                  </Link>
                )}
              </span>
              {basketNotice && <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400">{basketNotice}</span>}
            </div>
          </div>
        </section>

        {formatGroups.length > 1 && (
          <nav aria-label={t("release.detail.formatTabs")} className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              aria-pressed={activeTab === "all"}
              className={`shrink-0 h-9 max-sm:min-h-[44px] px-3 rounded-md border font-mono text-xs transition-colors ${
                activeTab === "all"
                  ? "bg-primary text-white border-primary"
                  : "bg-surface border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-primary/40 hover:text-primary"
              }`}
            >
              {t("release.detail.tabAllFormats")}
            </button>
            {formatGroups.map(([fmt, rows]) => {
              const label = dynamicDefs ? getTermName(dynamicDefs, "format", fmt, locale) : fmt;
              const trackCount = rows.reduce((n, r) => n + r.tracks.length, 0);
              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setActiveTab(fmt)}
                  aria-pressed={activeTab === fmt}
                  className={`shrink-0 h-9 max-sm:min-h-[44px] px-3 rounded-md border font-mono text-xs transition-colors ${
                    activeTab === fmt
                      ? "bg-primary text-white border-primary"
                      : "bg-surface border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-primary/40 hover:text-primary"
                  }`}
                >
                  {label} · {trackCount}
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[11px] text-gray-500">{t("release.detail.mediumCount", { count: media.length })}</p>
          <label className="inline-flex items-center gap-2 font-mono text-[11px] text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBonus}
              onChange={(e) => setShowBonus(e.target.checked)}
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <span>{t("release.detail.showBonusDiscs")}</span>
          </label>
        </div>

        {media.length === 0 ? (
          <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-8 text-center font-mono text-xs text-gray-500">{t("release.detail.noMedium")}</div>
        ) : (
          <div className="space-y-4 sm:space-y-5">
            {(showBonus ? visibleGroups : bonusGroups).map(([fmt, rows]) => (
              <div key={fmt} className="space-y-4">
                {rows.map(({ medium, tracks }) => {
                  const fmtLabel = dynamicDefs ? getTermName(dynamicDefs, "format", fmt, locale) : fmt;
                  const role = attrText(medium.attributes?.role);
                  const mediumTitle = entityTitle(medium, locale);
                  const sorted = tracks.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
                  return (
                    <section key={medium.id} id={`medium-${medium.id}`} className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft">
                      <div className="px-3.5 sm:px-4 py-2.5 border-b border-black/5 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-black/[0.02] dark:bg-white/[0.02]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-6.5 h-6.5 grid place-items-center rounded-md bg-sky-500/10 border border-sky-500/20 shrink-0">
                            <Disc className="w-3.5 h-3.5 text-sky-500" strokeWidth={1.5} />
                          </span>
                          <span className="font-display text-sm font-bold tracking-tight text-gray-900 dark:text-white truncate">
                            {mLabel}{medium.position || ""} · {mediumTitle}
                          </span>
                          {fmtLabel && fmt !== "unknown" && (
                            <span className="hidden sm:inline font-mono text-[11px] text-gray-500 shrink-0">{fmtLabel}</span>
                          )}
                          {role === "supplement" && (
                            <span className="px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-mono text-[10px] shrink-0">
                              {t("release.detail.bonusDisc")}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-gray-400">#{String(medium.id).slice(0, 8)} · {t("release.detail.trackCount", { count: tracks.length })}</span>
                      </div>
                      {sorted.length > 0 ? (
                        <div className="overflow-x-auto">
                          <div className="px-3.5 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-gray-500">{entryRowHeader(mediaType, t)}</div>
                          <table className="w-full text-left text-xs min-w-[640px]">
                            <thead className="bg-black/[0.02] dark:bg-white/[0.02] border-y border-black/5 dark:border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-gray-500">
                              <tr>
                                <th className="py-2 px-3.5 w-12 font-medium">{t("release.detail.tablePosition")}</th>
                                <th className="py-2 px-3.5 font-medium">{t("release.detail.tableEntryTitle", { label: eLabel })}</th>
                                <th className="py-2 px-3.5 font-medium">{t("release.detail.tableMasterEntry")}</th>
                                <th className="py-2 px-3.5 font-medium">{t("release.detail.tableCredit")}</th>
                                <th className="py-2 px-3.5 text-right font-medium">{t("release.detail.tableDuration")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                              {sorted.map((tr) => {
                                const contents = tr.contents || [];
                                const firstExpr = contents[0]?.expression_id;
                                const expr = firstExpr ? expressions[firstExpr] : undefined;
                                const displayTitle =
                                  entityTitle(tr, locale) !== tr.title && entityTitle(tr, locale)
                                    ? entityTitle(tr, locale)
                                    : tr.title || (expr ? entityTitle(expr, locale) : "");
                                const overridden =
                                  !!expr && !!displayTitle && displayTitle !== entityTitle(expr, locale);
                                const cross = firstExpr ? crossDurations.get(firstExpr) : undefined;
                                const trWorkId = (tr as Entity).work_id || expr?.work_id;
                                const trWork = (trWorkId && works[trWorkId]) || null;
                                const showWorkBadge = trWork && primaryWorkId && trWork.id !== primaryWorkId;
                                const dur = Number(tr.attributes?.duration);
                                return (
                                  <tr key={tr.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                                    <td className="py-2 px-3.5 font-mono text-gray-500 tabular-nums whitespace-nowrap">{tr.number || tr.position}</td>
                                    <td className="py-2 px-3.5 font-medium text-gray-900 dark:text-white">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span>{displayTitle || t("release.detail.untitledTrack")}</span>
                                        {overridden && (
                                          <span className="text-amber-500 text-[10px]">[{t("release.detail.overridden")}]</span>
                                        )}
                                        {showWorkBadge && trWork && (
                                          <Link
                                            href={`/works/${trWork.id}`}
                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20 text-[10px] hover:bg-sky-500/20 transition-colors font-mono"
                                          >
                                            <Film className="w-2.5 h-2.5" />
                                            <span className="truncate max-w-[22ch]">{entityTitle(trWork, locale)}</span>
                                          </Link>
                                        )}
                                      </div>
                                      {cross && cross.size > 1 && (
                                        <div className="mt-0.5 font-mono text-[10px] font-normal text-gray-500">
                                          {t("release.detail.crossMediumDuration")}:{" "}
                                          {Array.from(cross.values()).map((s) => formatDuration(s)).join(" / ")}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2 px-3.5 text-gray-500 text-xs">
                                      {contents.length > 0 ? (
                                        <span className="inline-flex flex-wrap gap-1">
                                          {contents.map((c, i) => {
                                            const e = expressions[c.expression_id];
                                            return (
                                              <Link
                                                key={`${tr.id}-${c.expression_id}-${i}`}
                                                href={`/catalog/${c.expression_id}`}
                                                className="text-gray-700 dark:text-gray-300 hover:text-primary hover:underline transition-colors"
                                              >
                                                {e ? entityTitle(e, locale) : c.expression_id.slice(0, 8)}
                                              </Link>
                                            );
                                          })}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3.5 text-gray-500">
                                      {attrText(tr.attributes?.isrc) ? (
                                        <span className="font-mono text-[11px]">{attrText(tr.attributes?.isrc)}</span>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3.5 text-right font-mono text-gray-500 tabular-nums whitespace-nowrap">
                                      {formatDuration(dur > 0 ? dur : Number(expr?.attributes?.duration) || 0)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="px-3.5 py-4 font-mono text-[11px] text-gray-500">{t("release.detail.noTracks")}</div>
                      )}
                    </section>
                  );
                })}
              </div>
            ))}
            {!showBonus && supplementGroups.some(([, rows]) => rows.length > 0) && (
              <Collapsible title={t("release.detail.bonusDiscs")} count={supplementGroups.reduce((n, [, rows]) => n + rows.length, 0)}>
                <div className="space-y-3">
                  {supplementGroups.map(([fmt, rows]) =>
                    rows.map(({ medium, tracks }) => {
                      const fmtLabel = dynamicDefs ? getTermName(dynamicDefs, "format", fmt, locale) : fmt;
                      return (
                        <div key={medium.id} className="rounded-md border border-black/10 dark:border-white/10 p-3">
                          <div className="flex items-center gap-2 text-xs font-semibold text-gray-900 dark:text-white">
                            <Disc className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
                            <span className="truncate">{entityTitle(medium, locale)}</span>
                            {fmtLabel && fmt !== "unknown" && <span className="font-mono text-[10px] font-normal text-gray-500">{fmtLabel}</span>}
                            <span className="font-mono text-[10px] font-normal text-gray-500">{t("release.detail.trackCount", { count: tracks.length })}</span>
                          </div>
                          <div className="mt-2 space-y-1">
                            {tracks.slice().sort((a, b) => (a.position || 0) - (b.position || 0)).map((tr) => (
                              <div key={tr.id} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-gray-500 w-8 shrink-0">{tr.number || tr.position}</span>
                                <span className="text-gray-800 dark:text-gray-200 truncate">{entityTitle(tr, locale) || tr.title}</span>
                                <span className="ml-auto font-mono text-[11px] text-gray-500 shrink-0">{formatDuration(Number(tr.attributes?.duration) || 0)}</span>
                              </div>
                            ))}
                          </div>
                          <Link href={`#medium-${medium.id}`} className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                            {t("release.detail.viewBonusDisc")} <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                          </Link>
                        </div>
                      );
                    })
                  )}
                </div>
              </Collapsible>
            )}
          </div>
        )}

        {expressionIds.length > 0 && (
          <Collapsible title={t("release.detail.sameRecordingTitle")} count={expressionIds.length}>
            <div className="overflow-x-auto -mx-3.5 sm:-mx-4 px-3.5 sm:px-4">
              <table className="w-full text-left text-xs min-w-[720px]">
                <thead className="font-mono text-[10px] uppercase tracking-wider text-gray-500 border-b border-black/5 dark:border-white/[0.06]">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t("release.detail.sameRecordingExpr")}</th>
                    <th className="py-2 pr-3 font-medium">{t("release.detail.sameRecordingRelease")}</th>
                    <th className="py-2 pr-3 font-medium">{t("release.detail.sameRecordingMedium")}</th>
                    <th className="py-2 pr-3 font-medium">{t("release.detail.sameRecordingTrack")}</th>
                    <th className="py-2 text-right font-medium">{t("release.detail.tableDuration")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                  {expressionIds.slice(0, 60).map((exprId) => {
                    const occ = occurrences[exprId] || [];
                    const expr = expressions[exprId];
                    if (occ.length === 0) {
                      return (
                        <tr key={exprId}>
                          <td className="py-2 pr-3 text-gray-900 dark:text-white">{expr ? entityTitle(expr, locale) : exprId.slice(0, 8)}</td>
                          <td colSpan={4} className="py-2 font-mono text-[11px] text-gray-400">{t("release.detail.sameRecordingEmpty")}</td>
                        </tr>
                      );
                    }
                    return occ.slice(0, 8).map((o, i) => (
                      <tr key={`${exprId}-${i}`}>
                        {i === 0 ? (
                          <td rowSpan={Math.min(occ.length, 8)} className="py-2 pr-3 text-gray-900 dark:text-white align-top">
                            {expr ? entityTitle(expr, locale) : exprId.slice(0, 8)}
                          </td>
                        ) : null}
                        <td className="py-2 pr-3">
                          <Link href={`/releases/${o.release.id}`} className="text-primary hover:underline">
                            {entityTitle(o.release, locale)}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-gray-500">{entityTitle(o.medium, locale)}</td>
                        <td className="py-2 pr-3 font-mono text-gray-500">
                          #{o.track.number || o.track.position} {entityTitle(o.track, locale)}
                        </td>
                        <td className="py-2 text-right font-mono text-gray-500 tabular-nums">
                          {formatDuration(Number(o.track.attributes?.duration) || 0)}
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </Collapsible>
        )}

        <div className="space-y-3">
          {attachments.length > 0 && (
            <Collapsible title={t("release.detail.attachments")} count={attachments.length}>
              <ul className="space-y-2">
                {attachments.map((a, i) => (
                  <li key={i} className="text-xs text-gray-700 dark:text-gray-300">
                    <span className="font-medium">{localizedText(a.label, locale) || t("release.detail.attachmentItem", { index: i + 1 })}</span>
                    {a.quantity != null && a.quantity !== "" && <span className="font-mono text-gray-500"> × {String(a.quantity)}</span>}
                    {attrText(a.condition) && <span className="block font-mono text-[11px] text-gray-500">{attrText(a.condition)}</span>}
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
          {storeBonuses.length > 0 && (
            <Collapsible title={t("release.detail.storeBonuses")} count={storeBonuses.length}>
              <ul className="space-y-2">
                {storeBonuses.map((b, i) => (
                  <li key={i} className="text-xs text-gray-700 dark:text-gray-300">
                    <span className="font-medium">{localizedText(b.label, locale) || t("release.detail.attachmentItem", { index: i + 1 })}</span>
                    <span className="ml-2 font-mono text-[11px] text-gray-500">
                      {[attrText(b.channel), attrText(b.region), attrText(b.condition)].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
          {events.length > 0 && (
            <Collapsible title={t("release.detail.releaseEvents")} count={events.length}>
              <ul className="space-y-2">
                {events.map((e, i) => (
                  <li key={i} className="text-xs text-gray-700 dark:text-gray-300">
                    <span className="font-medium">{localizedText(e.label, locale) || t("release.detail.attachmentItem", { index: i + 1 })}</span>
                    <span className="ml-2 font-mono text-[11px] text-gray-500">
                      {[attrText(e.date), attrText(e.region), attrText(e.time_zone), attrText(e.channel)].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
        </div>

        {(catalogDef || dynamicDefs) && (
          <details className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface px-3.5 sm:px-4 py-2.5">
            <summary className="cursor-pointer font-mono text-[11px] text-gray-500 hover:text-primary min-h-[32px] flex items-center">
              {t("release.detail.comparableFields")}
            </summary>
            <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {Object.keys(attrs).map((k) => {
                const defs = dynamicDefs || catalogDef?.document;
                const field = (defs as any)?.fields?.[k];
                if (field && "comparable" in field && field.comparable === false) return null;
                const name =
                  getFieldName(dynamicDefs, k, locale) !== k
                    ? getFieldName(dynamicDefs, k, locale)
                    : local((catalogDef?.document.fields as any)?.[k]?.names, locale, "", k as string);
                const v = attrs[k];
                const text = typeof v === "string" || typeof v === "number" ? String(v) : Array.isArray(v) ? t("release.detail.listCount", { count: v.length }) : "—";
                if (["attachments", "store_bonuses", "events"].includes(k)) return null;
                return (
                  <div key={k} className="flex gap-2 min-w-0">
                    <dt className="font-mono text-gray-500 shrink-0">{name}</dt>
                    <dd className="text-gray-800 dark:text-gray-200 truncate">{text}</dd>
                  </div>
                );
              })}
            </dl>
          </details>
        )}

        <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          <Plus className="w-3 h-3" strokeWidth={1.6} />
          <Link href={`/catalog/${release.id}`} className="hover:text-primary transition-colors inline-flex items-center gap-1">
            {t("release.detail.openInCatalog")} <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
          </Link>
        </div>
      </main>
    </div>
  );
}
