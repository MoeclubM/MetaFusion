"use client";

import React from "react";
import Link from "next/link";
import { DynamicDefinitions, resolveLocalizedName, getTermName } from "@/lib/definitions";
import { Calendar, Hash, Clock, ExternalLink, Link2 } from "lucide-react";

// 说明：属性分区渲染已统一到 @/components/work/WorkFacts（两个详情页共用）。
// 本文件只保留按字段类型渲染取值的原子能力与时长字段查找，供 WorkFacts 与
// 其它页面复用，避免同一套类型分发逻辑出现多份实现。

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
