"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { EntityTranslation } from "@/lib/api";
import {
  filterDisplayAliases,
  groupTitlesByLocale,
  titleLocaleLabelKey,
  visibleTitleGroups,
} from "@/lib/titles";

interface Props {
  translations?: EntityTranslation[];
  aliases?: string[];
  /** 实体内容语言（ISO 639-1），用于标记原始语言分组 */
  originalLanguage?: string | null;
  /** 主标题行已展示的标题：分组内重复时自动隐藏 */
  displayTitle?: string | null;
  /** 实体级基础字段（title/original_title 等），参与别名过滤 */
  extraKnown?: Array<string | null | undefined>;
  className?: string;
  itemClassName?: string;
}

/**
 * 多语言标题按语种分组展示：`中文：A / B`、`日本語（原始语言）：C`。
 * 实体级 aliases 只展示翻译行未覆盖的真正异名。
 */
export function LocalizedTitleGroups({
  translations,
  aliases,
  originalLanguage,
  displayTitle,
  extraKnown,
  className,
  itemClassName,
}: Props) {
  const { t } = useI18n();
  const groups = React.useMemo(
    () => visibleTitleGroups(groupTitlesByLocale(translations, originalLanguage), displayTitle),
    [translations, originalLanguage, displayTitle],
  );
  const rest = React.useMemo(
    () => filterDisplayAliases(aliases, translations, extraKnown),
    [aliases, translations, extraKnown],
  );
  if (groups.length === 0 && rest.length === 0) return null;
  const cls = itemClassName ?? "text-gray-500";
  return (
    <div className={className ?? "space-y-0.5"}>
      {groups.map((g) => {
        const labelKey = titleLocaleLabelKey(g.locale);
        const localeLabel = labelKey ? t(labelKey) : g.locale;
        const titles = [g.primary, ...g.aliases].filter(Boolean).join(" / ");
        return (
          <p key={g.locale} className={cls}>
            {t(g.isOriginal ? "entity.titles.groupOriginal" : "entity.titles.group", {
              locale: localeLabel,
              titles,
            })}
          </p>
        );
      })}
      {rest.length > 0 && (
        <p className={cls}>{t("entity.titles.aliases", { value: rest.join(" / ") })}</p>
      )}
    </div>
  );
}
