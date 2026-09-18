"use client";

// 对比篮子的唯一实现。此前 CompareView、releases/[id]、works/[id] 与 works/[id]/releases
// 各有一份读写逻辑，且都没监听 storage——一个标签页加入后另一个标签页不刷新就一直显示旧篮子。
// 这里只保留一套解析/去重/上限语义（沿用既有表现：非字符串或空白项丢弃、上限 6、后者胜出），
// 组件侧统一走 useCompareBasket 订阅跨标签页变化。

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

export const COMPARE_MIN_SLOTS = 2;
export const COMPARE_MAX_SLOTS = 6;
export const COMPARE_BASKET_KEY = "metafusion_compare_basket";

/** 读取篮子：localStorage 不可用或内容不是合法 JSON/数组时一律回落空篮子，不抛异常。 */
export function readCompareBasket(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COMPARE_BASKET_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  } catch {
    // 存储不可用（隐私模式）或 JSON 损坏：按空篮子继续，坏数据留在原处不覆盖也不清空。
    return [];
  }
}

/** 清洗外部传来的 id 列表：trim、去重、上限截断。 */
export function normalizeBasket(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((x) => x.trim()).filter(Boolean))).slice(0, COMPARE_MAX_SLOTS);
}

/** 写入篮子（已归一化）：存储不可用时静默放弃，内存状态仍由调用方维护。 */
export function writeCompareBasket(ids: readonly string[]): string[] {
  const next = normalizeBasket(ids);
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(COMPARE_BASKET_KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用 */
  }
  return next;
}

/** 整组替换。 */
export function mergeIntoBasket(ids: readonly string[]): string[] {
  return writeCompareBasket(ids);
}

/** 加入（已在篮子里则原样返回，满了也原样返回——上限语义与既有实现一致）。 */
export function addToBasket(current: readonly string[], id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [...current];
  if (current.includes(trimmed)) return [...current];
  if (current.length >= COMPARE_MAX_SLOTS) return [...current];
  return writeCompareBasket([...current, trimmed]);
}

/** 移除。 */
export function removeFromBasket(current: readonly string[], id: string): string[] {
  return writeCompareBasket(current.filter((x) => x !== id));
}

/** 切换：在则移除，不在则加入（满了保持原样）。 */
export function toggleBasket(current: readonly string[], id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [...current];
  return current.includes(trimmed) ? removeFromBasket(current, trimmed) : addToBasket(current, trimmed);
}

/** 篮子 URL（/compare?ids=…），空篮子回 /compare。 */
export function compareHref(ids: readonly string[]): string {
  const cleaned = ids.map((x) => x.trim()).filter(Boolean);
  if (cleaned.length === 0) return "/compare";
  return `/compare?ids=${encodeURIComponent(cleaned.join(","))}`;
}

export interface CompareBasket {
  /** 当前篮子（含跨标签页同步结果）。 */
  basket: string[];
  /** 写入篮子并更新本地状态（等价于整组替换）。 */
  setBasket: Dispatch<SetStateAction<string[]>>;
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
}

/**
 * 篮子状态 + 跨标签页同步。
 *
 * storage 事件只在"其它"标签页写入时触发，正好是需要重读的场景：本页写入由 setState 生效，
 * 不会重复回调，也不会出现回写循环。visibilitychange 兜底覆盖 storage 事件丢失/被阻断的情况。
 * 卸载时移除两个监听。
 */
export function useCompareBasket(): CompareBasket {
  const [basket, setBasketState] = useState<string[]>([]);

  useEffect(() => {
    const resync = () => {
      const next = readCompareBasket();
      // 值相同时保留原引用：避免每次 focus 都触发依赖 basket 的渲染与请求。
      setBasketState((prev) =>
        prev.length === next.length && prev.every((x, i) => x === next[i]) ? prev : next,
      );
    };
    resync();

    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== COMPARE_BASKET_KEY) return;
      resync();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") resync();
    };

    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const actions = useMemo(
    () => ({
      setBasket: ((value: SetStateAction<string[]>) => {
        setBasketState((prev) => mergeIntoBasket(typeof value === "function" ? (value as (p: string[]) => string[])(prev) : value));
      }) as Dispatch<SetStateAction<string[]>>,
      add: (id: string) => setBasketState((prev) => addToBasket(prev, id)),
      remove: (id: string) => setBasketState((prev) => removeFromBasket(prev, id)),
      toggle: (id: string) => setBasketState((prev) => toggleBasket(prev, id)),
      clear: () => setBasketState(() => mergeIntoBasket([])),
    }),
    [],
  );

  return useMemo(() => ({ basket, ...actions }), [basket, actions]);
}
