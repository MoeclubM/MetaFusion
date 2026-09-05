"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowUp, ArrowDown, RotateCcw, Languages, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { CATALOG_LOCALES } from "@/components/editor/localeForm";
import {
  TITLE_ORDER_CHANGED_EVENT,
  getTitleDisplayOrder,
  resetTitleDisplayOrder,
  setTitleDisplayOrder,
} from "@/lib/titles";

const ALL_CODES = CATALOG_LOCALES.map((l) => l.code);

/**
 * 标题/简介显示语言优先级：未设置时走默认回退链
 * （界面语言 → en-US → 原始语言 → 其余语种）。
 * 变更即时存入 localStorage 并广播事件，各详情页实时响应。
 */
export function TitleDisplayOrderSetting() {
  const { t } = useI18n();
  const [order, setOrder] = useState<string[]>([]);
  const [custom, setCustom] = useState(false);

  const reload = useCallback(() => {
    const saved = getTitleDisplayOrder();
    setCustom(saved.length > 0);
    setOrder(saved.length > 0 ? saved : [...ALL_CODES]);
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
    if (order.includes(code)) return;
    persist([...order, code]);
  };

  const reset = () => {
    resetTitleDisplayOrder();
    reload();
  };

  const labelOf = (code: string) => {
    const found = CATALOG_LOCALES.find((l) => l.code === code);
    return found ? t(found.labelKey) : code;
  };
  const missing = ALL_CODES.filter((c) => !order.includes(c));

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
      {missing.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {missing.map((code) => (
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
    </div>
  );
}
