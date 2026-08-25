"use client";

import React, { useState, useEffect } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { EntityAttributeSchema, fetchAttributeSchemas } from "@/lib/api";
import {
  Layers,
  Plus,
  Trash2,
  HelpCircle,
  Hash,
  Calendar,
  Link as LinkIcon,
  List,
  Sparkles,
} from "lucide-react";

interface DynamicAttributeFormProps {
  entityType: string;
  category?: string;
  value?: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  className?: string;
}

export const DynamicAttributeForm: React.FC<DynamicAttributeFormProps> = ({
  entityType,
  category,
  value = {},
  onChange,
  className = "",
}) => {
  const { t, locale } = useI18n();
  const [schemas, setSchemas] = useState<EntityAttributeSchema[]>([]);
  const [loading, setLoading] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [customVal, setCustomVal] = useState("");
  const [showAddCustom, setShowAddCustom] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAttributeSchemas(entityType, category)
      .then((data) => {
        if (active) {
          setSchemas(data);
        }
      })
      .catch((err) => {
        console.error("Failed to load attribute schemas:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entityType, category]);

  const currentAttrs = value || {};

  const handleFieldChange = (key: string, val: any) => {
    const updated = { ...currentAttrs };
    if (val === "" || val === undefined || (Array.isArray(val) && val.length === 0)) {
      delete updated[key];
    } else {
      updated[key] = val;
    }
    onChange(updated);
  };

  const handleRemoveField = (key: string) => {
    const updated = { ...currentAttrs };
    delete updated[key];
    onChange(updated);
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const k = customKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!k) return;
    handleFieldChange(k, customVal.trim());
    setCustomKey("");
    setCustomVal("");
    setShowAddCustom(false);
  };

  // 获得所有已设属性中不属于已知 Schema 的自定义 Key
  const schemaKeys = new Set(schemas.map((s) => s.attribute_key));
  const customEntries = Object.entries(currentAttrs).filter(([k]) => !schemaKeys.has(k));

  return (
    <div className={`space-y-4 rounded-xl border border-border/60 bg-card/30 p-4 sm:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-primary/10 text-primary">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              {t("attributes.title")}
              {loading && <span className="text-[11px] font-normal text-muted-foreground animate-pulse">{t("attributes.loading")}</span>}
            </h4>
            <p className="text-xs text-muted-foreground">{t("attributes.desc")}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddCustom(!showAddCustom)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-2.5 py-1.5 rounded-md transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("attributes.addCustom")}
        </button>
      </div>

      {showAddCustom && (
        <form onSubmit={handleAddCustom} className="p-3 rounded-lg bg-secondary/50 border border-primary/20 space-y-2">
          <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            {t("attributes.addCustom")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">
                {t("attributes.customKey")}
              </label>
              <input
                type="text"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder={t("attributes.customKeyPlaceholder")}
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-background border border-border focus:border-primary focus:outline-hidden font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">
                {t("attributes.customVal")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customVal}
                  onChange={(e) => setCustomVal(e.target.value)}
                  placeholder={t("attributes.customValPlaceholder")}
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-background border border-border focus:border-primary focus:outline-hidden"
                />
                <button
                  type="submit"
                  disabled={!customKey.trim()}
                  className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
                >
                  {t("attributes.addCustom")}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* 预设 Schema 属性控件渲染 */}
      {schemas.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {schemas.map((schema) => {
            const key = schema.attribute_key;
            const label =
              (schema.names && (schema.names[locale] || schema.names["en-US"])) ||
              (locale.startsWith("zh") ? schema.name_zh : schema.name_en) ||
              schema.name_zh;

            const desc =
              (schema.descriptions && (schema.descriptions[locale] || schema.descriptions["en-US"])) ||
              (locale.startsWith("zh") ? schema.desc_zh : schema.desc_en) ||
              schema.desc_zh;

            const val = currentAttrs[key];

            let optionsList: any[] = [];
            if (Array.isArray(schema.options)) {
              optionsList = schema.options;
            } else if (schema.options && Array.isArray((schema.options as any).fields)) {
              optionsList = (schema.options as any).fields;
            }

            return (
              <div key={schema.id || key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-foreground flex items-center gap-1.5">
                    {label}
                    {schema.is_required && (
                      <span className="text-[10px] text-destructive font-mono font-bold">*</span>
                    )}
                    {desc && (
                      <span title={desc} className="text-muted-foreground hover:text-foreground cursor-help">
                        <HelpCircle className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </label>
                  <span className="text-[10px] font-mono text-muted-foreground/60">{key}</span>
                </div>

                {/* 根据 DataType 渲染不同输入控件 */}
                {schema.data_type === "boolean" ? (
                  <div className="flex items-center gap-3 pt-1">
                    <label className="inline-flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                      <input
                        type="radio"
                        name={`attr_${key}`}
                        checked={val === true}
                        onChange={() => handleFieldChange(key, true)}
                        className="rounded text-primary focus:ring-primary"
                      />
                      {t("attributes.booleanTrue")}
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                      <input
                        type="radio"
                        name={`attr_${key}`}
                        checked={val === false}
                        onChange={() => handleFieldChange(key, false)}
                        className="rounded text-primary focus:ring-primary"
                      />
                      {t("attributes.booleanFalse")}
                    </label>
                    {val !== undefined && (
                      <button
                        type="button"
                        onClick={() => handleRemoveField(key)}
                        className="text-[11px] text-muted-foreground hover:text-destructive underline ml-auto"
                      >
                        {t("attributes.deleteField")}
                      </button>
                    )}
                  </div>
                ) : schema.data_type === "select" ? (
                  <select
                    value={val || ""}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-md bg-background border border-border focus:border-primary focus:outline-hidden"
                  >
                    <option value="">{t("attributes.selectPlaceholder")}</option>
                    {optionsList.map((opt: any, idx: number) => {
                      const optVal = typeof opt === "object" ? opt.value : opt;
                      const optLabel = typeof opt === "object" ? opt.label || opt.name || opt.value : opt;
                      return (
                        <option key={idx} value={optVal}>
                          {optLabel}
                        </option>
                      );
                    })}
                  </select>
                ) : schema.data_type === "number" ? (
                  <div className="relative">
                    <input
                      type="number"
                      value={val !== undefined ? val : ""}
                      onChange={(e) =>
                        handleFieldChange(key, e.target.value === "" ? "" : Number(e.target.value))
                      }
                      placeholder={desc || label}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-background border border-border focus:border-primary focus:outline-hidden font-mono"
                    />
                    <Hash className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5 pointer-events-none" />
                  </div>
                ) : schema.data_type === "date" ? (
                  <div className="relative">
                    <input
                      type="date"
                      value={val || ""}
                      onChange={(e) => handleFieldChange(key, e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-background border border-border focus:border-primary focus:outline-hidden font-mono"
                    />
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5 pointer-events-none" />
                  </div>
                ) : schema.data_type === "url" ? (
                  <div className="relative">
                    <input
                      type="url"
                      value={val || ""}
                      onChange={(e) => handleFieldChange(key, e.target.value)}
                      placeholder="https://..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-background border border-border focus:border-primary focus:outline-hidden font-mono"
                    />
                    <LinkIcon className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5 pointer-events-none" />
                  </div>
                ) : schema.data_type === "array" ? (
                  <input
                    type="text"
                    value={Array.isArray(val) ? val.join(", ") : val || ""}
                    onChange={(e) => {
                      const arr = e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      handleFieldChange(key, arr);
                    }}
                    placeholder="tag1, tag2, tag3..."
                    className="w-full px-3 py-1.5 text-xs rounded-md bg-background border border-border focus:border-primary focus:outline-hidden font-mono"
                  />
                ) : (
                  <input
                    type="text"
                    value={val || ""}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    placeholder={desc || label}
                    className="w-full px-3 py-1.5 text-xs rounded-md bg-background border border-border focus:border-primary focus:outline-hidden"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 自定义未列入 Schema 的自由属性列表 */}
      {customEntries.length > 0 && (
        <div className="pt-2 border-t border-border/40 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <List className="w-3.5 h-3.5" />
            {t("attributes.addCustom")} ({customEntries.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {customEntries.map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-2 p-2 rounded-md bg-secondary/40 border border-border/40 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-muted-foreground">{k}</div>
                  <div className="font-medium text-foreground truncate">{String(v)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveField(k)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title={t("attributes.deleteField")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
