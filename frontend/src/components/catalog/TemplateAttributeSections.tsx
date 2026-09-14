"use client";

import React from "react";
import Link from "next/link";
import { DynamicDefinitions, resolveLocalizedName, getTermName } from "@/lib/definitions";
import { EntityLink } from "./Fields";
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
    // 已解析的引用（含标题）优先，否则按 id 异步解析出真实标题。
    // 嵌套在 list/group 里的引用拿到的是裸 id，必须走 EntityLink，
    // 否则深层引用只能显示一串 UUID。
    const v: any = value;
    const id = typeof v === "string" ? v : v?.id;
    const label = typeof v === "object" ? v?.title || v?.name : "";
    if (!id) return <span>—</span>;
    if (label) {
      return (
        <Link href={`/catalog/${id}`} className="text-primary hover:underline inline-flex items-center gap-1">
          <Link2 className="w-3 h-3" />
          {label}
        </Link>
      );
    }
    return <EntityLink id={id} />;
  }
  if (type === "multilingual") {
    const m: any = value;
    const text = typeof m === "object" && m ? resolveLocalizedName(m, locale, "") : String(m);
    return <span>{text}</span>;
  }
  // list / group 按 definitions 递归渲染成有标签的结构，而不是直出原始 JSON。
  // 子字段名从字段定义取（含 items.fields / fields），后台增删子字段即刻生效。
  if (type === "list") {
    const items: any[] = Array.isArray(value) ? value : [];
    if (items.length === 0) return <span className="text-gray-400">—</span>;
    return (
      <ul className="space-y-1 list-none pl-0">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="shrink-0 text-gray-400 font-mono text-[10px] leading-5">{i + 1}.</span>
            <span className="min-w-0">
              <FieldValue code={code} value={item} defs={defs} locale={locale} field={def.items} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (type === "group" || (value && typeof value === "object" && !Array.isArray(value))) {
    const entries = Object.entries(value as Record<string, any>).filter(
      ([k, v]) => v !== undefined && v !== null && v !== "" && !def?.fields?.[k]?.hidden,
    );
    if (entries.length === 0) return <span className="text-gray-400">—</span>;
    return (
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5 m-0">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-1">
            <dt className="text-[11px] text-gray-500">{resolveLocalizedName(def?.fields?.[k]?.names, locale, k)}</dt>
            <dd className="m-0">
              <FieldValue code={k} value={v} defs={defs} locale={locale} field={def?.fields?.[k]} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  // 数组兜底：没有 list 字段定义时也按条目递归，不直出 JSON。
  if (Array.isArray(value)) {
    return (
      <ul className="space-y-1 list-none pl-0">
        {value.map((item, i) => (
          <li key={i}>
            <FieldValue code={code} value={item} defs={defs} locale={locale} field={def?.items} />
          </li>
        ))}
      </ul>
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
  // 列表字段的子字段声明在 items.fields（即 fields[*].items），而不是列表字段自身的
  // fields——调用方传进来的正是列表字段定义。读错层级会让子字段全部消失、只剩 label。
  const fields: Record<string, any> = field?.items?.fields || field?.fields || {};
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

// GroupAttributeInline：把"记录级附加属性"（subject_attributes / inclusion_attributes）
// 按 definitions 声明的子字段紧凑渲染成一行。子字段由后台声明，未声明时不渲染任何内容；
// 键一律取自 definitions，代码不写死子字段码。
export function GroupAttributeInline({
  defs,
  code,
  value,
  locale,
  className = "",
}: {
  defs: DynamicDefinitions | null | undefined;
  code: string;
  value: Record<string, any> | undefined;
  locale: string;
  className?: string;
}) {
  const fields: Record<string, any> = (defs as any)?.fields?.[code]?.fields || {};
  if (!value) return null;
  const codes = Object.keys(fields).filter(
    (c) => fields[c]?.enabled !== false && !fields[c]?.hidden,
  );
  const present = codes.filter((c) => value[c] !== undefined && value[c] !== null && value[c] !== "");
  if (present.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {present.map((c) => (
        <span key={c} className="inline-flex items-baseline gap-0.5">
          <span className="text-gray-400 dark:text-gray-500">{resolveLocalizedName(fields[c]?.names, locale, c)}:</span>
          <FieldValue code={c} value={value[c]} defs={defs} locale={locale} field={fields[c]} />
        </span>
      ))}
    </span>
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
