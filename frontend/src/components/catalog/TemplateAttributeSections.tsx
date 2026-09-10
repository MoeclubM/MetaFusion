"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicDefinitions, resolveLocalizedName, getFieldName, getTermName } from "@/lib/definitions";
import { Calendar, Hash, Clock, ExternalLink, Link2 } from "lucide-react";

// TemplateAttributeSections：按实体类型所属模板的 sections 声明，动态渲染属性分区。
// 字段码、分区名、次序、分组**全部来自服务端 definitions**，前台不写死任何字段码；
// 模板未声明或未覆盖的字段回落到末尾"其它信息"，保证数据永远可见。
export function TemplateAttributeSections({
  entity,
  defs,
  locale,
}: {
  entity: { kind?: string; types?: string[] | null; attributes?: Record<string, any> | null };
  defs: DynamicDefinitions | null | undefined;
  locale: string;
}) {
  const { t } = useI18n();

  const { sections, covered } = useMemo(() => {
    const attrs = entity.attributes || {};
    const has = (k: string) => attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== "";
    const typeCodes = entity.types || [];
    // 收集该实体全部类型引用的模板，去重后合并其 sections
    const templates = Array.from(
      new Set(typeCodes.map((c) => defs?.types?.[c]?.template).filter(Boolean) as string[]),
    )
      .map((code) => defs?.templates?.[code])
      .filter(Boolean) as any[];
    const seen = new Set<string>();
    const out: { names: Record<string, string>; fields: string[] }[] = [];
    for (const tpl of templates) {
      for (const sec of tpl.sections || []) {
        const fields = (sec.fields || []).filter((f: string) => !seen.has(f) && has(f));
        if (!fields.length) continue;
        fields.forEach((f: string) => seen.add(f));
        out.push({ names: sec.names || {}, fields });
      }
    }
    return { sections: out, covered: seen };
  }, [entity, defs]);

  // 未被模板覆盖的属性（含自定义字段）单独收尾，避免任何数据被隐藏
  const restFields = useMemo(() => {
    const attrs = entity.attributes || {};
    return Object.keys(attrs).filter(
      (k) => !covered.has(k) && attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== "",
    );
  }, [entity, covered]);

  if (!defs) return null;
  if (!sections.length && !restFields.length) return null;

  return (
    <>
      {sections.map((sec, i) => (
        <Section key={`s${i}`} title={resolveLocalizedName(sec.names, locale, "")}>
          {sec.fields.map((code) => (
            <Row key={code} label={getFieldName(defs, code, locale)}>
              <FieldValue code={code} value={(entity.attributes || {})[code]} defs={defs} locale={locale} />
            </Row>
          ))}
        </Section>
      ))}
      {restFields.length > 0 && (
        <Section title={t("catalog.attributes")}>
          {restFields.map((code) => (
            <Row key={code} label={getFieldName(defs, code, locale) || code}>
              <FieldValue code={code} value={(entity.attributes || {})[code]} defs={defs} locale={locale} />
            </Row>
          ))}
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-3 border-t border-black/5 dark:border-white/[0.06] space-y-2.5">
      <h4 className="text-[11px] font-mono uppercase tracking-wider text-gray-400">{title}</h4>
      <dl className="space-y-2.5 text-xs">{children}</dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-gray-400 font-mono text-[11px] mb-0.5">{label}</dt>
      <dd className="font-medium text-gray-900 dark:text-white break-words">{children}</dd>
    </div>
  );
}

// FieldValue 按 definitions 声明的字段类型渲染，未知类型退化为纯文本。
export function FieldValue({
  code,
  value,
  defs,
  locale,
}: {
  code: string;
  value: any;
  defs: DynamicDefinitions | null | undefined;
  locale: string;
}) {
  const def = defs?.fields?.[code];
  const type = def?.type;

  if (type === "date") {
    return (
      <span className="font-mono inline-flex items-center gap-1">
        <Calendar className="w-3.5 h-3.5 text-amber-500" />
        {String(value)}
      </span>
    );
  }
  if (type === "number") {
    const unit = def?.unit ? resolveLocalizedName(def.unit, locale, "") : "";
    return (
      <span className="font-mono inline-flex items-center gap-1">
        <Hash className="w-3 h-3 text-gray-400" />
        {String(value)}
        {unit ? <span className="text-gray-400">{unit}</span> : null}
      </span>
    );
  }
  if (type === "url") {
    const url = String(value);
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-mono break-all inline-flex items-center gap-1">
        {url.replace(/^https?:\/\//, "")}
        <ExternalLink className="w-3 h-3 shrink-0" />
      </a>
    );
  }
  if (type === "boolean") {
    return <span>{value ? "✓" : "—"}</span>;
  }
  if (type === "enum") {
    return <span className="font-mono">{getTermName(defs, def?.vocabulary || "", String(value), locale)}</span>;
  }
  if (type === "entity") {
    // 已解析的引用（含标题）优先，否则退化为 ID 链接
    const v: any = value;
    const id = typeof v === "string" ? v : v?.id;
    const label = typeof v === "object" ? v?.title || v?.name : "";
    if (!id) return <span>—</span>;
    return (
      <Link href={`/catalog/${id}`} className="text-primary hover:underline inline-flex items-center gap-1">
        <Link2 className="w-3 h-3" />
        {label || id}
      </Link>
    );
  }
  if (type === "multilingual") {
    const m: any = value;
    const text = typeof m === "object" && m ? resolveLocalizedName(m, locale, "") : String(m);
    return <span>{text}</span>;
  }
  if (type === "list" || type === "group" || Array.isArray(value) || (value && typeof value === "object")) {
    return (
      <pre className="text-[11px] font-mono bg-muted/60 p-2 rounded border border-border/50 max-h-40 overflow-auto whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span>{String(value)}</span>;
}

// 时长字段名不写死：从类型模板声明的字段里找 number 类型且单位含"秒"的字段。
export function durationFieldCode(defs: DynamicDefinitions | null | undefined, typeCodes: string[]): string {
  for (const tc of typeCodes) {
    const tpl = defs?.templates?.[defs?.types?.[tc]?.template || ""];
    for (const sec of tpl?.sections || []) {
      for (const f of sec.fields || []) {
        const d: any = defs?.fields?.[f];
        if (d?.type === "number" && d?.unit && JSON.stringify(d.unit).includes("秒")) return f;
      }
    }
  }
  return "";
}

export { Clock };
