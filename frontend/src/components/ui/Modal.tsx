"use client";
import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

// 可聚焦元素：与浏览器 Tab 顺序一致，用于最小实现的焦点陷阱。
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 同时打开的对话框栈：Esc 只关栈顶，滚动锁只由"第一个打开/最后一个关闭"成对增删，
// 否则嵌套对话框关掉内层会把外层还开着的滚动锁一起解开。
const modalStack: HTMLElement[] = [];
let savedBodyOverflow = "";

export function Modal({
 open,
 onClose,
 title,
 icon,
 children,
 maxWidth = "max-w-lg",
}: {
 open: boolean;
 onClose: () => void;
 title: React.ReactNode;
 icon?: React.ReactNode;
 children: React.ReactNode;
 maxWidth?: string;
}) {
 const { t } = useI18n();
 const titleId = useId();
 const panelRef = useRef<HTMLDivElement>(null);
 // 关闭后把焦点还给打开它的按钮：读屏与键盘用户不会"掉"到页面顶部。
 const restoreRef = useRef<HTMLElement | null>(null);

 useEffect(() => {
  if (!open) return;
  const panel = panelRef.current;
  if (!panel) return;
  restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
  modalStack.push(panel);

  if (modalStack.length === 1) {
   savedBodyOverflow = document.body.style.overflow;
   document.body.style.overflow = "hidden";
  }

  const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  (focusable()[0] ?? panel).focus();

  function onKeyDown(e: KeyboardEvent) {
   if (modalStack[modalStack.length - 1] !== panel) return;
   if (e.key === "Escape") {
    e.preventDefault();
    onClose();
    return;
   }
   if (e.key !== "Tab") return;
   const items = focusable();
   if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
   }
   const first = items[0];
   const last = items[items.length - 1];
   const active = document.activeElement;
   if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
    e.preventDefault();
    last.focus();
   } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
   }
  }

  document.addEventListener("keydown", onKeyDown);
  return () => {
   document.removeEventListener("keydown", onKeyDown);
   const index = modalStack.indexOf(panel);
   if (index >= 0) modalStack.splice(index, 1);
   if (modalStack.length === 0) document.body.style.overflow = savedBodyOverflow;
   const restore = restoreRef.current;
   if (restore && restore.isConnected) restore.focus();
  };
 }, [open, onClose]);

 if (!open) return null;
 return (
 <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
 <div
 ref={panelRef}
 role="dialog"
 aria-modal="true"
 aria-labelledby={titleId}
 tabIndex={-1}
 onClick={(e) => e.stopPropagation()}
 className={`w-full ${maxWidth} rounded-lg border border-line bg-surface p-5 sm:p-6 space-y-4 shadow-elevated max-h-[90vh] overflow-y-auto outline-none`}
 >
 <div className="flex items-center justify-between border-b border-line-subtle pb-3">
 <h3 id={titleId} className="text-sm font-semibold text-text-strong flex items-center gap-2">
 {icon}
 {title}
 </h3>
 <button type="button" onClick={onClose} aria-label={t("revisions.close")} className="text-text-muted hover:text-gray-900 dark:hover:text-white p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-fast ease-soft w-9 h-9 max-sm:min-h-[44px] grid place-items-center cursor-pointer">
 <X className="w-4 h-4" aria-hidden="true" />
 </button>
 </div>
 {children}
 </div>
 </div>
 );
}
