"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicDefinitions, getFieldName, getTermName } from "@/lib/definitions";
import { Layers, CheckCircle2, XCircle, ExternalLink, Hash, Calendar } from "lucide-react";

interface DynamicAttributeViewerProps {
  attributes?: Record<string, any> | null;
  /**
   * 服务端 definitions：字段名与词表项的多语言名由此解析。
   * 不传则退化为字段码的人性化文本——调用方应尽量传入，避免用户看到裸字段码。
   */
  defs?: DynamicDefinitions | null;
  /** 已在页面结构化区块单独渲染过的字段码，避免同一信息重复出现两次。 */
  excludeKeys?: string[];
  className?: string;
}

// 字段码兜底展示：edition_date → Edition date
function humanizeField(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const DynamicAttributeViewer: React.FC<DynamicAttributeViewerProps> = ({
  attributes,
  defs = null,
  excludeKeys = [],
  className = "",
}) => {
  const { t, locale } = useI18n();

  if (!attributes || Object.keys(attributes).length === 0) {
    return null;
  }

  const excluded = new Set(excludeKeys);
  const entries = Object.entries(attributes).filter(
    ([key, val]) => !excluded.has(key) && val !== undefined && val !== null && val !== ""
  );

  if (entries.length === 0) {
    return null;
  }

  const fieldDef = (key: string) => defs?.fields?.[key];

  // 枚举值按字段声明的词表解析多语言项；无词表时原样展示。
  const termLabel = (key: string, value: string): string => {
    const vocab = fieldDef(key)?.vocabulary;
    if (!vocab) return value;
    return getTermName(defs, vocab, value, locale);
  };

  const formatValue = (key: string, val: any) => {
    const def = fieldDef(key);

    if (typeof val === "boolean") {
      return (
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
          val ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
        }`}>
          {val ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          {val ? t("attributes.booleanTrue") : t("attributes.booleanFalse")}
        </span>
      );
    }

    if (Array.isArray(val)) {
      if (val.length === 0) return <span className="text-muted-foreground">-</span>;
      return (
        <div className="flex flex-col gap-1.5">
          {val.map((item, idx) => {
            // 结构化列表（events / attachments / store_bonuses）：优先展示记录里的 label 字段。
            if (item && typeof item === "object") {
              const label = item.label ?? item.name ?? item.title;
              const rest = Object.entries(item)
                .filter(([k, v]) => k !== "label" && k !== "name" && k !== "title" && v !== undefined && v !== null && v !== "")
                .map(([k, v]) => `${humanizeField(k)}: ${String(v)}`);
              return (
                <div key={idx} className="rounded-md border border-border/40 bg-secondary/40 px-2 py-1 text-xs">
                  <div className="font-medium text-foreground">{label ? String(label) : humanizeField("record")}</div>
                  {rest.length > 0 && (
                    <div className="font-mono text-[11px] text-muted-foreground">{rest.join(" · ")}</div>
                  )}
                </div>
              );
            }
            return (
              <span key={idx} className="text-xs font-medium text-foreground">
                {termLabel(key, String(item))}
              </span>
            );
          })}
        </div>
      );
    }

    if (typeof val === "object") {
      return (
        <pre className="text-xs font-mono bg-muted/60 p-2 rounded border border-border/50 max-h-32 overflow-auto text-foreground/90">
          {JSON.stringify(val, null, 2)}
        </pre>
      );
    }

    const strVal = String(val);
    const isUrl = /^https?:\/\//i.test(strVal);

    if (isUrl) {
      return (
        <a
          href={strVal}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono break-all"
        >
          {strVal}
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      );
    }

    if (def?.type === "date") {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-mono text-foreground">
          <Calendar className="w-3 h-3 text-muted-foreground" />
          {strVal}
        </span>
      );
    }

    if (def?.type === "number") {
      const unit = def.unit ? def.unit[locale] || def.unit["zh-CN"] || def.unit["en-US"] : "";
      return (
        <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-foreground">
          <Hash className="w-3 h-3 text-muted-foreground" />
          {strVal}
          {unit ? <span className="text-muted-foreground">{unit}</span> : null}
        </span>
      );
    }

    return <span className="text-xs font-medium text-foreground break-words">{termLabel(key, strVal)}</span>;
  };

  return (
    <div className={`rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-4 sm:p-5 shadow-xs ${className}`}>
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/40">
        <Layers className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          {t("attributes.title")}
        </h3>
        <span className="text-[11px] text-muted-foreground ml-auto font-mono">
          {t("attributes.fieldCount", { count: entries.length })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {entries.map(([key, val]) => {
          const def = fieldDef(key);
          const label = def ? getFieldName(defs, key, locale) : humanizeField(key);
          return (
            <div
              key={key}
              className="flex flex-col gap-1 p-2.5 rounded-lg bg-background/60 border border-border/30 hover:border-border/60 transition-colors"
            >
              <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
              <div className="pt-0.5 min-w-0">{formatValue(key, val)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
