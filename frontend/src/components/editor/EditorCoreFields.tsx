"use client";

import React, { useState, useEffect } from "react";
import { Plus, X, Globe2, Tag as TagIcon, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchApi } from "@/lib/api";
import { useTaxonomy } from "@/hooks/useTaxonomy";

interface Props {
  targetType: "work" | "artist" | "release";
  formData: Record<string, any>;
  updateField: (key: string, val: any) => void;
  aliasesStr: string;
  setAliasesStr: (val: string) => void;
  taxonomy?: any;
}

// 元数据主语言（BCP-47）：词条文本以何种语言书写
const METADATA_LANGUAGE_OPTIONS = [
  { code: "zh-CN", labelKey: "editor.core.langZhHans" },
  { code: "zh-TW", labelKey: "editor.core.langZhHant" },
  { code: "en-US", labelKey: "editor.core.langEn" },
  { code: "ja-JP", labelKey: "editor.core.langJa" },
  { code: "ko-KR", labelKey: "editor.core.langKo" },
];

// 原始语言（ISO 639-1）：作品内容本身的语言
const ORIGINAL_LANGUAGE_OPTIONS = [
  { code: "zh", labelKey: "editor.core.origLangZh" },
  { code: "ja", labelKey: "editor.core.langJa" },
  { code: "en", labelKey: "editor.core.langEn" },
  { code: "ko", labelKey: "editor.core.langKo" },
  { code: "fr", labelKey: "editor.core.origLangFr" },
  { code: "de", labelKey: "editor.core.origLangDe" },
];

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

  useEffect(() => {
    if (taxonomy?.tags && Array.isArray(taxonomy.tags) && taxonomy.tags.length > 0) {
      const tagNames = taxonomy.tags.map((t: any) => (typeof t === "string" ? t : t.name)).filter(Boolean);
      setDynamicTagSuggestions(tagNames.slice(0, 24));
    } else {
      fetchApi<{ id: number; name: string }[]>("/catalog/tags")
        .then((data) => {
          if (Array.isArray(data)) {
            setDynamicTagSuggestions(data.map((t) => t.name).filter(Boolean).slice(0, 24));
          }
        })
        .catch(() => {});
    }
  }, [taxonomy]);

  const tags: string[] = Array.isArray(formData.tags)
    ? formData.tags.map((t: any) => (typeof t === "string" ? t : t.name))
    : [];

  const names: Record<string, string> = formData.names || {};

  const handleUpdateName = (langKey: string, val: string) => {
    const updated = { ...names, [langKey]: val };
    updateField("names", updated);
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

  return (
    <div className="space-y-5">
      {/* ── 1. 多语言基础标识 (Multilingual Identification) ── */}
      <div className="p-4 rounded-card bg-white/[0.02] border border-white/[0.06] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-semibold text-white">{t("editor.core.multilingualTitle")}</h3>
          </div>
          {targetType === "work" && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-mono text-gray-400">{t("editor.core.metadataLangLabel")}</label>
              <select
                value={formData.language || "zh-CN"}
                onChange={(e) => updateField("language", e.target.value)}
                title={t("editor.core.metadataLangHint")}
                className="px-3 h-9 rounded-lg bg-background border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
              >
                {METADATA_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Primary Title / Name */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="block text-xs sm:text-sm font-mono text-gray-300">
              {t("editor.core.primaryTitleLabel")} <span className="text-amber-400">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.title || formData.name || formData.edition_name || ""}
              onChange={(e) => {
                if (targetType === "work") updateField("title", e.target.value);
                else if (targetType === "artist") updateField("name", e.target.value);
                else updateField("edition_name", e.target.value);
              }}
              placeholder={t("editor.core.primaryTitlePlaceholder")}
              className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm font-medium focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Chinese Name */}
          <div className="space-y-1.5">
            <label className="block text-xs sm:text-sm font-mono text-gray-400">{t("editor.core.chineseName")}</label>
            <input
              type="text"
              value={names["zh-CN"] || ""}
              onChange={(e) => handleUpdateName("zh-CN", e.target.value)}
              placeholder={t("editor.core.chinesePlaceholder")}
              className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Japanese Native Name */}
          <div className="space-y-1.5">
            <label className="block text-xs sm:text-sm font-mono text-gray-400">{t("editor.core.japaneseNative")}</label>
            <input
              type="text"
              value={formData.original_title || formData.original_name || names["ja-JP"] || ""}
              onChange={(e) => {
                if (targetType === "work") updateField("original_title", e.target.value);
                else updateField("original_name", e.target.value);
                handleUpdateName("ja-JP", e.target.value);
              }}
              placeholder={t("editor.core.japanesePlaceholder")}
              className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Romaji / Latin Transliteration */}
          <div className="space-y-1.5">
            <label className="block text-xs sm:text-sm font-mono text-gray-400">{t("editor.core.romaji")}</label>
            <input
              type="text"
              value={names["ja-Latn"] || ""}
              onChange={(e) => handleUpdateName("ja-Latn", e.target.value)}
              placeholder={t("editor.core.romajiPlaceholder")}
              className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* English International Name */}
          <div className="space-y-1.5">
            <label className="block text-xs sm:text-sm font-mono text-gray-400">{t("editor.core.englishName")}</label>
            <input
              type="text"
              value={names["en-US"] || ""}
              onChange={(e) => handleUpdateName("en-US", e.target.value)}
              placeholder={t("editor.core.englishPlaceholder")}
              className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* Aliases */}
        <div className="space-y-1.5 pt-2 border-t border-white/[0.04]">
          <label className="block text-xs sm:text-sm font-mono text-gray-300">
            {t("editor.core.aliasesLabel")}
          </label>
          <input
            type="text"
            value={aliasesStr}
            onChange={(e) => setAliasesStr(e.target.value)}
            placeholder={t("editor.core.aliasesPlaceholder")}
            className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* ── 2. 主体性质 / 分发参数 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {targetType === "work" && (
          <>
            <div className="space-y-1.5">
              <label className="block text-xs sm:text-sm font-mono text-gray-300">
                {t("editor.temporal.mediaTypeLabel")} <span className="text-amber-400">*</span>
              </label>
              <select
                value={formData.media_type || (taxonomy?.media_types?.[0]?.id || "")}
                onChange={(e) => updateField("media_type", e.target.value)}
                className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400 font-mono"
              >
                {taxonomy?.media_types && taxonomy.media_types.length > 0 ? (
                  taxonomy.media_types.map((mt: any) => {
                    const label = mt.name || (locale === "en-US" ? mt.name_en : mt.name_zh) || mt.id;
                    return (
                      <option key={mt.id} value={mt.id}>
                        {label} ({mt.id})
                      </option>
                    );
                  })
                ) : (
                  formData.media_type && (
                    <option value={formData.media_type}>
                      {formData.media_type}
                    </option>
                  )
                )}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs sm:text-sm font-mono text-gray-300" title={t("editor.core.originalLangHint")}>
                {t("editor.core.originalLangLabel")}
              </label>
              <select
                value={formData.original_language || ""}
                onChange={(e) => updateField("original_language", e.target.value)}
                className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400"
              >
                <option value="">{t("editor.core.originalLangUnknown")}</option>
                {ORIGINAL_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {targetType === "artist" && (
          <>
            <div className="space-y-1.5">
              <label className="block text-xs sm:text-sm font-mono text-gray-300">{t("editor.core.entityTypeLabel")}</label>
              <select
                value={formData.entity_type || "person"}
                onChange={(e) => updateField("entity_type", e.target.value)}
                className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400 font-mono"
              >
                {taxonomy?.entity_types && taxonomy.entity_types.length > 0 ? (
                  taxonomy.entity_types.map((et: any) => (
                    <option key={et.id} value={et.id}>
                      {et.name || et.name_zh || et.id}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="person">{t("editor.core.entityTypePerson")}</option>
                    <option value="studio">{t("editor.core.entityTypeStudio")}</option>
                    <option value="publisher">{t("editor.core.entityTypePublisher")}</option>
                    <option value="label">{t("editor.core.entityTypeLabelOrg")}</option>
                    <option value="group">{t("editor.core.entityTypeGroup")}</option>
                    <option value="circle">{t("editor.core.entityTypeCircle")}</option>
                    <option value="orchestra">{t("editor.core.entityTypeOrchestra")}</option>
                  </>
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs sm:text-sm font-mono text-gray-300">{t("editor.core.disambiguationLabel")}</label>
              <input
                type="text"
                value={formData.disambiguation || ""}
                onChange={(e) => updateField("disambiguation", e.target.value)}
                placeholder={t("editor.core.disambiguationPlaceholder")}
                className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400"
              />
            </div>
          </>
        )}

        {targetType === "release" && (
          <>
            <div className="space-y-1.5 md:col-span-2">
              <label className="block text-xs sm:text-sm font-mono text-gray-300">
                {t("editor.core.workIdLabel")} <span className="text-amber-400">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.work_id || ""}
                onChange={(e) => updateField("work_id", e.target.value)}
                placeholder={t("editor.core.workIdPlaceholder")}
                className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs sm:text-sm font-mono text-gray-300">{t("editor.core.catalogNumberLabel")}</label>
              <input
                type="text"
                value={formData.catalog_number || ""}
                onChange={(e) => updateField("catalog_number", e.target.value)}
                placeholder={t("editor.core.catalogNumberPlaceholder")}
                className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs sm:text-sm font-mono text-gray-300">{t("editor.core.barcodeLabel")}</label>
              <input
                type="text"
                value={formData.barcode || ""}
                onChange={(e) => updateField("barcode", e.target.value)}
                placeholder={t("editor.core.barcodePlaceholder")}
                className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-mono text-gray-300">{t("editor.core.countryLabel")}</label>
          <input
            type="text"
            value={formData.country || ""}
            onChange={(e) => updateField("country", e.target.value)}
            placeholder={t("editor.core.countryPlaceholder")}
            className="w-full px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* ── 3. 全动态标签与体裁系统 (Dynamic Tagging & Themes) ── */}
      <div className="p-4 rounded-card bg-white/[0.02] border border-white/[0.06] space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TagIcon className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs sm:text-sm font-semibold text-white">{t("editor.core.tagsTitle")}</h3>
          </div>
          <span className="font-mono text-xs text-gray-500">
            {t("editor.core.tagsSub")}
          </span>
        </div>

        {/* Selected Tags Chips */}
        <div className="flex flex-wrap items-center gap-2 min-h-[32px]">
          {tags.length === 0 ? (
            <span className="text-xs sm:text-sm text-gray-500 font-mono">{t("editor.core.noTags")}</span>
          ) : (
            tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs sm:text-sm font-mono transition-colors"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="p-0.5 hover:bg-emerald-500/20 rounded-full text-emerald-400 hover:text-rose-300 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))
          )}
        </div>

        {/* Add Tag Input */}
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
            className="flex-1 px-3.5 h-10 rounded-lg bg-background border border-white/10 text-white text-sm focus:outline-none focus:border-amber-400"
          />
          <button
            type="button"
            onClick={() => handleAddTag(newTagInput)}
            className="px-4 h-10 rounded-lg bg-white/[0.06] border border-white/10 hover:bg-white/10 text-white text-sm font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {t("editor.core.addBtn")}
          </button>
        </div>

        {/* Quick Tag Suggestions (Dynamically loaded from Database Tags) */}
        {dynamicTagSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/[0.04]">
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
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200"
                      : "bg-white/[0.03] border-white/10 text-gray-400 hover:text-white hover:bg-white/[0.08]"
                  }`}
                >
                  +{sug}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 4. 简介 / 传记 ── */}
      <div className="space-y-1.5">
        <label className="block text-xs sm:text-sm font-mono text-gray-300">
          {t("editor.core.summaryLabel")}
        </label>
        <textarea
          rows={4}
          value={formData.summary || formData.biography || formData.notes || ""}
          onChange={(e) => {
            if (targetType === "artist") updateField("biography", e.target.value);
            else if (targetType === "work") updateField("summary", e.target.value);
            else updateField("notes", e.target.value);
          }}
          placeholder={t("editor.core.summaryPlaceholder")}
          className="w-full p-3.5 rounded-lg bg-background border border-white/10 text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-amber-400"
        />
      </div>
    </div>
  );
}
