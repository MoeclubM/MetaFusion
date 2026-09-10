"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TabItem {
  /** 面板标识，同时作为 URL hash，便于分享与直达。 */
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** 计数等次要信息，显示在标签右侧。 */
  badge?: React.ReactNode;
  /** 仅在这些条件为真时展示该标签。 */
  visible?: boolean;
}

/**
 * useHashTab 管理"当前标签 + URL hash 同步"的通用逻辑：
 * - 进入时按 location.hash 定位，无则取第一个可见标签；
 * - 切换时用 replaceState 写回 hash（可分享、可刷新，且不触发滚动跳转）；
 * - 监听 hashchange，浏览器前进/后退与外部改 hash 都能跟上；
 * - 标签集合变化（数据到达后数量变化）时校正，避免停在已消失的面板。
 */
export function useHashTab(items: TabItem[]) {
  const shown = useMemo(() => items.filter((x) => x.visible !== false), [items]);
  // 标签集合常随每轮渲染重建数组，用 id 签名做依赖，避免监听器反复重订阅。
  const shownKey = shown.map((x) => x.id).join("|");
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const readHash = () =>
    typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.replace(/^#/, ""));

  const [active, setActive] = useState<string>(() => {
    const h = readHash();
    return h && shown.some((x) => x.id === h) ? h : shown[0]?.id || "";
  });

  useEffect(() => {
    if (shown.length === 0) return;
    if (!shown.some((x) => x.id === active)) {
      const h = readHash();
      setActive(h && shown.some((x) => x.id === h) ? h : shown[0].id);
    }
    // shown 已由 shownKey 表达；仅当标签集合或当前值变化时才校正。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, active]);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (h && shownRef.current.some((x) => x.id === h)) setActive(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [shownKey]);

  const select = useCallback((id: string) => {
    setActive(id);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${encodeURIComponent(id)}`);
    }
  }, []);

  return { active, select, shown };
}

/** TabBar 只负责渲染标签按钮条（tablist 语义 + 方向键切换）。 */
export function TabBar({
  items,
  active,
  onSelect,
  ariaLabel,
  className = "",
}: {
  items: TabItem[];
  active: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const shown = items.filter((x) => x.visible !== false);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const idx = shown.findIndex((x) => x.id === active);
    if (idx < 0) return;
    e.preventDefault();
    const next =
      e.key === "ArrowRight" ? (idx + 1) % shown.length : (idx - 1 + shown.length) % shown.length;
    onSelect(shown[next].id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${shown[next].id}"]`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`flex items-center gap-1.5 overflow-x-auto border-b border-black/10 dark:border-white/[0.08] pb-2.5 ${className}`}
    >
      {shown.map((tb) => {
        const on = tb.id === active;
        return (
          <button
            key={tb.id}
            data-tab={tb.id}
            type="button"
            role="tab"
            id={`tab-${tb.id}`}
            aria-selected={on}
            aria-controls={`panel-${tb.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(tb.id)}
            className={`shrink-0 px-3 h-8 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
              on
                ? "bg-primary text-white keep-white border-primary shadow-xs"
                : "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {tb.icon}
            <span>{tb.label}</span>
            {tb.badge != null && (
              <span className={`text-[10px] font-mono ${on ? "text-white/80" : "text-gray-400"}`}>
                {tb.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface DetailTab extends TabItem {
  content: React.ReactNode;
}

/** DetailTabs：只渲染当前面板的整块式标签页（用于 works 等分节规模较大的页面）。 */
export function DetailTabs({
  tabs,
  ariaLabel,
  className = "",
}: {
  tabs: DetailTab[];
  ariaLabel: string;
  className?: string;
}) {
  const { active, select } = useHashTab(tabs);
  const shown = tabs.filter((x: DetailTab) => x.visible !== false);
  const current = shown.find((x: DetailTab) => x.id === active) || shown[0];
  if (!current) return null;

  return (
    <div className={className}>
      <TabBar items={tabs} active={current.id} onSelect={select} ariaLabel={ariaLabel} />
      <div
        role="tabpanel"
        id={`panel-${current.id}`}
        aria-labelledby={`tab-${current.id}`}
        className="pt-6"
      >
        {current.content}
      </div>
    </div>
  );
}
