"use client";

import React, { useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicDefinitions, resolveLocalizedName, getFieldName, getTermName } from "@/lib/definitions";
import { FieldValue } from "@/components/catalog/TemplateAttributeSections";

// WorkFacts：作品/实体的信息面板，按实体**自身类型**引用的模板分区渲染。
// 两个详情页（/works/[id] 与 /catalog/[id]）共用同一实现，避免字段集合与
// 展示次序各写一份而漂移。分区、字段、次序全部来自服务端 definitions，
// 代码不写死任何字段码；hidden 字段（如资料表原始条目）不进面板但仍可检索。
export function WorkFacts({
  entity,
  defs,
  locale,
  className = "",
}: {
  entity: { kind?: string; types?: string[] | null; attributes?: Record<string, any> | null } | null;
  defs: DynamicDefinitions | null | undefined;
  locale: string;
  className?: string;
}) {
  const { t } = useI18n();

  const { sections, restFields } = useMemo(() => {
    const attrs = entity?.attributes || {};
    const visible = (code: string) => {
      const v = attrs[code];
      if (v === undefined || v === null || v === "") return false;
      // 存档字段不进信息面板（页面上有专用区块呈现）。
      if (defs?.fields?.[code]?.hidden) return false;
      return true;
    };
    const typeCodes = entity?.types || [];
    // 合并该实体全部类型引用的模板分区，按声明次序去重。
    const templates = Array.from(
      new Set(typeCodes.map((c) => defs?.types?.[c]?.template).filter(Boolean) as string[]),
    )
      .map((code) => defs?.templates?.[code])
      .filter(Boolean) as any[];

    const seen = new Set<string>();
    const out: { names: Record<string, string>; fields: string[] }[] = [];
    for (const tpl of templates) {
      for (const sec of tpl.sections || []) {
        const fields = (sec.fields || []).filter((f: string) => !seen.has(f) && visible(f));
        if (!fields.length) continue;
        fields.forEach((f: string) => seen.add(f));
        out.push({ names: sec.names || {}, fields });
      }
    }
    // 模板未覆盖的属性兜底展示，避免数据被隐藏；同样排除存档字段。
    const rest = Object.keys(attrs).filter((k) => !seen.has(k) && visible(k));
    return { sections: out, restFields: rest };
  }, [entity, defs]);

  if (!defs) return null;
  if (!sections.length && !restFields.length) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {sections.map((sec, i) => (
        <Section key={`s${i}`} title={resolveLocalizedName(sec.names, locale, "")}>
          {sec.fields.map((code) => (
            <Row key={code} label={getFieldName(defs, code, locale)}>
              <FieldValue code={code} value={(entity?.attributes || {})[code]} defs={defs} locale={locale} />
            </Row>
          ))}
        </Section>
      ))}
      {restFields.length > 0 && (
        <Section title={t("catalog.attributes")}>
          {restFields.map((code) => (
            <Row key={code} label={getFieldName(defs, code, locale) || code}>
              <FieldValue code={code} value={(entity?.attributes || {})[code]} defs={defs} locale={locale} />
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      {title && (
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-gray-400 pb-1.5 mb-2 border-b border-black/5 dark:border-white/[0.06]">
          {title}
        </h3>
      )}
      {/* 键值对栅格：左侧标签定宽右对齐、右侧取值，压缩行高以提升信息密度。 */}
      <dl className="grid grid-cols-[minmax(72px,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs items-baseline">
        {children}
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-400 text-[11px] leading-5 text-right">{label}</dt>
      <dd className="text-gray-900 dark:text-white leading-5 break-words min-w-0">{children}</dd>
    </>
  );
}

export default WorkFacts;

// entityBadges 按模板声明计算标题旁的徽章：主日期字段 + badge_fields。
// 字段码来自服务端模板，两个详情页共用，避免各自写死 edition_date/format。
export function entityBadges(
  entity: { types?: string[] | null; attributes?: Record<string, any> | null } | null,
  defs: DynamicDefinitions | null | undefined,
  locale: string,
): { kind: "date" | "field"; text: string }[] {
  const attrs: Record<string, any> = entity?.attributes || {};
  const typeCodes = entity?.types || [];
  const templates = typeCodes
    .map((c) => defs?.templates?.[defs?.types?.[c]?.template || ""])
    .filter(Boolean) as any[];
  const out: { kind: "date" | "field"; text: string }[] = [];
  const dateField = templates.map((tp) => tp.primary_date_field).find(Boolean) as string | undefined;
  if (dateField && attrs[dateField] && !defs?.fields?.[dateField]?.hidden) {
    out.push({ kind: "date", text: String(attrs[dateField]) });
  }
  const badgeFields: string[] = Array.from(new Set(templates.flatMap((tp) => tp.badge_fields || [])));
  for (const code of badgeFields) {
    if (!attrs[code] || defs?.fields?.[code]?.hidden) continue;
    const def: any = defs?.fields?.[code];
    const text =
      def?.type === "enum" && def?.vocabulary
        ? getTermName(defs, def.vocabulary, String(attrs[code]), locale)
        : String(attrs[code]);
    out.push({ kind: "field", text });
  }
  return out;
}
