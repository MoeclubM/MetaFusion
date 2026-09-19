"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Select } from "@/components/ui/Select";
import { fetchRequestLogs, type RequestLogEntry } from "@/lib/developer";

// API 请求日志：本人已登录调用的逐次记录（目录服务面；route 为模板路径）。
// 凭据下拉从结果集提 distinct 名（服务端精确匹配过滤）。
export function RequestLogsCard() {
  const { t } = useI18n();
  const [credential, setCredential] = useState("");
  const [items, setItems] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetchRequestLogs(credential || undefined, 100)
      .then((res) => {
        if (alive) setItems(res);
      })
      .catch(() => {
        if (alive) {
          setItems([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [credential]);

  const options = useMemo(() => {
    const names = Array.from(new Set(items.map((e) => e.credential_name).filter(Boolean)));
    return [
      { value: "", label: t("developer.reqlogs.allCredentials") },
      ...names.map((n) => ({ value: n, label: n })),
    ];
  }, [items, t]);

  const statusClass = (s: number) =>
    s >= 500
      ? "text-rose-600 dark:text-danger"
      : s >= 400
        ? "text-amber-600 dark:text-warn"
        : "text-emerald-600 dark:text-success";

  return (
    <Card padding="section" className="space-y-3">
      <SectionTitle icon={<Activity className="w-4 h-4 text-primary" />}>
        {t("developer.reqlogs.title")}
      </SectionTitle>
      <Select value={credential} aria-label={t("developer.reqlogs.title")} onChange={setCredential} options={options} />
      {loading ? (
        <div className="py-6 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        </div>
      ) : failed ? (
        <p className="py-4 text-center text-xs text-amber-700 dark:text-warn-soft">{t("developer.reqlogs.failed")}</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-faint">{t("developer.reqlogs.empty")}</p>
      ) : (
        <ul className="space-y-1.5 max-h-96 overflow-y-auto pr-0.5 font-mono text-[11px]">
          {items.map((e, i) => (
            <li
              key={`${e.at}-${i}`}
              className="px-2.5 py-1.5 rounded-lg border border-line-subtle flex items-center gap-2 min-w-0"
            >
              <span className={`shrink-0 font-bold ${statusClass(e.status)}`}>{e.status}</span>
              <span className="shrink-0 text-text-muted">{e.method}</span>
              <span className="shrink-0 max-w-24 truncate text-text-faint" title={e.credential_name || e.credential_type}>
                {e.credential_type === "pat" ? e.credential_name || "pat" : e.credential_type}
              </span>
              <span className="flex-1 truncate text-text-body" title={e.route}>
                {e.route}
              </span>
              <span className="shrink-0 text-text-faint">{e.ms}ms</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
