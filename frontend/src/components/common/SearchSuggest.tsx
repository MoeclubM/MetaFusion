"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions, getKindName } from "@/lib/definitions";
import { pickRecordTitle } from "@/lib/titles";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import { kindIcon } from "@/lib/kindIcons";

interface SuggestItem {
  id: string;
  kind: string;
  title: string;
  original_language?: string;
  translations?: Record<string, { title?: string; summary?: string; aliases?: string[] }>;
  pictures?: { url: string }[];
}

interface SearchSuggestProps {
  value: string;
  onValueChange: (v: string) => void;
  /** 整词提交（回车且未选中联想项、或点搜索按钮） */
  onSubmit: (q: string) => void;
  placeholder: string;
  submitLabel: string;
  ariaLabel?: string;
  size?: "lg" | "md";
  className?: string;
}

const LIST_ID = "mf-search-suggest";

/**
 * 带联想的搜索框：输入即下拉候选（封面缩略 + 类型 + 题名），
 * 回车选中候选直达详情，否则整词提交给调用方。
 * 没有联想时搜索只是"提交表单"——用户要整页跳转后才知道有没有命中。
 */
export function SearchSuggest({
  value,
  onValueChange,
  onSubmit,
  placeholder,
  submitLabel,
  ariaLabel,
  size = "md",
  className = "",
}: SearchSuggestProps) {
  const { t, tr, locale } = useI18n();
  const { kinds } = useDefinitions();
  const titleOrder = useTitleDisplayOrder();
  const router = useRouter();

  const [items, setItems] = useState<SuggestItem[]>([]);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = value.trim();

  useEffect(() => {
    if (!q) {
      setItems([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      fetch(
        "/api/catalog/entities?q=" + encodeURIComponent(q) + "&limit=8&status=published",
        { credentials: "same-origin" },
      )
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data) => {
          if (alive) setItems(Array.isArray(data.items) ? data.items.slice(0, 8) : []);
        })
        .catch(() => {
          // 联想失败不打断输入：静默收起下拉，整词搜索仍可用。
          if (alive) setItems([]);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const open = focused && q.length > 0 && items.length > 0;

  const displayTitle = (item: SuggestItem) =>
    pickRecordTitle(locale, item.translations, item.title, {
      order: titleOrder,
      originalLanguage: item.original_language,
    });

  const go = (item: SuggestItem) => {
    setFocused(false);
    setActive(-1);
    inputRef.current?.blur();
    router.push("/catalog/" + item.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "Enter") onSubmit(q);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) go(items[active]);
      else onSubmit(q);
    } else if (e.key === "Escape") {
      setFocused(false);
      setActive(-1);
    }
  };

  const lg = size === "lg";

  return (
    <form
      className={"relative flex items-center " + className}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(q);
      }}
      role="search"
    >
      <Search
        className={
          "absolute top-1/2 -translate-y-1/2 text-text-muted pointer-events-none " +
          (lg ? "w-5 h-5 left-4" : "w-4 h-4 left-3.5")
        }
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        aria-label={ariaLabel || placeholder}
        onChange={(e) => {
          onValueChange(e.target.value);
          setActive(-1);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // 延迟收起：让候选项的 mousedown 先于失焦生效。
          setTimeout(() => setFocused(false), 120);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={
          "w-full border border-line hover:border-emphasis/20 focus:border-primary focus:ring-1 " +
          "focus:ring-primary text-emphasis placeholder:text-text-faint outline-none " +
          "transition-all duration-base ease-soft " +
          (lg
            ? "pl-12 pr-24 py-3.5 rounded-xl text-sm bg-emphasis/[0.04]"
            : "pl-10 pr-20 py-2 rounded-lg text-xs bg-black/[0.02] dark:bg-white/[0.04] focus:bg-surface")
        }
      />
      <button
        type="submit"
        className={
          "absolute top-1/2 -translate-y-1/2 transition-colors duration-fast ease-soft cursor-pointer " +
          (lg
            ? "right-2 px-5 py-2 rounded-lg text-sm bg-primary hover:bg-primary/90 text-white font-medium shadow-2xs"
            : "right-1.5 px-3 py-1 rounded text-xs font-semibold bg-primary/15 hover:bg-primary/25 text-primary")
        }
      >
        {submitLabel}
      </button>

      {open && (
        <ul
          id={LIST_ID}
          role="listbox"
          aria-label={t("search.suggestions")}
          className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl border border-line bg-surface shadow-elevated overflow-hidden"
        >
          {items.map((item, i) => {
            const KindIcon = kindIcon(item.kind);
            return (
              <li key={item.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(item);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={
                    "w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors duration-fast " +
                    (i === active ? "bg-surfaceHover" : "hover:bg-surfaceHover")
                  }
                >
                  <span className="w-7 h-9 rounded-md bg-black/[0.04] dark:bg-black/40 border border-line-subtle shrink-0 overflow-hidden flex items-center justify-center">
                    {item.pictures && item.pictures[0]?.url ? (
                      <img
                        src={item.pictures[0].url}
                        alt=""
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <KindIcon className="w-4 h-4 text-text-muted" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-text-strong truncate">
                    {displayTitle(item)}
                  </span>
                  <span className="shrink-0 text-[10px] font-mono text-text-faint">
                    {getKindName(kinds, item.kind, locale, tr("catalog.kind." + item.kind, item.kind))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
