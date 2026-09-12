"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity, mapLimit, local, title } from "./api";
import { useCatalog } from "./CatalogProvider";
import { FieldValue, EntityLink, ErrorMessage } from "./Fields";
import { useDefinitions, getFieldName, getTermName } from "@/lib/definitions";
import { computeAlignment } from "./compareAlignment";
import { AdaptiveCardCover } from "@/components/common/AdaptiveCardCover";
import {
  ArrowRightLeft,
  Search,
  Plus,
  X,
  Disc,
  Trash2,
  Check,
  AlertCircle,
  Sparkles,
  Columns,
  Layers,
} from "lucide-react";

export const COMPARE_MIN_SLOTS = 2;
export const COMPARE_MAX_SLOTS = 6;
const COMPARE_BASKET_KEY = "metafusion_compare_basket";

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

export function Compare({ ids }: { ids: string }) {
  const { t, locale } = useI18n();
  const { definition: catalogDef } = useCatalog();
  const { definitions: dynamicDefs } = useDefinitions();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const initialList = useMemo(() => {
    const fromUrl = (ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromUrl.length > 0) return Array.from(new Set(fromUrl)).slice(0, COMPARE_MAX_SLOTS);
    return readBasket().slice(0, COMPARE_MAX_SLOTS);
  }, [ids]);

  const [selectedIds, setSelectedIds] = useState<string[]>(initialList);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recentReleases, setRecentReleases] = useState<Entity[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Entity[]>([]);
  const [searching, setSearching] = useState(false);
  const [customIdInput, setCustomIdInput] = useState("");
  const [highlightDiff, setHighlightDiff] = useState(true);

  const maxSlots = COMPARE_MAX_SLOTS;
  const slotIndices = useMemo(() => Array.from({ length: maxSlots }, (_, i) => i), [maxSlots]);

  useEffect(() => {
    setSelectedIds(initialList);
  }, [initialList.join(",")]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COMPARE_BASKET_KEY, JSON.stringify(selectedIds));
    } catch {
      /* ignore */
    }
  }, [selectedIds]);

  const updateSelected = (next: string[]) => {
    setSelectedIds(next);
    if (typeof window !== "undefined") {
      const url = next.length
        ? `/compare?ids=${encodeURIComponent(next.join(","))}`
        : "/compare";
      window.history.replaceState(null, "", url);
    }
  };

  const addId = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    if (selectedIds.includes(trimmed)) return;
    if (selectedIds.length >= maxSlots) {
      setError(t("catalog.compareMaxError"));
      return;
    }
    setError("");
    updateSelected([...selectedIds, trimmed]);
  };

  const removeId = (id: string) => {
    updateSelected(selectedIds.filter((x) => x !== id));
  };

  const clearAll = () => {
    updateSelected([]);
    setItems([]);
    setError("");
  };

  const focusSearch = () => {
    if (searchInputRef.current) {
      searchInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      searchInputRef.current.focus();
    }
  };

  useEffect(() => {
    api<{ items: Entity[] }>("/catalog/entities?kind=release&limit=12")
      .then((r) => setRecentReleases(r.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      api<{ items: Entity[] }>(`/catalog/entities?kind=release&q=${encodeURIComponent(q)}&limit=8`)
        .then((r) => setSearchResults(r.items || []))
        .catch((e) => setError(e.message))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (selectedIds.length < COMPARE_MIN_SLOTS) {
      setItems([]);
      setError("");
      return;
    }
    if (selectedIds.length > maxSlots) {
      setError(t("catalog.compareLimitError"));
      return;
    }
    setLoading(true);
    setError("");
    api<{ items: any[] }>(`/catalog/compare?ids=${selectedIds.join(",")}`)
      .then((r) => {
        setItems(r.items || []);
        setError("");
      })
      .catch((e) => {
        setItems([]);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [selectedIds, t, maxSlots]);

  const comparableFields = useMemo(() => {
    const defs = dynamicDefs || catalogDef?.document;
    const allKeys = Array.from(new Set(items.flatMap((x) => Object.keys(x.release?.attributes || {}))));
    return allKeys.filter((k) => {
      const field = (defs as any)?.fields?.[k];
      if (!field) return true;
      if (typeof field.comparable === "boolean") return field.comparable;
      if (typeof field.Comparable === "boolean") return field.Comparable;
      return true;
    });
  }, [items, dynamicDefs, catalogDef]);

  const sets = useMemo(() => {
    return items.map(
      (x) =>
        new Set<string>(
          x.media.flatMap((m: any) =>
            m.tracks.flatMap((tr: any) =>
              (tr.contents || []).map((c: any) => c.expression_id)
            )
          )
        )
    );
  }, [items]);

  // —— 语义对齐：以表达（录音/正文）为行对齐各版本收录情况，再派生
  // "同曲不同录音"（按表达所属 Work 聚合）与"仅载体差异"（收录集合一致但介质构成不同）。 ——
  const expressionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const x of items) {
      for (const m of x.media || []) {
        for (const tr of m.tracks || []) {
          for (const c of tr.contents || []) {
            if (c.expression_id) ids.add(c.expression_id);
          }
        }
      }
    }
    return Array.from(ids);
  }, [items]);

  const [exprEntities, setExprEntities] = useState<Record<string, Entity>>({});
  useEffect(() => {
    if (expressionIds.length === 0) {
      setExprEntities({});
      return;
    }
    let cancelled = false;
    (async () => {
      const map: Record<string, Entity> = {};
      await mapLimit(expressionIds, 8, async (id) => {
        try {
          map[id] = await api<Entity>(`/catalog/entities/${id}/resolve`);
        } catch {
          /* ignore */
        }
      });
      if (!cancelled) setExprEntities(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [expressionIds.join(",")]);

  const alignment = useMemo(
    () => computeAlignment(items, exprEntities),
    [items, exprEntities],
  );

  const renderAttrValue = (key: string, value: unknown): string => {
    if (value == null || value === "") return "—";
    if (typeof value === "string" || typeof value === "number") {
      if (key === "edition_type" || key === "format" || key === "packaging" || key === "role") {
        const term = getTermName(dynamicDefs, key === "format" ? "format" : key, String(value), locale);
        if (term !== String(value)) return term;
      }
      return String(value);
    }
    if (Array.isArray(value)) return t("release.detail.listCount", { count: value.length });
    if (typeof value === "object") {
      const rec = value as Record<string, string>;
      return rec[locale] || rec[locale.split("-")[0]] || rec["zh-CN"] || rec["en-US"] || "—";
    }
    return String(value);
  };

  const getReleaseSummary = (id: string) => {
    const matched = items.find((x) => x.release?.id === id) || recentReleases.find((x) => x.id === id);
    const releaseObj = matched?.release || matched;
    const releaseTitle = releaseObj ? title(releaseObj, locale) : `${id.slice(0, 8)}...`;
    const coverUrl = releaseObj?.pictures?.[0]?.url || "";
    const catalogNo = releaseObj?.attributes?.catalog_number || "";
    const format = releaseObj?.attributes?.format || "";
    return { title: releaseTitle, coverUrl, catalogNo, format, raw: releaseObj };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="p-2 rounded-xl bg-primary/10 text-primary">
              <ArrowRightLeft className="w-5 h-5" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground m-0">
              {t("catalog.compare")}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground m-0 max-w-2xl">
            {t("catalog.compareDesc")}
          </p>
        </div>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg border border-border hover:border-destructive/30 transition-all self-start sm:self-auto cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t("catalog.compareClear")}</span>
          </button>
        )}
      </div>

      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-sm text-foreground">
              {t("catalog.compareSlots")} ({selectedIds.length} / {maxSlots})
            </span>
            <div className="flex items-center gap-1.5">
              {slotIndices.map((i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    i < selectedIds.length
                      ? "bg-primary scale-110 shadow-xs"
                      : "bg-muted-foreground/20 border border-border"
                  }`}
                />
              ))}
            </div>
          </div>

          <div>
            {selectedIds.length < COMPARE_MIN_SLOTS && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <AlertCircle className="w-3.5 h-3.5" />
                {t("catalog.compareNeedMore", { count: COMPARE_MIN_SLOTS - selectedIds.length })}
              </span>
            )}
            {selectedIds.length >= COMPARE_MIN_SLOTS && selectedIds.length < maxSlots && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <Check className="w-3.5 h-3.5" />
                {t("catalog.compareReady")}
              </span>
            )}
            {selectedIds.length >= maxSlots && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                <Sparkles className="w-3.5 h-3.5" />
                {t("catalog.compareMaxReached")}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {slotIndices.map((index) => {
            const id = selectedIds[index];
            if (id) {
              const info = getReleaseSummary(id);
              return (
                <div
                  key={id}
                  className="relative group rounded-xl p-3 bg-surface hover:bg-surface-hover/50 border border-border hover:border-primary/40 shadow-xs hover:shadow-md transition-all flex flex-col justify-between overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="text-[11px] font-mono font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                      #{index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeId(id)}
                      className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors cursor-pointer"
                      title={t("catalog.compareRemove")}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="w-full aspect-square rounded-lg overflow-hidden mb-2 border border-border/60">
                    <AdaptiveCardCover
                      src={info.coverUrl}
                      alt={info.title}
                      fallbackIcon={<Disc className="w-7 h-7 text-muted-foreground/60" />}
                      aspectClassName="w-full h-full"
                    />
                  </div>

                  <div className="min-w-0">
                    <Link
                      href={`/releases/${id}`}
                      className="text-xs font-semibold text-foreground hover:text-primary line-clamp-2 leading-snug transition-colors"
                      title={info.title}
                    >
                      {info.title}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
                      {info.format ? (
                        <span className="px-1.5 py-0.2 rounded bg-muted/60 font-medium truncate">
                          {String(info.format)}
                        </span>
                      ) : null}
                      {info.catalogNo ? (
                        <span className="truncate font-mono">
                          {String(info.catalogNo)}
                        </span>
                      ) : null}
                      {!info.format && !info.catalogNo && (
                        <span className="font-mono">{id.slice(0, 8)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`empty-${index}`}
                onClick={focusSearch}
                className="border-2 border-dashed border-border/70 hover:border-primary/60 hover:bg-primary/5 rounded-xl p-3 flex flex-col items-center justify-center min-h-[160px] text-center transition-all cursor-pointer group"
              >
                <div className="w-9 h-9 rounded-full bg-muted/50 group-hover:bg-primary/10 text-muted-foreground group-hover:text-primary flex items-center justify-center mb-2 transition-all duration-200 group-hover:scale-110">
                  <Plus className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground/80 group-hover:text-primary transition-colors">
                  {t("catalog.compareSlotIndex")} #{index + 1}
                </span>
                <span className="text-[11px] text-muted-foreground mt-0.5 group-hover:text-foreground/70 transition-colors">
                  {t("catalog.compareSlotEmpty")}
                </span>
                <span className="text-[10px] text-muted-foreground/60 mt-2 px-1.5 py-0.5 rounded bg-muted/30 group-hover:bg-primary/10 group-hover:text-primary transition-colors line-clamp-1">
                  {t("catalog.compareSlotClickToAdd")}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {selectedIds.length < maxSlots && (
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base sm:text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            {t("catalog.compareSelectRelease")}
          </h2>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={t("catalog.compareSearchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 bg-background border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={t("catalog.compareUuidPlaceholder")}
                value={customIdInput}
                onChange={(e) => setCustomIdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customIdInput.trim()) {
                    addId(customIdInput.trim());
                    setCustomIdInput("");
                  }
                }}
                className="w-full sm:w-64 px-3.5 py-2.5 bg-background border border-border rounded-xl text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
              <button
                type="button"
                disabled={!customIdInput.trim()}
                onClick={() => {
                  addId(customIdInput.trim());
                  setCustomIdInput("");
                }}
                className="px-4 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-all inline-flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t("catalog.compareAdd")}</span>
              </button>
            </div>
          </div>

          {searching && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3">
              <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span>{t("catalog.loading")}</span>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t("catalog.compareSearchResults")} ({searchResults.length})
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {searchResults.map((r) => {
                  const isSelected = selectedIds.includes(r.id!);
                  const releaseTitle = title(r, locale);
                  const coverUrl = r.pictures?.[0]?.url;
                  const catNo = r.attributes?.catalog_number;
                  const fmt = r.attributes?.format;
                  return (
                    <div
                      key={r.id}
                      onClick={() => !isSelected && addId(r.id!)}
                      className={`group rounded-xl p-3 border transition-all flex items-center justify-between gap-3 ${
                        isSelected
                          ? "bg-surface/50 border-border opacity-70 cursor-default"
                          : "bg-surface hover:bg-surface-hover/60 border-border hover:border-primary/50 shadow-xs hover:shadow-sm cursor-pointer"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-border/60">
                          <AdaptiveCardCover
                            src={coverUrl}
                            alt={releaseTitle}
                            fallbackIcon={<Disc className="w-5 h-5 text-muted-foreground/60" />}
                            aspectClassName="w-full h-full"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                            {releaseTitle}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {catNo ? `${String(catNo)} · ` : ""}
                            {fmt ? String(fmt) : "Release"}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          addId(r.id!);
                        }}
                        className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                          isSelected
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-primary/10 text-primary hover:bg-primary hover:text-white"
                        }`}
                        title={isSelected ? t("catalog.compareAdded") : t("catalog.compareAdd")}
                      >
                        {isSelected ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedIds.length < maxSlots && searchResults.length === 0 && recentReleases.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <span className="text-xs font-bold text-foreground">
                  {t("catalog.compareDemoHint")}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("catalog.compareQuickPickTip")}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {recentReleases.slice(0, 8).map((r) => {
                  const isSelected = selectedIds.includes(r.id!);
                  const releaseTitle = title(r, locale);
                  const coverUrl = r.pictures?.[0]?.url;
                  const catNo = r.attributes?.catalog_number;
                  const fmt = r.attributes?.format;
                  return (
                    <div
                      key={r.id}
                      onClick={() => !isSelected && addId(r.id!)}
                      className={`group rounded-xl p-3 border transition-all duration-200 flex items-center justify-between gap-3 ${
                        isSelected
                          ? "bg-surface/50 border-border/70 opacity-60 cursor-default"
                          : "bg-surface hover:bg-surface-hover/70 border-border hover:border-primary/50 shadow-2xs hover:shadow-md cursor-pointer"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-border/60">
                          <AdaptiveCardCover
                            src={coverUrl}
                            alt={releaseTitle}
                            fallbackIcon={<Disc className="w-5 h-5 text-muted-foreground/60 group-hover:text-primary transition-colors" />}
                            aspectClassName="w-full h-full"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                            {releaseTitle}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {catNo ? `${String(catNo)} · ` : ""}
                            {fmt ? String(fmt) : "Release"}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          addId(r.id!);
                        }}
                        className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                          isSelected
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white"
                        }`}
                        title={isSelected ? t("catalog.compareAdded") : t("catalog.compareAdd")}
                      >
                        {isSelected ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      <ErrorMessage error={error} />
      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
          <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>{t("catalog.loading")}</span>
        </div>
      )}

      {items.length >= COMPARE_MIN_SLOTS && !loading && (
        <section className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-sm mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-base sm:text-lg font-bold text-foreground m-0">
              {t("catalog.compareContentAlignment")}
            </h2>
          </div>
          {alignment.perExpr.size === 0 ? (
            <p className="text-sm text-muted-foreground m-0">{t("catalog.compareNoContent")}</p>
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0 mb-2">
                  {t("catalog.compareSharedAll")} · {alignment.shared.length}
                </h3>
                {alignment.shared.length === 0 ? (
                  <p className="text-xs text-muted-foreground m-0">—</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {alignment.shared.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-foreground"
                      >
                        {exprEntities[id] ? title(exprEntities[id], locale) : <EntityLink id={id} />}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {alignment.partial.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0 mb-2">
                    {t("catalog.comparePartial")} · {alignment.partial.length}
                  </h3>
                  <ul className="space-y-1.5 m-0 p-0 list-none">
                    {alignment.partial.map(({ id, in: inSet }) => (
                      <li key={id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                        <span className="font-medium text-foreground">
                          {exprEntities[id] ? title(exprEntities[id], locale) : <EntityLink id={id} />}
                        </span>
                        <span className="text-muted-foreground">
                          {t("catalog.compareIncludedIn")}{" "}
                          {inSet.map((i) => title(items[i]?.release, locale)).join("、")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {alignment.workVariants.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0 mb-2">
                    {t("catalog.compareWorkVariants")} · {alignment.workVariants.length}
                  </h3>
                  <ul className="space-y-1.5 m-0 p-0 list-none">
                    {alignment.workVariants.map(({ contentKey, ids }) => (
                      <li key={contentKey} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                        {ids.map((id) => (
                          <span key={id} className="inline-flex items-baseline gap-1">
                            <span className="font-medium text-foreground">
                              {exprEntities[id] ? title(exprEntities[id], locale) : id.slice(0, 8)}
                            </span>
                            <span className="text-muted-foreground">
                              ({items
                                .filter((_, i) => alignment.perExpr.get(id)?.some((o) => o.releaseIndex === i))
                                .map((x) => title(x.release, locale))
                                .join("、")})
                            </span>
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {alignment.carrierOnly.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0 mb-2">
                    {t("catalog.compareCarrierOnly")}
                  </h3>
                  <ul className="space-y-1 m-0 p-0 list-none text-xs text-muted-foreground">
                    {alignment.carrierOnly.map(([i, j]) => (
                      <li key={`${i}-${j}`}>
                        {title(items[i]?.release, locale)} × {title(items[j]?.release, locale)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* 引用同一表达但收录范围/重复/顺序不同（如完整录音 vs 片段）：
                  这不是"仅载体差异"，必须单独指出。 */}
              {alignment.rangeDiffer.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0 mb-2">
                    {t("catalog.compareRangeDiffer")}
                  </h3>
                  <ul className="space-y-1 m-0 p-0 list-none text-xs text-muted-foreground">
                    {alignment.rangeDiffer.map(([i, j]) => (
                      <li key={`${i}-${j}`}>
                        {title(items[i]?.release, locale)} × {title(items[j]?.release, locale)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* 目录不完整（缺曲目/内容引用）的发行单独列出：这种发行不参与
                  "内容一致"结论，空内容集合不代表"已确认相同"。 */}
              {alignment.incomplete.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0 mb-2">
                    {t("catalog.compareIncompleteCatalog")}
                  </h3>
                  <ul className="space-y-1 m-0 p-0 list-none text-xs text-muted-foreground">
                    {alignment.incomplete.map((i) => (
                      <li key={`incomplete-${i}`}>{title(items[i]?.release, locale)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {/* 身份元数据解析不全时不下结论，明确提示人工确认。 */}
              {alignment.pendingConfirm && (
                <p className="m-0 text-xs text-amber-700 dark:text-amber-300">{t("catalog.comparePendingConfirm")}</p>
              )}
            </div>
          )}
        </section>
      )}

      {items.length >= COMPARE_MIN_SLOTS && !loading && (
        <section className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm mt-8">
          <div className="p-4 sm:p-5 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-muted/20">
            <div className="flex items-center gap-2">
              <Columns className="w-5 h-5 text-primary" />
              <h2 className="text-base sm:text-lg font-bold text-foreground m-0">
                {t("catalog.compareSpecifications")}
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                {items.length} {t("catalog.compareSlots")}
              </span>
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={highlightDiff}
                onChange={(e) => setHighlightDiff(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
              />
              <span>{t("catalog.compareHighlightDiff")}</span>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="p-4 w-44 min-w-[176px] font-semibold text-xs uppercase tracking-wider text-muted-foreground border-r border-border align-top">
                    {t("catalog.attributes")}
                  </th>
                  {items.map((x) => {
                    const releaseTitle = title(x.release, locale);
                    const coverUrl = x.release.pictures?.[0]?.url;
                    const catNo = x.release.attributes?.catalog_number;
                    const fmt = x.release.attributes?.format;
                    return (
                      <th
                        key={x.release.id}
                        className="p-4 min-w-[240px] max-w-[320px] align-top border-r border-border last:border-r-0 font-normal"
                      >
                        <div className="flex flex-col gap-3">
                          <div className="w-full h-36 rounded-xl overflow-hidden border border-border/70 shadow-xs">
                            <AdaptiveCardCover
                              src={coverUrl}
                              alt={releaseTitle}
                              fallbackIcon={<Disc className="w-10 h-10 text-muted-foreground/50" />}
                              fallbackTitle={releaseTitle}
                              fallbackSubtitle={fmt ? String(fmt) : catNo ? String(catNo) : undefined}
                              aspectClassName="w-full h-full"
                            />
                          </div>

                          <div className="flex items-start justify-between gap-2">
                            <Link
                              href={`/releases/${x.release.id}`}
                              className="text-sm font-bold text-foreground hover:text-primary transition-colors line-clamp-2 leading-snug"
                              title={releaseTitle}
                            >
                              {releaseTitle}
                            </Link>
                            <button
                              type="button"
                              onClick={() => removeId(x.release.id)}
                              className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-all shrink-0 cursor-pointer"
                              title={t("catalog.compareRemove")}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            {fmt ? (
                              <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                                {String(fmt)}
                              </span>
                            ) : null}
                            {catNo ? (
                              <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">
                                {String(catNo)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                <tr className="hover:bg-muted/20 transition-colors">
                  <th className="p-4 font-medium text-xs text-muted-foreground border-r border-border align-top bg-muted/10">
                    {t("catalog.compareReleaseTitle")}
                  </th>
                  {items.map((x) => (
                    <td key={x.release.id} className="p-4 text-xs text-foreground border-r border-border last:border-r-0 align-top">
                      <Link href={`/releases/${x.release.id}`} className="hover:text-primary hover:underline">
                        {title(x.release, locale)}
                      </Link>
                    </td>
                  ))}
                </tr>
                {comparableFields.map((k) => {
                  const fieldName = getFieldName(dynamicDefs, k, locale) || local(catalogDef?.document.fields[k]?.names, locale, "", k);
                  const rawValues = items.map((x) => JSON.stringify(x.release.attributes?.[k] ?? null));
                  const isDiff = new Set(rawValues).size > 1;

                  return (
                    <tr
                      key={k}
                      className={`hover:bg-muted/20 transition-colors ${
                        highlightDiff && isDiff ? "bg-amber-500/[0.03] dark:bg-amber-500/[0.05]" : ""
                      }`}
                    >
                      <th className="p-4 font-medium text-xs text-muted-foreground border-r border-border align-top bg-muted/10">
                        <div className="flex items-center justify-between gap-1.5">
                          <span>{fieldName}</span>
                          {highlightDiff && isDiff && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-normal">
                              {t("catalog.compareDiffTag")}
                            </span>
                          )}
                        </div>
                      </th>
                      {items.map((x) => (
                        <td
                          key={x.release.id}
                          className={`p-4 text-xs text-foreground border-r border-border last:border-r-0 align-top ${
                            highlightDiff && isDiff ? "font-medium" : ""
                          }`}
                        >
                          {(catalogDef?.document.fields as any)?.[k] ? (
                            <FieldValue
                              field={(catalogDef?.document.fields as any)[k]}
                              value={x.release.attributes?.[k]}
                            />
                          ) : (
                            <span>{renderAttrValue(k, x.release.attributes?.[k])}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}

                <tr className="bg-muted/20 border-t-2 border-border">
                  <th className="p-4 font-bold text-xs uppercase tracking-wider text-foreground border-r border-border align-top bg-muted/30">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-primary" />
                      <span>{t("catalog.compareMediaStructure")}</span>
                    </div>
                  </th>
                  {items.map((x, index) => (
                    <td
                      key={x.release.id}
                      className="p-4 align-top border-r border-border last:border-r-0"
                    >
                      <div className="space-y-3">
                        {x.media?.map((m: any) => (
                          <div
                            key={m.medium.id}
                            className="bg-background dark:bg-muted/20 border border-border rounded-xl p-3.5 shadow-2xs"
                          >
                            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-border">
                              <h3 className="text-xs font-bold text-foreground m-0 truncate">
                                {title(m.medium, locale)}
                              </h3>
                              {m.medium.attributes?.format ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                                  {String(m.medium.attributes.format)}
                                </span>
                              ) : null}
                            </div>

                            <div className="space-y-1.5">
                              {m.tracks?.map((tr: Entity) => (
                                <div
                                  key={tr.id}
                                  className="text-xs py-1 border-b border-dashed border-border/60 last:border-b-0"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-muted-foreground text-[11px] shrink-0 font-semibold w-5">
                                      {tr.number || tr.position}
                                    </span>
                                    <span className="font-medium text-foreground truncate">
                                      {title(tr, locale)}
                                    </span>
                                  </div>

                                  {tr.contents?.map((c: any, i: number) => {
                                    const isVariant = sets.some(
                                      (s, j) => j !== index && !s.has(c.expression_id)
                                    );
                                    return (
                                      <div
                                        key={i}
                                        className="pl-6 pt-0.5 flex items-center gap-2 text-[11px]"
                                      >
                                        <EntityLink id={c.expression_id} />
                                        {isVariant && (
                                          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                                            {t("catalog.variantContent")}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
