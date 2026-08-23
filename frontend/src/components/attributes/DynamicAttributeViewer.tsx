"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { EntityAttributeSchema } from "@/lib/api";
import { Layers, CheckCircle2, XCircle, ExternalLink, Hash, Calendar, Tag as TagIcon } from "lucide-react";

interface DynamicAttributeViewerProps {
  attributes?: Record<string, any> | null;
  schemas?: EntityAttributeSchema[];
  className?: string;
}

export const DynamicAttributeViewer: React.FC<DynamicAttributeViewerProps> = ({
  attributes,
  schemas = [],
  className = "",
}) => {
  const { t, locale } = useI18n();

  if (!attributes || Object.keys(attributes).length === 0) {
    return null;
  }

  // 构建 schema 映射表
  const schemaMap = new Map<string, EntityAttributeSchema>();
  schemas.forEach((s) => schemaMap.set(s.attribute_key, s));

  // 格式化展示属性条目
  const entries = Object.entries(attributes).filter(
    ([_, val]) => val !== undefined && val !== null && val !== ""
  );

  if (entries.length === 0) {
    return null;
  }

  const formatValue = (key: string, val: any, schema?: EntityAttributeSchema) => {
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
        <div className="flex flex-wrap gap-1.5">
          {val.map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-secondary/80 text-foreground border border-border/40 font-mono"
            >
              <TagIcon className="w-2.5 h-2.5 text-muted-foreground" />
              {String(item)}
            </span>
          ))}
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

    if (schema?.data_type === "date") {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-mono text-foreground">
          <Calendar className="w-3 h-3 text-muted-foreground" />
          {strVal}
        </span>
      );
    }

    if (schema?.data_type === "number") {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-foreground">
          <Hash className="w-3 h-3 text-muted-foreground" />
          {strVal}
        </span>
      );
    }

    return <span className="text-xs font-medium text-foreground break-words">{strVal}</span>;
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map(([key, val]) => {
          const schema = schemaMap.get(key);
          const label =
            (schema?.names && (schema.names[locale] || schema.names["en-US"])) ||
            (locale.startsWith("zh") ? schema?.name_zh : schema?.name_en) ||
            schema?.name_zh ||
            key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

          const desc =
            (schema?.descriptions && (schema.descriptions[locale] || schema.descriptions["en-US"])) ||
            (locale.startsWith("zh") ? schema?.desc_zh : schema?.desc_en) ||
            schema?.desc_zh;

          return (
            <div
              key={key}
              className="flex flex-col gap-1 p-2.5 rounded-lg bg-background/60 border border-border/30 hover:border-border/60 transition-colors"
              title={desc || undefined}
            >
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-muted-foreground">
                <span className="truncate">{label}</span>
                <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
                  {key}
                </span>
              </div>
              <div className="pt-0.5">{formatValue(key, val, schema)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
