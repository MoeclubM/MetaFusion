"use client";

import React, { useState, useEffect } from "react";
import { Plus, X, Globe2, Tag as TagIcon, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchApi, isWorkTagGroup } from "@/lib/api";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { CATALOG_LOCALES, LocaleEntry } from "./localeForm";
import { Select } from "@/components/ui/Select";

const fieldClass =
  "w-full px-3.5 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-primary";
const areaClass =
  "w-full p-3.5 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-primary";
const labelClass = "block text-xs sm:text-sm font-mono text-gray-600 dark:text-gray-300";

interface Props {
  targetType: "work" | "artist" | "release" | "franchise" | "canonical_entry";
  formData: Record<string, any>;
  updateField: (key: string, val: any) => void;
  aliasesStr: string;
  setAliasesStr: (val: string) => void;
  taxonomy?: any;
}

// 原始语言（ISO 639-1）：作品内容本身的语言，与编目语种无关
const ORIGINAL_LANGUAGE_OPTIONS = [
  { code: "zh", labelKey: "editor.core.origLangZh" },
  { code: "ja", labelKey: "editor.core.langJa" },
  { code: "en", labelKey: "editor.core.langEn" },
  { code: "ko", labelKey: "editor.core.langKo" },
  { code: "fr", labelKey: "editor.core.origLangFr" },
  { code: "de", labelKey: "editor.core.origLangDe" },
];

// 封面显示比例：空值 = 自动推断；其余为手动固定
export const COVER_ASPECT_OPTIONS = ["1:1", "2:3", "3:4", "4:3"];

