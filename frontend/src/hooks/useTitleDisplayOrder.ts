"use client";

import { useEffect, useState } from "react";
import { TITLE_ORDER_CHANGED_EVENT, getTitleDisplayOrder } from "@/lib/titles";

/**
 * 订阅标题显示语言优先级变化：设置页调整顺序后，
 * 详情/探索等页面的 pickLocalized 结果实时更新。
 * 返回递增版本号，调用方在 pickLocalized 的 useMemo 依赖中引用即可。
 */
export function useTitleDisplayOrderVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1);
    window.addEventListener(TITLE_ORDER_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TITLE_ORDER_CHANGED_EVENT, onChange);
  }, []);
  return version;
}

/** 读取当前标题显示语言优先级（空数组 = 默认回退链）。 */
export function useTitleDisplayOrder(): string[] {
  const version = useTitleDisplayOrderVersion();
  const [order, setOrder] = useState<string[]>(() => getTitleDisplayOrder());
  useEffect(() => {
    setOrder(getTitleDisplayOrder());
  }, [version]);
  return order;
}
