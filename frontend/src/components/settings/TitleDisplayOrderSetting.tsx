"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowUp, ArrowDown, RotateCcw, Languages, Plus, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { CATALOG_LOCALES } from "@/components/editor/localeForm";
import {
  TITLE_ORDER_CHANGED_EVENT,
  getTitleDisplayOrder,
  resetTitleDisplayOrder,
  setTitleDisplayOrder,
} from "@/lib/titles";

const BASE_CODES = CATALOG_LOCALES.map((l) => l.code);

// 后端 ValidLocales 开放的常见语种：可直接作为快速添加候选。
const EXTRA_CODES = ["fr", "de", "es", "pt", "it", "ru", "th", "vi"];
const LANG_CODE_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

const EXTRA_LABEL_KEYS: Record<string, string> = {
  fr: "editor.core.origLangFr",
  de: "editor.core.origLangDe",
};

/**
 * 标题/简介显示语言优先级：基础编目语种之外支持添加任意 BCP-47 代码
 * （后端翻译行白名单内的语种才能落库生效）。未设置时走默认回退链
 * （界面语言 → en-US → 原始语言 → 其余语种）。变更即时存 localStorage 并广播。
 */
export function TitleDisplayOrderSetting() {
  const { t } = useI18n();
  const [order, setOrder] = useState<string[]>([]);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  const reload = useCallback(() => {
    const saved = getTitleDisplayOrder();
    setCustom(saved.length > 0);
    setOrder(saved.length > 0 ? saved : [...BASE_CODES]);
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(TITLE_ORDER_CHANGED_EVENT, reload);
    return () => window.removeEventListener(TITLE_ORDER_CHANGED_EVENT, reload);
  }, [reload]);

  const persist = (next: string[]) => {
    setOrder(next);
    setCustom(true);
    setTitleDisplayOrder(next);
  };

  const move = (code: string, dir: -1 | 1) => {
    const i = order.indexOf(code);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  const remove = (code: string) => {
    persist(order.filter((c) => c !== code));
  };

  const add = (code: string) => {
    const clean = code.trim();
    if (!LANG_CODE_RE.test(clean)) {
      setInvalid(true);
      return;
    }
    if (order.includes(clean)) {
      setDraft("");
      setInvalid(false);
      return;
    }
    setInvalid(false);
    setDraft("");
    persist([...order, clean]);
  };

  const reset = () => {
    resetTitleDisplayOrder();
    setDraft("");
    setInvalid(false);
    reload();
  };

  const labelOf = (code: string) => {
    const found = CATALOG_LOCALES.find((l) => l.code === code);
    if (found) return t(found.labelKey);
    const extra = EXTRA_LABEL_KEYS[code];
    if (extra) return t(extra);
    return code;
  };
  const missingBase = [...BASE_CODES, ...EXTRA_CODES].filter((c) => !order.includes(c));

  return (
    <div className="p-2.5 rounded-md bg-background border border-black/5 dark:border-white/[0.06] text-xs font-mono space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-500 flex items-center gap-1.5">
          <Languages className="w-3.5 h-3.5 text-violet-500" strokeWidth={1.5} />
          <span>{t("settings.titleDisplayOrder")}</span>
        </span>
        {custom && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-900 dark:hover:text-white"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t("settings.titleDisplayOrderReset")}</span>
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500 font-sans">
        {t("settings.titleDisplayOrderDesc")}
      </p>
      <ol className="space-y-1">
        {order.map((code, i) => (
          <li
            key={code}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/[0.06]"
          >
            <span className="w-5 text-center text-gray-400">{i + 1}</span>
            <span className="flex-1 text-gray-900 dark:text-white font-sans">{labelOf(code)}</span>
            <span className="text-gray-400">{code}</span>
            <button
              type="button"
              aria-label={t("settings.titleDisplayOrderMoveUp")}
              disabled={i === 0}
              onClick={() => move(code, -1)}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 text-gray-500"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label={t("settings.titleDisplayOrderMoveDown")}
              disabled={i === order.length - 1}
              onClick={() => move(code, 1)}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 text-gray-500"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label={t("settings.titleDisplayOrderRemove")}
              onClick={() => remove(code)}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ol>
      {missingBase.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {missingBase.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => add(code)}
              className="px-2 py-0.5 rounded-full border border-black/10 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white"
            >
              + {labelOf(code)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 pt-1 border-t border-black/5 dark:border-white/[0.06]">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder={t("settings.titleDisplayOrderAddPlaceholder")}
          className={`flex-1 h-8 px-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border text-xs font-mono text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary ${
            invalid ? "border-rose-400" : "border-black/10 dark:border-white/10"
          }`}
        />
        <button
          type="button"
          onClick={() => add(draft)}
          className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("settings.titleDisplayOrderAdd")}</span>
        </button>
      </div>
      {invalid && (
        <p className="text-[11px] text-rose-500 font-sans">{t("settings.titleDisplayOrderInvalid")}</p>
      )}
      <p className="text-[11px] leading-relaxed text-gray-500 font-sans">
        {t("settings.titleDisplayOrderCustomHint")}
      </p>
    </div>
  );
}