export function EditorCoreFields({
  targetType,
  formData,
  updateField,
  aliasesStr,
  setAliasesStr,
  taxonomy: propTaxonomy,
}: Props) {
  const { t, locale } = useI18n();
  const { taxonomy: hookTaxonomy } = useTaxonomy();
  const taxonomy = propTaxonomy || hookTaxonomy;

  const [newTagInput, setNewTagInput] = useState("");
  const [dynamicTagSuggestions, setDynamicTagSuggestions] = useState<string[]>([]);
  const [activeLocale, setActiveLocale] = useState(formData.language || locale || "zh-CN");

  useEffect(() => {
    const workOnly = (name: string, group?: string) =>
      Boolean(name) && (!group || isWorkTagGroup(group));
    if (taxonomy?.tags && Array.isArray(taxonomy.tags) && taxonomy.tags.length > 0) {
      const tagNames = taxonomy.tags
        .filter((tg: any) => workOnly(typeof tg === "string" ? tg : tg.name, typeof tg === "string" ? undefined : tg.group_type))
        .map((tg: any) => (typeof tg === "string" ? tg : tg.name));
      setDynamicTagSuggestions(tagNames.slice(0, 24));
    } else {
      fetchApi<{ id: number; name: string; group_type?: string }[]>("/catalog/tags")
        .then((data) => {
          if (Array.isArray(data)) {
            setDynamicTagSuggestions(
              data.filter((tg) => workOnly(tg.name, tg.group_type)).map((tg) => tg.name).slice(0, 24)
            );
          }
        })
        .catch(() => {});
    }
  }, [taxonomy]);

  useEffect(() => {
    if (formData.language) setActiveLocale(formData.language);
  }, [formData.language]);

  const tags: string[] = Array.isArray(formData.tags)
    ? formData.tags.map((t: any) => (typeof t === "string" ? t : t.name))
    : [];

  const translations: Record<string, LocaleEntry> = formData.translations || {};
  const defaultLocale: string = formData.language || "zh-CN";
  const usesLocalePack = targetType === "work" || targetType === "artist" || targetType === "franchise";

  const syncCanonicalFromLocale = (loc: string, entry: LocaleEntry) => {
    if (targetType === "work" || targetType === "franchise") {
      updateField("title", entry.title || "");
      updateField("summary", entry.summary || "");
    } else if (targetType === "artist") {
      updateField("name", entry.title || "");
      updateField("biography", entry.summary || "");
    }
  };

  const handleUpdateTranslation = (loc: string, patch: Partial<LocaleEntry>) => {
    const prev = translations[loc] || { title: "", summary: "" };
    const nextEntry: LocaleEntry = {
      title: patch.title !== undefined ? patch.title : prev.title,
      summary: patch.summary !== undefined ? patch.summary : prev.summary,
    };
    updateField("translations", { ...translations, [loc]: nextEntry });
    if (loc === defaultLocale) syncCanonicalFromLocale(loc, nextEntry);
  };

  const handleSetDefaultLocale = (loc: string) => {
    updateField("language", loc);
    const entry = translations[loc] || { title: "", summary: "" };
    syncCanonicalFromLocale(loc, entry);
  };

  const handleAddTag = (tagToAdd: string) => {
    const clean = tagToAdd.replace(/^#/, "").trim();
    if (!clean || tags.includes(clean)) return;
    updateField("tags", [...tags, clean]);
    setNewTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    updateField(
      "tags",
      tags.filter((t) => t !== tagToRemove)
    );
  };

  const entityTypeOptions =
    taxonomy?.entity_types && taxonomy.entity_types.length > 0
      ? taxonomy.entity_types.map((et: any) => ({
          value: et.id,
          label: et.name || et.name_zh || et.id,
        }))
      : formData.entity_type
        ? [{ value: formData.entity_type, label: formData.entity_type }]
        : [];

  return (
    <div className="space-y-5">
      {/* ── 1. 多语言基础标识 (Multilingual Identification) ── */}
      <div className="p-4 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-semibold text-gray-900 dark:text-white">{t("editor.core.multilingualTitle")}</h3>
          </div>
        </div>
        {usesLocalePack ? (
          <>
            <p className="text-[11px] leading-relaxed text-gray-500">{t("editor.core.localePackHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {CATALOG_LOCALES.map((opt) => {
                const isActive = activeLocale === opt.code;
                const isDefault = defaultLocale === opt.code;
                const filled = !!(translations[opt.code]?.title || translations[opt.code]?.summary);
                return (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => setActiveLocale(opt.code)}
                    className={`px-2.5 h-8 rounded-md font-mono text-[11px] border transition-colors inline-flex items-center gap-1.5 ${
                      isActive
                        ? "bg-amber-500/15 border-amber-400/40 text-amber-800 dark:text-amber-100"
                        : "bg-black/[0.03] dark:bg-white/[0.03] border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    {t(opt.labelKey)}
                    {isDefault && (
                      <span className="text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-300">{t("editor.core.defaultBadge")}</span>
                    )}
                    {filled && !isDefault && <span className="w-1 h-1 rounded-full bg-emerald-400" />}
                  </button>
                );
              })}
            </div>
            {CATALOG_LOCALES.map((opt) => {
              if (opt.code !== activeLocale) return null;
              const entry = translations[opt.code] || { title: "", summary: "" };
              const isDefault = defaultLocale === opt.code;
              return (
                <div key={opt.code} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className={labelClass}>
                      {t("editor.core.localeTitleLabel")}
                      {isDefault && <span className="text-amber-400"> *</span>}
                    </label>
                    {isDefault ? (
                      <span className="font-mono text-[10px] text-amber-700/80 dark:text-amber-300/80">{t("editor.core.defaultBadge")}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSetDefaultLocale(opt.code)}
                        className="font-mono text-[11px] text-gray-500 hover:text-amber-700 dark:hover:text-amber-200 underline underline-offset-2"
                      >
                        {t("editor.core.setAsDefault")}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    required={isDefault}
                    value={entry.title}
                    onChange={(e) => handleUpdateTranslation(opt.code, { title: e.target.value })}
                    placeholder={t("editor.core.localeTitlePlaceholder")}
                    className={`${fieldClass} font-medium`}
                  />
                  {opt.romaji && (
                    <div className="space-y-1.5">
                      <label className="block text-xs sm:text-sm font-mono text-gray-500">{t("editor.core.romaji")}</label>
                      <input
                        type="text"
                        value={formData.romaji || ""}
                        onChange={(e) => updateField("romaji", e.target.value)}
                        placeholder={t("editor.core.romajiPlaceholder")}
                        className={fieldClass}
                      />
                      <p className="text-[11px] text-gray-500">{t("editor.core.romajiAliasHint")}</p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className={labelClass}>
                      {targetType === "artist" ? t("editor.core.artistBioLabel") : t("editor.core.localeSummaryLabel")}
                    </label>
                    <textarea
                      rows={4}
                      value={entry.summary}
                      onChange={(e) => handleUpdateTranslation(opt.code, { summary: e.target.value })}
                      placeholder={t("editor.core.localeSummaryPlaceholder")}
                      className={areaClass}
                    />
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="space-y-1.5">
            <label className={labelClass}>
              {t("editor.core.primaryTitleLabel")} <span className="text-amber-400">*</span>
            </label>
            <input
              type="text"
              required
              value={targetType === "canonical_entry" ? (formData.title || "") : (formData.edition_name || "")}
              onChange={(e) => updateField(targetType === "canonical_entry" ? "title" : "edition_name", e.target.value)}
              placeholder={t("editor.core.primaryTitlePlaceholder")}
              className={`${fieldClass} font-medium`}
            />
          </div>
        )}

        <div className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/[0.06]">
          <label className={labelClass}>
            {t("editor.core.aliasesLabel")}
          </label>
          <input
            type="text"
            value={aliasesStr}
            onChange={(e) => setAliasesStr(e.target.value)}
            placeholder={t("editor.core.aliasesPlaceholder")}
            className={fieldClass}
          />
        </div>
      </div>

      {/* ── 2. 主体性质 / 分发参数 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {targetType === "work" && (
          <>
            <div className="space-y-1.5">
              <label className={labelClass} title={t("editor.core.originalLangHint")}>
                {t("editor.core.originalLangLabel")}
              </label>
              <Select
                value={formData.original_language || ""}
                onChange={(val) => updateField("original_language", val)}
                options={[
                  { value: "", label: t("editor.core.originalLangUnknown") },
                  ...ORIGINAL_LANGUAGE_OPTIONS.map((opt) => ({
                    value: opt.code,
                    label: t(opt.labelKey),
                  })),
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass} title={t("editor.core.coverAspectHint")}>
                {t("editor.core.coverAspectRatio")}
              </label>
              <Select
                value={formData.cover_aspect || ""}
                onChange={(val) => updateField("cover_aspect", val)}
                options={[
                  { value: "", label: t("editor.core.coverAspectAuto") },
                  ...COVER_ASPECT_OPTIONS.map((v) => ({ value: v, label: v })),
                ]}
              />
            </div>
          </>
        )}

        {targetType === "artist" && (
          <>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("editor.core.entityTypeLabel")}</label>
              <Select
                value={formData.entity_type || "person"}
                onChange={(val) => updateField("entity_type", val)}
                className="font-mono"
                options={entityTypeOptions}
              />
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>{t("editor.core.disambiguationLabel")}</label>
              <input
                type="text"
                value={formData.disambiguation || ""}
                onChange={(e) => updateField("disambiguation", e.target.value)}
                placeholder={t("editor.core.disambiguationPlaceholder")}
                className={fieldClass}
              />
            </div>
          </>
        )}

        {targetType === "franchise" && (
          <div className="space-y-1.5">
            <label className={labelClass}>{t("editor.core.disambiguationLabel")}</label>
            <input
              type="text"
              value={formData.disambiguation || ""}
              onChange={(e) => updateField("disambiguation", e.target.value)}
              placeholder={t("editor.core.disambiguationPlaceholder")}
              className={fieldClass}
            />
          </div>
        )}

        {targetType === "release" && (
          <>
            <div className="space-y-1.5 md:col-span-2">
              <label className={labelClass}>
                {t("editor.core.workIdLabel")} <span className="text-amber-400">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.work_id || ""}
                onChange={(e) => updateField("work_id", e.target.value)}
                placeholder={t("editor.core.workIdPlaceholder")}
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("editor.core.catalogNumberLabel")}</label>
              <input
                type="text"
                value={formData.catalog_number || ""}
                onChange={(e) => updateField("catalog_number", e.target.value)}
                placeholder={t("editor.core.catalogNumberPlaceholder")}
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("editor.core.barcodeLabel")}</label>
              <input
                type="text"
                value={formData.barcode || ""}
                onChange={(e) => updateField("barcode", e.target.value)}
                placeholder={t("editor.core.barcodePlaceholder")}
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("editor.core.releaseLanguageLabel")}</label>
              <input
                type="text"
                value={formData.language || ""}
                onChange={(e) => updateField("language", e.target.value)}
                placeholder={t("editor.core.releaseLanguagePlaceholder")}
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("editor.core.packagingLabel")}</label>
              <Select
                value={formData.packaging || ""}
                onChange={(val) => updateField("packaging", val)}
                className="font-mono"
                options={[
                  { value: "", label: t("editor.core.packagingUnset") },
                  ...(taxonomy?.packagings || []).map((p: any) => ({
                    value: p.id,
                    label: p.name || p.name_zh || p.id,
                  })),
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("editor.core.distributionChannelLabel")}</label>
              <Select
                value={formData.distribution_channel || "mixed"}
                onChange={(val) => updateField("distribution_channel", val)}
                className="font-mono"
                options={[
                  { value: "mixed", label: t("editor.core.channelMixed") },
                  { value: "physical", label: t("editor.core.channelPhysical") },
                  { value: "digital", label: t("editor.core.channelDigital") },
                  { value: "web", label: t("editor.core.channelWeb") },
                ]}
              />
            </div>
          </>
        )}

        {targetType === "canonical_entry" && (
          <>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("canonicalEntry.editor.artistCredit")}</label>
              <input
                type="text"
                value={formData.artist_credit || ""}
                onChange={(e) => updateField("artist_credit", e.target.value)}
                placeholder={t("canonicalEntry.editor.artistCreditPlaceholder")}
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("canonicalEntry.editor.durationSeconds")}</label>
              <input
                type="number"
                min={0}
                value={formData.duration_seconds ?? formData.duration ?? ""}
                onChange={(e) => updateField("duration_seconds", parseInt(e.target.value, 10) || 0)}
                placeholder="240"
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("canonicalEntry.editor.sortTitle")}</label>
              <input
                type="text"
                value={formData.sort_title || ""}
                onChange={(e) => updateField("sort_title", e.target.value)}
                placeholder={t("canonicalEntry.editor.sortTitlePlaceholder")}
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("canonicalEntry.editor.recordingDate")}</label>
              <input
                type="date"
                value={formData.recording_date || ""}
                onChange={(e) => updateField("recording_date", e.target.value)}
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("canonicalEntry.editor.isrc")}</label>
              <input
                type="text"
                value={formData.isrc || ""}
                onChange={(e) => updateField("isrc", e.target.value)}
                placeholder="e.g., JPU902300001"
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>{t("canonicalEntry.editor.isbn")}</label>
              <input
                type="text"
                value={formData.isbn || ""}
                onChange={(e) => updateField("isbn", e.target.value)}
                placeholder="e.g., 978-4-04-100000-0"
                className={`${fieldClass} font-mono`}
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className={labelClass}>{t("editor.core.countryLabel")}</label>
          <input
            type="text"
            value={formData.country || ""}
            onChange={(e) => updateField("country", e.target.value)}
            placeholder={t("editor.core.countryPlaceholder")}
            className={`${fieldClass} font-mono`}
          />
        </div>
      </div>

      {/* ── 3. 全动态标签与体裁系统 (Dynamic Tagging & Themes) ── */}
      {targetType !== "release" && (
      <div className="p-4 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TagIcon className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white">{t("editor.core.tagsTitle")}</h3>
          </div>
          <span className="font-mono text-xs text-gray-500">
            {t("editor.core.tagsSub")}
          </span>
        </div>
        {targetType === "work" && (
          <>
            <p className="text-[11px] leading-relaxed text-gray-500">{t("editor.core.formTagHint")}</p>
            <p className="text-[11px] leading-relaxed text-gray-500">{t("editor.core.carrierMetaHint")}</p>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 min-h-[32px]">
          {tags.length === 0 ? (
            <span className="text-xs sm:text-sm text-gray-500 font-mono">{t("editor.core.noTags")}</span>
          ) : (
            tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm font-mono transition-colors"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="p-0.5 hover:bg-emerald-500/20 rounded-full text-emerald-600 dark:text-emerald-400 hover:text-rose-500 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag(newTagInput);
              }
            }}
            placeholder={t("editor.core.addTagPlaceholder")}
            className="flex-1 px-3.5 h-10 rounded-lg bg-background border border-black/10 dark:border-white/10 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => handleAddTag(newTagInput)}
            className="px-4 h-10 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 hover:bg-black/[0.08] dark:hover:bg-white/10 text-gray-900 dark:text-white text-sm font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {t("editor.core.addBtn")}
          </button>
        </div>

        {dynamicTagSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-black/5 dark:border-white/[0.06]">
            <span className="font-mono text-xs text-gray-500 mr-1 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              {t("editor.core.quickSuggestions")}
            </span>
            {dynamicTagSuggestions.map((sug) => {
              const isSelected = tags.includes(sug);
              return (
                <button
                  key={sug}
                  type="button"
                  onClick={() => (isSelected ? handleRemoveTag(sug) : handleAddTag(sug))}
                  className={`px-2.5 py-1 rounded-full font-mono text-xs border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-800 dark:text-emerald-200"
                      : "bg-black/[0.03] dark:bg-white/[0.03] border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/[0.08] dark:hover:bg-white/[0.08]"
                  }`}
                >
                  +{sug}
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {targetType === "release" && (
        <div className="space-y-1.5">
          <label className={labelClass}>
            {t("editor.core.summaryLabel")}
          </label>
          <textarea
            rows={4}
            value={formData.notes || ""}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder={t("editor.core.summaryPlaceholder")}
            className={areaClass}
          />
        </div>
      )}
    </div>
  );
}
