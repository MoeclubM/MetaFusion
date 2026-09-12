"use client";

import React from "react";
import Link from "next/link";
import { DynamicDefinitions, resolveLocalizedName, getTermName } from "@/lib/definitions";
import { Calendar, Hash, Clock, ExternalLink, Link2, Check, Minus } from "lucide-react";

// 说明：属性分区渲染已统一到 @/components/work/WorkFacts（两个详情页共用）。
// 本文件只保留按字段类型渲染取值的原子能力与时长字段查找，供 WorkFacts 与
// 其它页面复用，避免同一套类型分发逻辑出现多份实现。

// FieldValue 按 definitions 声明的字段类型渲染，未知类型退化为纯文本。
// field 可显式传入字段定义（用于列表项内的嵌套子字段，其字段码不在顶层 fields 里）。
export function FieldValue({
  code,
  value,
  defs,
  locale,
  field,
}: {
  code: string;
  value: any;
  defs: DynamicDefinitions | null | undefined;
  locale: string;
  field?: any;
}) {
  const def = field || defs?.fields?.[code];
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
    return <span>{value ? <Check className="w-3.5 h-3.5 inline-block" strokeWidth={2} /> : <Minus className="w-3.5 h-3.5 inline-block text-gray-400" strokeWidth={2} />}</span>;
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

// RecordList：渲染 definitions 声明的"记录列表"字段（附件/特典/事件等）。
// 每项按声明的子字段通用渲染（label 作为条目标题），不写死任何子字段码；
// 后台增删子字段即刻生效。entity 子字段由 FieldValue 走链接渲染。
export function RecordList({
  items,
  field,
  defs,
  locale,
  fallbackLabel,
}: {
  items: Record<string, any>[];
  field: any;
  defs: DynamicDefinitions | null | undefined;
  locale: string;
  fallbackLabel?: (index: number) => string;
}) {
  const fields: Record<string, any> = field?.fields || {};
  const codes = Object.keys(fields).filter((c) => c !== "label" && fields[c]?.enabled !== false && !fields[c]?.hidden);
  return (
    <ul className="space-y-2">
      {items.map((rec, i) => {
        const extras = codes.filter((c) => rec[c] !== undefined && rec[c] !== null && rec[c] !== "");
        return (
          <li key={i} className="text-xs text-gray-700 dark:text-gray-300">
            <span className="font-medium">
              {localizedValue(rec.label, locale) || fallbackLabel?.(i) || ""}
            </span>
            {extras.length > 0 && (
              <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {extras.map((c) => (
                  <div key={c} className="flex items-baseline gap-1">
                    <dt className="text-[11px] text-gray-500">{resolveLocalizedName(fields[c]?.names, locale, c)}</dt>
                    <dd>
                      <FieldValue code={c} value={rec[c]} defs={defs} locale={locale} field={fields[c]} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// localizedValue：多语言值取当前语种（与 FieldValue 的 multilingual 语义一致）。
function localizedValue(v: any, locale: string): string {
  if (v && typeof v === "object") return resolveLocalizedName(v, locale, "");
  if (typeof v === "string") return v;
  return "";
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
