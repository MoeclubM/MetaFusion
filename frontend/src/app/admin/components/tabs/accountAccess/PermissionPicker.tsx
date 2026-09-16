"use client";

// 权限码选择器：把 GET /api/admin/permissions 的清单按前缀（接口给的 service）分组。
//
// 这里刻意不做"元数据系统一套、论坛一套"的分割：同一个组里可以同时勾选
// catalog.* 与 community.*，界面只需标明"这些码分别由哪个子系统解释"。

import React, { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { pickLocalizedName } from "@/lib/api";
import { groupPermissionsByPrefix, type AdminPermissionCode } from "./api";
import { PrefixChip, serviceLabel } from "./shared";

export function PermissionPicker({
  catalog,
  selected,
  onChange,
}: {
  catalog: AdminPermissionCode[];
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const { t, tr, locale } = useI18n();
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const codes = catalog.map((item) => item.code);
    // 通配符单独成组，避免混进 auth 前缀里被误读成普通码。
    const wildcard = codes.filter((c) => c === "*");
    const rest = codes.filter((c) => c !== "*");
    const buckets = groupPermissionsByPrefix(rest, catalog);
    return wildcard.length > 0 ? [{ prefix: "*", codes: wildcard }, ...buckets] : buckets;
  }, [catalog]);

  const normalizedQuery = query.trim().toLowerCase();

  const toggle = (code: string) => {
    if (selected.includes(code)) {
      onChange(selected.filter((c) => c !== code));
    } else {
      onChange([...selected, code]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="relative flex items-center flex-1">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.account.permSearch")}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
          />
        </div>
        <span className="text-[11px] font-mono text-text-muted shrink-0">
          {t("admin.account.permSelected", { count: selected.length })}
        </span>
      </div>

      <p className="text-[11px] text-text-faint leading-relaxed">{t("admin.account.permScopeHint")}</p>

      <div className="space-y-3">
        {grouped.map(({ prefix, codes }) => {
          const visible = codes
            .map((code) => catalog.find((item) => item.code === code))
            .filter((item): item is AdminPermissionCode => Boolean(item))
            .filter((item) => {
              if (!normalizedQuery) return true;
              const label = pickLocalizedName(locale, item.names, item.code);
              return (
                item.code.toLowerCase().includes(normalizedQuery) ||
                label.toLowerCase().includes(normalizedQuery)
              );
            });

          if (visible.length === 0) return null;

          return (
            <div key={prefix} className="rounded-xl border border-line-subtle bg-surfaceSubtle overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-surfaceSubtle border-b border-line-subtle">
                <PrefixChip prefix={prefix} />
                <span className="text-[11px] text-text-body font-medium">
                  {serviceLabel(prefix, tr)}
                </span>
                <span className="text-[10px] font-mono text-text-faint">
                  {t("admin.account.permCount", { count: codes.length })}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2">
                {visible.map((item) => {
                  const active = selected.includes(item.code);
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => toggle(item.code)}
                      className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors duration-fast ease-soft cursor-pointer ${
                        active
                          ? "bg-primary/15 border-primary/40"
                          : "bg-surfaceSubtle border-line-subtle hover:bg-surfaceHover"
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-3.5 h-3.5 rounded border shrink-0 grid place-items-center ${
                          active ? "bg-primary border-primary text-white" : "border-line-strong"
                        }`}
                      >
                        {active ? <Check className="w-2.5 h-2.5" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-mono text-text-strong break-all">
                          {item.code}
                        </span>
                        <span className="block text-[10px] text-text-muted truncate">
                          {pickLocalizedName(locale, item.names, item.code)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
