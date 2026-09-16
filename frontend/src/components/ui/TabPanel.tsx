"use client";

import React from "react";

const SPACING: Record<string, string> = {
  /** 页签条与内容之间 16px（与区块间距同口径）。 */
  sections: "pt-4 space-y-4",
  /** 面板本身是列表/卡片容器时用，间距由容器自己给。 */
  container: "",
  none: "",
};

/**
 * 页签内容面板。组件契约（调用方不需要、也不应该自己写）：
 *
 * 1. 必须传 activeKey —— 当前选中的页签/视图 id。组件把它作为 React key 挂在面板上，
 *    切换时整个面板树重挂载，从而重放 .mf-tabpanel 的 mf-tab-in 进入动画。
 *    页面自己写 key + className="mf-tabpanel" 时，漏掉随切换源变化的 key 就会退化成
 *    "只在首帧动一次"，这正是各页动画不一致的原因，所以把 key 收进组件里。
 * 2. 页签条与内容的间距由 spacing 统一，页面不要再写 pt-* 与 mt-* 调间距。
 */
export function TabPanel({
  activeKey,
  id,
  labelledBy,
  role,
  spacing = "sections",
  className = "",
  children,
}: {
  activeKey: string;
  id?: string;
  labelledBy?: string;
  role?: string;
  spacing?: "sections" | "container" | "none";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      key={activeKey}
      data-mf-tabpanel={activeKey}
      role={role}
      id={role ? id : undefined}
      aria-labelledby={role ? labelledBy : undefined}
      className={`mf-tabpanel ${SPACING[spacing]} ${className}`}
    >
      {children}
    </div>
  );
}
