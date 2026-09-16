"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search, ScrollText } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card, CardTitle } from "@/components/ui/Card";
import { describeOAuthError, fetchOAuthAudits, formatStamp, type OAuthAuditEntry } from "./api";

/** 条数档位：服务端把 <=0 或 >500 归一到 100，这里只给合法档位，不给会导致静默截断的自由输入。 */
const LIMITS = [50, 100, 200, 500];

/**
 * 授权审计：谁在什么时候同意/拒绝了哪个客户端、授了哪些 scope。
 * client_id 不是外键：客户端删掉之后这份记录必须还在，所以这里也是"查历史"的唯一入口。
 * clientId / nonce 由外层传入：列表行的"查看审计"要能直接把过滤条件落到这里。
 */
export function AuditPanel({ clientId = "", nonce = 0 }: { clientId?: string; nonce?: number }) {
  const { t, tr, locale } = useI18n();
  const [input, setInput] = useState(clientId);
  const [limit, setLimit] = useState(100);
  const [query, setQuery] = useState({ clientId, limit: 100, nonce: 0 });
  const [entries, setEntries] = useState<OAuthAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 外层要求换过滤条件（行内"查看审计"、或清空）时立即生效，不必再点一次查询。
  useEffect(() => {
    setInput(clientId);
    setQuery((prev) => ({ clientId, limit: prev.limit, nonce }));
  }, [clientId, nonce]);

  const load = useCallback(async (target: string, size: number) => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchOAuthAudits(target, size));
    } catch (err) {
      setEntries([]);
      setError(describeOAuthError(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load(query.clientId, query.limit);
  }, [load, query]);

  const apply = () => setQuery((prev) => ({ clientId: input.trim(), limit, nonce: prev.nonce + 1 }));

  return (
    <Card padding="section" className="space-y-3">
      <CardTitle icon={<ScrollText className="w-4 h-4 text-primary" />}>{t("admin.oauth.auditTitle")}</CardTitle>
      <p className="text-[11px] text-text-muted leading-relaxed">{t("admin.oauth.auditDesc")}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className="flex flex-col sm:flex-row sm:items-center gap-2"
      >
        <div className="relative flex items-center flex-1">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-text-faint" />
          <input
            type="text"
            value={input}
            aria-label={t("admin.oauth.auditFilter")}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("admin.oauth.auditFilter")}
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-surfaceSubtle border border-line font-mono text-[11px] text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-mono text-text-muted" htmlFor="oauth-audit-limit">
            {t("admin.oauth.auditLimit")}
          </label>
          <select
            id="oauth-audit-limit"
            value={limit}
            onChange={(e) => {
              const next = Number(e.target.value);
              setLimit(next);
              setQuery((prev) => ({ clientId: prev.clientId, limit: next, nonce: prev.nonce + 1 }));
            }}
            className="px-2 py-1.5 rounded-lg bg-surfaceSubtle border border-line font-mono text-[11px] text-text-body focus:border-primary outline-none"
          >
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-[11px] font-medium transition-colors duration-fast ease-soft cursor-pointer"
          >
            {t("admin.oauth.auditApply")}
          </button>
          <button
            type="button"
            onClick={() => void load(query.clientId, query.limit)}
            title={t("admin.oauth.reload")}
            className="p-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body transition-colors duration-fast ease-soft cursor-pointer"
          >
            <RefreshCw className={"w-3.5 h-3.5" + (loading ? " animate-spin text-primary" : "")} />
          </button>
        </div>
      </form>

      {error ? (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs leading-relaxed">{error}</div>
      ) : null}

      {loading && entries.length === 0 ? (
        <div className="py-8 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>{t("admin.oauth.loading")}</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
          {t("admin.oauth.auditEmpty")}
        </div>
      ) : (
        <div className="rounded-xl border border-line-subtle overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line-subtle bg-surfaceSubtle text-text-muted font-mono text-[11px]">
                <th className="py-2 px-3 font-medium">{t("admin.oauth.auditColTime")}</th>
                <th className="py-2 px-3 font-medium">{t("admin.oauth.auditColAction")}</th>
                <th className="py-2 px-3 font-medium">{t("admin.oauth.auditColActor")}</th>
                <th className="py-2 px-3 font-medium">{t("admin.oauth.colClientId")}</th>
                <th className="py-2 px-3 font-medium">{t("admin.oauth.auditColScopes")}</th>
                <th className="py-2 px-3 font-medium">{t("admin.oauth.auditColDetail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft">
                  <td className="py-2 px-3 font-mono text-[11px] text-text-muted whitespace-nowrap">
                    {formatStamp(entry.created_at, locale)}
                  </td>
                  <td className="py-2 px-3">
                    <span className="px-1.5 py-0.5 rounded-chip bg-primary/15 text-primary text-[10px] font-medium whitespace-nowrap">
                      {tr("admin.oauth.action." + entry.action, entry.action)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-text-body">
                    {entry.actor_username || <span className="text-text-faint font-mono">{t("admin.oauth.auditSystemActor")}</span>}
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] text-text-strong break-all">{entry.client_id}</td>
                  <td className="py-2 px-3 font-mono text-[10px] text-text-muted">
                    {(entry.scopes || []).join(" ") || "—"}
                  </td>
                  <td className="py-2 px-3 text-[10px] text-text-muted break-all">{entry.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
