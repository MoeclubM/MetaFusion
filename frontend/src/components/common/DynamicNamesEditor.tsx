"use client";

import React, { useState } from "react";
import { Plus, X, Globe } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  canonicalLanguageCode,
  findLanguage,
  languageNativeName,
  quickLanguages,
  REQUIRED_NAME_LOCALES,
  sameLanguage,
} from "@/lib/languages";

export interface MultilingualNames {
  [langCode: string]: string;
}

// 快捷按钮的候选来自语言单一来源的常用语种（四语在最前，一点即得）。
const COMMON_LANGUAGES = quickLanguages();

/**
 * 四语齐备判据（与后端 four_locale_names_required 同口径）：
 * zh-CN / zh-TW / en-US 必须非空；日文允许 ja 或 ja-JP——两种键名在存量数据里都存在，
 * 判据与后端 validateNames 对齐：只查"键在且非空"，不查取值是否与英文不同。
 * 返回缺失的语种码，供调用方决定提示文案。
 */
export function missingRequiredLocales(names?: MultilingualNames): string[] {
  const values = names || {};
  const filled = (code: string) => String(values[code] ?? "").trim() !== "";
  const missing: string[] = REQUIRED_NAME_LOCALES.filter((code) => !filled(code));
  if (!Object.keys(values).some((k) => sameLanguage(k, "ja-JP") && filled(k))) {
    missing.push("ja-JP");
  }
  return missing;
}

/** 语种码归一：ja / JA / jpn 都落成 definitions 的 ja-JP，避免写出 ja-jp、zh-tw 这类对不上服务端校验的键。 */
function normalizeLocaleCode(raw: string): string {
  return canonicalLanguageCode(raw);
}

interface DynamicNamesEditorProps {
  value?: MultilingualNames;
  onChange: (names: MultilingualNames) => void;
  label?: string;
  helperText?: string;
  required?: boolean;
}

export function DynamicNamesEditor({
  value = {},
  onChange,
  label,
  helperText,
  required,
}: DynamicNamesEditorProps) {
  const { t } = useI18n();
  const [newLangCode, setNewLangCode] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const currentNames = { ...value };
  const existingCodes = Object.keys(currentNames);

  const handleUpdate = (code: string, text: string) => {
    const updated = { ...currentNames, [code]: text };
    onChange(updated);
  };

  const handleRemove = (code: string) => {
    const updated = { ...currentNames };
    delete updated[code];
    onChange(updated);
  };

  const handleAdd = (code: string) => {
    const trimmed = normalizeLocaleCode(code);
    if (!trimmed || currentNames[trimmed] !== undefined) return;
    onChange({ ...currentNames, [trimmed]: "" });
    setNewLangCode("");
    setShowCustomInput(false);
  };

  // 快捷候选取常用语种里还没添加的那些；语言表的 popular 顺序已把界面四语排在最前，
  // 所以下面 .slice(0, 4) 拿到的就是四语（必须一点即得）。
  const availablePresets = COMMON_LANGUAGES.filter(
    (lang) => currentNames[lang.code] === undefined
  );

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between">
          <label className="block text-[11px] font-mono text-gray-300 font-medium flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-primary" />
            <span>{label}</span>
            {required && <span className="text-rose-400">*</span>}
          </label>
          {helperText && (
            <span className="text-[10px] text-gray-500 font-mono">
              {helperText}
            </span>
          )}
        </div>
      )}

      {/* 语言条目列表 */}
      <div className="space-y-2">
        {existingCodes.length === 0 ? (
          <div className="p-3 rounded-lg border border-dashed border-white/10 text-center text-xs text-gray-500 font-mono">
            {t("multilingual.noEntries")}
          </div>
        ) : (
          existingCodes.map((code) => {
            // 标签走语言单一来源：表内语种显示自称，表外语种回落代码本身（不空白、不报错）。
            const preset = findLanguage(code);
            return (
              <div
                key={code}
                className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg p-1.5 focus-within:border-primary/50 transition-colors duration-fast ease-soft"
              >
                <span className="px-2 py-0.5 rounded bg-white/[0.06] text-gray-300 text-[11px] font-mono shrink-0 min-w-[64px] text-center">
                  {code}
                  {preset && (
                    <span className="text-[10px] text-gray-500 ml-1">
                      ({languageNativeName(code)})
                    </span>
                  )}
                </span>
                <input
                  type="text"
                  value={currentNames[code] || ""}
                  onChange={(e) => handleUpdate(code, e.target.value)}
                  placeholder={t("multilingual.namePlaceholder", { code })}
                  className="flex-1 bg-transparent px-2 py-1 text-xs text-white placeholder:text-gray-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleRemove(code)}
                  className="p-1 text-gray-500 hover:text-rose-400 rounded transition-colors duration-fast ease-soft"
                  title={t("multilingual.removeLang", { code })}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* 添加新语言 */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {availablePresets.slice(0, 4).map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => handleAdd(lang.code)}
            className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-white border border-white/10 text-[10px] font-mono flex items-center gap-1 transition-colors duration-fast ease-soft"
          >
            <Plus className="w-2.5 h-2.5" />
            <span>+{lang.code}</span>
            <span className="text-gray-500 text-[9px]">({lang.native})</span>
          </button>
        ))}

        {!showCustomInput ? (
          <button
            type="button"
            onClick={() => setShowCustomInput(true)}
            className="px-2 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-[10px] font-mono flex items-center gap-1 transition-colors duration-fast ease-soft"
          >
            <Plus className="w-2.5 h-2.5" />
            <span>{t("multilingual.addOtherLang")}</span>
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="text"
              autoFocus
              placeholder={t("multilingual.langCodePlaceholder")}
              value={newLangCode}
              onChange={(e) => setNewLangCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd(newLangCode);
                }
              }}
              className="bg-black/60 border border-primary/40 rounded px-2 py-0.5 text-[11px] text-white font-mono outline-none w-28"
            />
            <button
              type="button"
              onClick={() => handleAdd(newLangCode)}
              className="px-2 py-0.5 rounded bg-primary text-black text-[10px] font-bold"
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => setShowCustomInput(false)}
              className="p-1 text-gray-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MultilingualBadges({ names }: { names?: MultilingualNames }) {
  const entries = Object.entries(names || {}).filter(([_, v]) => v && v.trim() !== "");
  if (entries.length === 0) {
    return <span className="text-gray-500 font-mono text-[11px]">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([code, val]) => (
        <span
          key={code}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/10 text-xs font-mono"
        >
          <span className="text-[10px] text-primary/80 font-bold uppercase">
            {code}:
          </span>
          <span className="text-white font-sans text-[11px] font-medium">
            {val}
          </span>
        </span>
      ))}
    </div>
  );
}
