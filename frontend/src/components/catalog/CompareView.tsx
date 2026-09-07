"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity, local, title } from "./api";
import { useCatalog } from "./CatalogProvider";
import { FieldValue, EntityLink, ErrorMessage } from "./Fields";
import { useDefinitions, getFieldName } from "@/lib/definitions";
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

export function Compare({ ids }: { ids: string }) {
  const { t, locale } = useI18n();
  const { definition: catalogDef } = useCatalog();
  const { definitions: dynamicDefs } = useDefinitions();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const initialList = useMemo(() => {
    return (ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
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

  const maxSlots = 6;
  const slotIndices = useMemo(() => Array.from({ length: maxSlots }, (_, i) => i), []);

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

  // Load recent releases for quick addition
  useEffect(() => {
    api<{ items: Entity[] }>("/catalog/entities?kind=release&limit=12")
      .then((r) => setRecentReleases(r.items || []))
      .catch(() => {});
  }, []);

  // Search releases by keyword or title
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

  // Query comparison if 2 to 6 releases are selected
  useEffect(() => {
    if (selectedIds.length < 2) {
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
  }, [selectedIds, t]);

  const fields = useMemo(() => {
    return Array.from(
      new Set(items.flatMap((x) => Object.keys(x.release.attributes || {}))),
    );
  }, [items]);

  const sets = useMemo(() => {
    return items.map(
      (x) =>
        new Set<string>(
          x.media.flatMap((m: any) =>
            m.tracks.flatMap((tr: any) =>
              (tr.contents || []).map((c: any) => c.expression_id),
            ),
          ),
        ),
    );
  }, [items]);

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
      {/* Heading & Clear Control */}
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

      {/* Comparison Slots Section */}
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-sm text-foreground">
              {t("catalog.compareSlots")} ({selectedIds.length} / {maxSlots})
            </span>
            {/* Slot indicators */}
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
            {selectedIds.length < 2 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <AlertCircle className="w-3.5 h-3.5" />
                {t("catalog.compareNeedMore", { count: 2 - selectedIds.length })}
              </span>
            )}
            {selectedIds.length >= 2 && selectedIds.length < maxSlots && (
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

        {/* 6-Slots Grid */}
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

                  {/* Adaptive Card Cover */}
                  <div className="w-full aspect-square rounded-lg overflow-hidden mb-2 border border-border/60">
                    <AdaptiveCardCover
                      src={info.coverUrl}
                      alt={info.title}
                      fallbackIcon={<Disc className="w-7 h-7 text-muted-foreground/60" />}
                      aspectClassName="w-full h-full"
                    />
                  </div>

                  {/* Title & Metadata */}
                  <div className="min-w-0">
                    <Link
                      href={`/catalog/${id}`}
                      className="text-xs font-semibold text-foreground hover:text-primary line-clamp-2 leading-snug transition-colors"
                      title={info.title}
                    >
                      {info.title}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
                      {info.format && (
                        <span className="px-1.5 py-0.2 rounded bg-muted/60 font-medium truncate">
                          {info.format}
                        </span>
                      )}
                      {info.catalogNo && (
                        <span className="truncate font-mono">
                          {info.catalogNo}
                        </span>
                      )}
                      {!info.format && !info.catalogNo && (
                        <span className="font-mono">{id.slice(0, 8)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // Empty Slot Placeholder
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

      {/* Release Search & Add Controls */}
      {selectedIds.length < maxSlots && (
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base sm:text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            {t("catalog.compareSelectRelease")}
          </h2>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search input */}
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

            {/* Direct UUID Input */}
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

          {/* Search Results Grid */}
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
                            {catNo ? `${catNo} · ` : ""}
                            {fmt || "Release"}
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

          {/* Recent Releases Quick Pick */}
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
                            {catNo ? `${catNo} · ` : ""}
                            {fmt || "Release"}
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

      {/* Comparison Matrix Table */}
      {items.length >= 2 && !loading && (
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
              {/* Header with Releases Cards */}
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
                          {/* Adaptive Card Cover */}
                          <div className="w-full h-36 rounded-xl overflow-hidden border border-border/70 shadow-xs">
                            <AdaptiveCardCover
                              src={coverUrl}
                              alt={releaseTitle}
                              fallbackIcon={<Disc className="w-10 h-10 text-muted-foreground/50" />}
                              fallbackTitle={releaseTitle}
                              fallbackSubtitle={fmt || catNo}
                              aspectClassName="w-full h-full"
                            />
                          </div>

                          {/* Title & Remove */}
                          <div className="flex items-start justify-between gap-2">
                            <Link
                              href={`/catalog/${x.release.id}`}
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

                          {/* Badge Meta */}
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            {fmt && (
                              <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                                {fmt}
                              </span>
                            )}
                            {catNo && (
                              <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">
                                {catNo}
                              </span>
                            )}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Attributes comparison rows */}
              <tbody className="divide-y divide-border">
                {fields.map((k) => {
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
                          <FieldValue
                            field={catalogDef?.document.fields[k]}
                            value={x.release.attributes?.[k]}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}

                {/* Media & Track Content row */}
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
                              {m.medium.attributes?.format && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                                  {m.medium.attributes.format}
                                </span>
                              )}
                            </div>

                            {/* Tracks */}
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

                                  {/* Track Contents */}
                                  {tr.contents?.map((c: any, i: number) => {
                                    const isVariant = sets.some(
                                      (s, j) => j !== index && !s.has(c.expression_id),
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
