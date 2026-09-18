"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowUp, ArrowDown, RotateCcw, Languages, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguagePicker } from "@/components/common/LanguagePicker";
import {
  canonicalLanguageCode,
  languageNativeName,
  quickLanguages,
  sameLanguage,
} from "@/lib/languages";
import {
  TITLE_ORDER_CHANGED_EVENT,
  getTitleDisplayOrder,
  resetTitleDisplayOrder,
  setTitleDisplayOrder,
} from "@/lib/titles";

// 默认优先级与快捷 chip 的候选都来自语言单一来源（@/lib/languages）；
// 这里只保留"默认排在第几"这一件事：前 5 项是默认回退链顺序。
const BASE_CODES = quickLanguages().map((l) => l.code);

/**
 * 标题/简介显示语言优先级：语种由可搜索的语言选择器挑选（按自称、英文名、中文名、
 * 日文名、代码都能搜），不再要求用户手输语言代码。数据源是语言单一来源，本组件不含语种清单；
 * 也不做语种白名单——任意合法 BCP-47 代码都能进列表（后端只校验格式，不校验是否在候选表内）。
 * 变更即时存 localStorage 并广播。
 */
export function TitleDisplayOrderSetting() {
  const { t } = useI18n();
  const [order, setOrder] = useState<string[]>([]);
  const [custom, setCustom] = useState(false);

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

  // 选择器只会回传语言表里的规范码；这里仍做一次归一与格式校验，挡住从旧 localStorage
  // 读回来的历史写法（ja 与 ja-JP 视为同一语种，不重复添加）。
  const add = (raw: string) => {
    const code = canonicalLanguageCode(raw);
    if (!code) return;
    if (order.some((c) => sameLanguage(c, code))) return;
    persist([...order, code]);
  };

  const reset = () => {
    resetTitleDisplayOrder();
    reload();
  };

  const missingBase = BASE_CODES.filter((c) => !order.some((o) => sameLanguage(o, c)));

  return (
    <div className="p-2.5 rounded-md bg-background border border-line-subtle text-xs font-mono space-y-2">
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
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-line-subtle"
          >
            <span className="w-5 text-center text-gray-400">{i + 1}</span>
            <span className="flex-1 text-text-strong font-sans">{languageNativeName(code)}</span>
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
              className="px-2 py-0.5 rounded-full border border-line text-gray-500 hover:text-gray-900 dark:hover:text-white"
            >
              + {languageNativeName(code)}
            </button>
          ))}
        </div>
      )}
      <div className="pt-1 border-t border-line-subtle">
        <LanguagePicker
          selected={order}
          onSelect={add}
          ariaLabel={t("settings.titleDisplayOrderAdd")}
          variant="field"
        />
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500 font-sans">
        {t("settings.titleDisplayOrderCustomHint")}
      </p>
    </div>
  );
}
