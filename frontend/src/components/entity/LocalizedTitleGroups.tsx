"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  groupTitlesByLocale,
  titleLocaleLabelKey,
  visibleTitleGroups,
} from "@/lib/titles";

interface Props {
  /** 统一 DTO 的 translations：按 locale 分组的对象（{loc:{title,aliases}}）。 */
  translations?: Record<string, { title?: string; name?: string; summary?: string; aliases?: string[] }>;
  /** 实体内容语言（ISO 639-1），用于标记原始语言分组 */
  originalLanguage?: string | null;
  /** 主标题行已展示的标题：分组内重复时自动隐藏 */
  displayTitle?: string | null;
  /** 实体级基础字段（title 等），参与组内去重 */
  extraKnown?: Array<string | null | undefined>;
  className?: string;
  itemClassName?: string;
}

/**
 * 多语言标题按语种分组展示：`中文：A / B`、`日本語（原始语言）：C`。
 * 分组按"原始语言优先"排序；默认只展开首组（原始语言标题始终可见），
 * 其余语种与并列别名收起，点击切换——避免详情页头部被长标题列表撑开。
 */
export function LocalizedTitleGroups({
  translations,
  originalLanguage,
  displayTitle,
  extraKnown,
  className,
  itemClassName,
}: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = React.useState(false);
  const groups = React.useMemo(
    () => visibleTitleGroups(groupTitlesByLocale(translations, originalLanguage), displayTitle),
    [translations, originalLanguage, displayTitle],
  );
  if (groups.length === 0) return null;
  const cls = itemClassName ?? "text-gray-500";
  const hiddenRows = groups.slice(1).length;
  const visibleGroups = expanded ? groups : groups.slice(0, 1);
  // 组内去重：数据里别名常含与主标题相同的值（同一分组内逐字重复只展示一次）。
  const joinUnique = (values: string[]) => {
    const seen = new Set<string>();
    return values
      .map((v) => (v ?? "").trim())
      .filter((v) => {
        if (!v) return false;
        const key = v.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(" / ");
  };
  return (
    <div className={className ?? "space-y-0.5"}>
      {visibleGroups.map((g) => {
        const labelKey = titleLocaleLabelKey(g.locale);
        const localeLabel = labelKey ? t(labelKey) : g.locale;
        const titles = joinUnique([g.primary, ...g.aliases]);
        return (
          <p key={g.locale} className={cls}>
            {t(g.isOriginal ? "entity.titles.groupOriginal" : "entity.titles.group", {
              locale: localeLabel,
              titles,
            })}
          </p>
        );
      })}
      {hiddenRows > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className={`inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-primary ${cls}`}
        >
          {expanded
            ? t("entity.titles.collapse")
            : t("entity.titles.expandMore", { count: hiddenRows })}
          {expanded ? (
            <ChevronUp className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden />
          )}
        </button>
      )}
    </div>
  );
}
