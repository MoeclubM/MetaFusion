"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchExternalDatabases, ExternalDatabaseDefinition } from "@/lib/api";
import { Plus, Trash2, Globe, ExternalLink, AlertCircle } from "lucide-react";

interface Props {
  externalIds: Record<string, any>;
  updateExternalId: (key: string, val: string) => void;
  category?: string; // "work" | "artist" | "release" | "franchise"
}

export function EditorExternalIds({ externalIds = {}, updateExternalId, category }: Props) {
  const { t, locale } = useI18n();
  const [definitions, setDefinitions] = useState<ExternalDatabaseDefinition[]>([]);
  const [selectedCodeToAdd, setSelectedCodeToAdd] = useState("");
  const [customKey, setCustomKey] = useState("");

  useEffect(() => {
    fetchExternalDatabases(category)
      .then((res) => {
        if (res?.items) {
          setDefinitions(res.items);
        }
      })
      .catch(() => {});
  }, [category]);

  const defMap = new Map<string, ExternalDatabaseDefinition>();
  for (const d of definitions) {
    defMap.set(d.code.toLowerCase(), d);
  }

  // 现有的所有 keys
  const currentEntries = Object.entries(externalIds).filter(([_, v]) => v !== undefined && v !== null);

  const handleValueChange = (code: string, rawVal: string, def?: ExternalDatabaseDefinition) => {
    let val = rawVal.trim();
    // 智能提取：如果用户粘贴了完整的 URL，且匹配 URLPattern，则自动提取 ID
    if (def && def.url_pattern && (val.startsWith("http://") || val.startsWith("https://"))) {
      try {
        const regexStr = def.url_pattern
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace("\\{id\\}", "([^/?#]+)");
        const re = new RegExp(regexStr);
        const match = val.match(re);
        if (match && match[1]) {
          val = match[1];
        }
      } catch (e) {}
    }
    updateExternalId(code, val);
  };

  const handleRemove = (code: string) => {
    updateExternalId(code, "");
  };

  const handleAdd = () => {
    const code = selectedCodeToAdd === "custom" ? customKey.trim().toLowerCase() : selectedCodeToAdd;
    if (!code) return;
    if (externalIds[code] === undefined) {
      updateExternalId(code, "");
    }
    setSelectedCodeToAdd("");
    setCustomKey("");
  };

  // 可供选择添加的定义（未在现有列表中的）
  const existingKeys = new Set(Object.keys(externalIds).map((k) => k.toLowerCase()));
  const availableDefs = definitions.filter((d) => !existingKeys.has(d.code.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <p>{t("editor.external.tip") || "关联各大权威外部数据库（支持输入对应 ID 或完整网页链接，系统将自动解析与规范化外链）。"}</p>
      </div>

      {/* 现有条目列表 */}
      <div className="space-y-3">
        {currentEntries.map(([code, val]) => {
          const def = defMap.get(code.toLowerCase());
          const name = def ? (locale === "zh-CN" ? def.name_zh : def.name_en) || def.name_zh || def.code : code;
          const strVal = String(val || "");
          
          let previewUrl = "";
          let isValid = true;
          let validationMsg = "";

          if (strVal) {
            if (strVal.startsWith("http://") || strVal.startsWith("https://")) {
              previewUrl = strVal;
            } else if (def && def.url_pattern) {
              previewUrl = def.url_pattern.replace(/\{id\}/g, strVal);
            }

            if (def && def.validation_regex && !strVal.startsWith("http")) {
              try {
                const reg = new RegExp(def.validation_regex);
                isValid = reg.test(strVal);
                if (!isValid) {
                  validationMsg = `格式不符 (规则: ${def.validation_regex})`;
                }
              } catch (e) {}
            }
          }

          return (
            <div
              key={code}
              className="p-3 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.01] dark:bg-white/[0.02] flex flex-col sm:flex-row sm:items-center gap-3"
            >
              {/* 数据库标识与图标 */}
              <div className="w-40 shrink-0 flex items-center gap-2">
                {def?.icon_url ? (
                  <img src={def.icon_url} alt="" className="w-4 h-4 object-contain" />
                ) : (
                  <Globe className="w-4 h-4 text-sky-500 opacity-70" />
                )}
                <div>
                  <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">{name}</div>
                  <div className="text-[10px] font-mono text-gray-400">{code}</div>
                </div>
              </div>

              {/* 输入框 */}
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={strVal}
                  onChange={(e) => handleValueChange(code, e.target.value, def)}
                  placeholder={def?.description || `输入 ${name} ID 或 URL...`}
                  className={`w-full px-3 py-1.5 rounded-md bg-background border text-xs font-mono text-gray-900 dark:text-white focus:outline-none transition-colors ${
                    !isValid
                      ? "border-rose-500 focus:border-rose-500"
                      : "border-black/10 dark:border-white/10 focus:border-primary"
                  }`}
                />
                {!isValid && validationMsg && (
                  <div className="absolute right-2.5 top-2 flex items-center gap-1 text-[10px] text-rose-500 font-mono">
                    <AlertCircle className="w-3 h-3" />
                    <span>{validationMsg}</span>
                  </div>
                )}
              </div>

              {/* 操作与外链预览 */}
              <div className="flex items-center gap-2 shrink-0">
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`测试外链预览: ${previewUrl}`}
                    className="p-1.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] hover:bg-sky-500/10 text-gray-600 dark:text-gray-300 hover:text-sky-500 border border-black/10 dark:border-white/10 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(code)}
                  title="移除此外部标识"
                  className="p-1.5 rounded-md hover:bg-rose-500/10 text-gray-400 hover:text-rose-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 快速添加栏 */}
      <div className="pt-2 flex flex-wrap items-center gap-2">
        <select
          value={selectedCodeToAdd}
          onChange={(e) => setSelectedCodeToAdd(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-background border border-black/10 dark:border-white/10 text-xs font-mono text-gray-700 dark:text-gray-300 focus:outline-none focus:border-primary"
        >
          <option value="">+ 选择要关联的外部数据库...</option>
          {availableDefs.map((d) => (
            <option key={d.code} value={d.code}>
              {(locale === "zh-CN" ? d.name_zh : d.name_en) || d.name_zh || d.code} ({d.code})
            </option>
          ))}
          <option value="custom">-- 自定义其他数据库代码 (Custom ID) --</option>
        </select>

        {selectedCodeToAdd === "custom" && (
          <input
            type="text"
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            placeholder="如: goodreads, douban..."
            className="px-3 py-1.5 rounded-lg bg-background border border-black/10 dark:border-white/10 text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:border-primary w-40"
          />
        )}

        <button
          type="button"
          disabled={!selectedCodeToAdd || (selectedCodeToAdd === "custom" && !customKey.trim())}
          onClick={handleAdd}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加字段</span>
        </button>
      </div>
    </div>
  );
}

