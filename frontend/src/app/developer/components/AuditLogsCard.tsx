"use client";

import React, { useEffect, useMemo, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Select } from "@/components/ui/Select";
import { fetchDeveloperAuditLogs, type DeveloperApp, type DeveloperAuditEntry } from "@/lib/developer";

// 应用被授权记录：谁同意/拒绝/动过我的应用。数据源 GET /api/developer/audit-logs
// （服务端只回归属为本人的应用行），按客户端过滤、倒序。
export function AuditLogsCard({ apps }: { apps: DeveloperApp[] }) {
  const { t } = useI18n();
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState<DeveloperAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetchDeveloperAuditLogs(clientId || undefined, 100)
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
  }, [clientId]);

  const options = useMemo(
    () => [
      { value: "", label: t("developer.audit.allApps") },
      ...apps.map((a) => ({ value: a.client_id, label: a.name || a.client_id })),
    ],
    [apps, t],
  );

  return (
    <Card padding="section" className="space-y-3">
      <SectionTitle icon={<History className="w-4 h-4 text-primary" />}>
        {t("developer.audit.title")}
      </SectionTitle>
      <Select
        value={clientId}
        aria-label={t("developer.audit.title")}
        onChange={setClientId}
        options={options}
      />
      {loading ? (
        <div className="py-6 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        </div>
      ) : failed ? (
        <p className="py-4 text-center text-xs text-amber-700 dark:text-warn-soft">{t("developer.audit.failed")}</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-faint">{t("developer.audit.empty")}</p>
      ) : (
        <ul className="space-y-2 max-h-96 overflow-y-auto pr-0.5">
          {items.map((e) => (
            <li key={e.id} className="p-2.5 rounded-lg border border-line-subtle text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surfaceSubtle border border-line text-text-body">
                  {e.action}
                </span>
                <span className="text-text-body font-medium truncate">{e.client_name || e.client_id}</span>
              </div>
              <div className="mt-1 text-[11px] text-text-muted leading-relaxed">
                {e.actor_username || e.actor_user_id || "—"}
                {e.scopes?.length > 0 && <span className="font-mono"> · {e.scopes.join(" ")}</span>}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-text-faint">
                {new Date(e.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
