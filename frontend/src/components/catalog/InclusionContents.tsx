"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions } from "@/lib/definitions";
import { Entity, title } from "./api";
import { GroupAttributeInline, LocatorInline } from "./TemplateAttributeSections";

/** 载体与轨道详情统一展示收录表达、选段与本版定位。 */
export function InclusionContents({
  contents,
  expressions,
  loading = false,
}: {
  contents: Entity["contents"] | undefined;
  expressions: Record<string, Entity>;
  loading?: boolean;
}) {
  const { locale, t } = useI18n();
  const { definitions } = useDefinitions();
  if (!contents?.length) return null;
  return (
    <ul className="m-0 list-none space-y-1.5 pl-0 text-xs">
      {[...contents].sort((a, b) => a.position - b.position).map((content, index) => {
        const expression = expressions[content.expression_id];
        return (
          <li key={`${content.expression_id}-${index}`} className="space-y-0.5">
            {expression ? (
              <Link href={`/catalog/${expression.id || content.expression_id}`} className="text-primary hover:underline">
                {title(expression, locale)}
              </Link>
            ) : (
              <span className="text-text-muted">{t(loading ? "catalog.entityReference" : "catalog.referenceUnknown")}</span>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
              <LocatorInline defs={definitions} value={content.locator} locale={locale} />
              <GroupAttributeInline defs={definitions} code="inclusion_attributes" value={content.attributes} locale={locale} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
