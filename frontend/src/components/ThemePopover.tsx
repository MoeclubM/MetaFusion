"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

/** 主题控件共用的弹出容器；导航对话框内按文档流展开，避免被滚动面板裁切。 */
export function ThemePopover({ label, title, icon, withinDialog = false, children }: {
  label: string;
  title?: string;
  icon: React.ReactNode;
  withinDialog?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(true);
  const panelId = useId();
  const close = () => { restoreFocusRef.current = true; setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const initial = panel?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel?.querySelector<HTMLElement>("button");
    initial?.focus();
    initial?.scrollIntoView({ block: "nearest" });
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) { restoreFocusRef.current = false; setOpen(false); }
    };
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      if (restoreFocusRef.current && buttonRef.current?.isConnected) buttonRef.current.focus();
    };
  }, [open]);

  return (
    <div ref={containerRef} className={withinDialog ? "contents" : "relative"} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { restoreFocusRef.current = false; setOpen(false); }
    }}>
      <button ref={buttonRef} type="button" title={title ?? label} aria-label={label} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? panelId : undefined} onClick={() => { restoreFocusRef.current = true; setOpen((value) => !value); }} className="mf-focus order-1 grid h-9 w-9 max-sm:min-h-11 place-items-center rounded-control border border-line bg-surfaceSubtle text-text-body transition-colors duration-fast ease-soft hover:bg-surfaceHover">
        {icon}
      </button>
      {open && <div ref={panelRef} id={panelId} role="dialog" aria-label={label} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      }} className={`${withinDialog ? "order-2 col-span-full min-w-0 w-full" : "absolute right-0 mt-1.5 w-[19rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto max-sm:fixed max-sm:left-4 max-sm:right-4 max-sm:top-16 max-sm:mt-0 max-sm:w-auto"} z-50 space-y-3 rounded-panel border border-line bg-surface p-4 shadow-elevated`}>
        <div className="flex items-center justify-between gap-2 border-b border-line-subtle pb-2">
          <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-strong">{icon}<span>{label}</span></span>
          <button type="button" aria-label={t("revisions.close")} onClick={close} className="mf-focus grid h-8 w-8 shrink-0 place-items-center rounded-control text-text-muted hover:bg-surfaceHover"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {children(close)}
      </div>}
    </div>
  );
}
