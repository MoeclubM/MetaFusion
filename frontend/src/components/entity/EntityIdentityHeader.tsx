import { LocalizedTitleGroups } from "@/components/entity/LocalizedTitleGroups";

type EntityTranslations = Record<
  string,
  { title?: string; name?: string; summary?: string; aliases?: string[] }
>;

/** 详情页共用题名区；事实字段与正文仍由实体类型页面负责。 */
export function EntityIdentityHeader({
  title,
  translations,
  originalLanguage,
}: {
  title: string;
  translations?: EntityTranslations;
  originalLanguage?: string | null;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <h1 className="break-words font-display text-2xl font-bold leading-tight tracking-tight text-text-strong sm:text-3xl">
        {title}
      </h1>
      <LocalizedTitleGroups
        translations={translations}
        originalLanguage={originalLanguage}
        displayTitle={title}
        className="space-y-0.5"
        itemClassName="font-mono text-xs text-text-muted"
      />
    </div>
  );
}
