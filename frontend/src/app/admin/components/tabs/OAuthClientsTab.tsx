"use client";

// 「OAuth 客户端」管理台页签：第三方接入的授权方登记与治理。
//
// 与账号服务的分工（契约只读核对，见 metafusion-auth/internal/handler/oauth_admin.go）：
//   * 这里只做管理面：登记客户端、轮换密钥、吊销令牌、查授权审计；
//   * 授权码 / 换码 / userinfo 是第三方与用户走的面，界面不介入；
//   * 权限 auth.oauth.manage 由页签入口与每个端点各判一次：入口隐藏只是别把用户引到注定 403 的按钮上，
//     真正的授权仍在服务端（前端放行不等于服务端放行）。
//
// 密钥的一次性是这个界面的硬约束：库里只有 bcrypt 哈希，明文只出现在创建/轮换的响应里，
// 所以"看一眼再关掉"之后没有任何补救路径 —— 只能重新轮换。

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldOff,
  Trash2,
  Users,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card, CardTitle } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { ClientFormModal, type ClientFormOutcome } from "./oauthClients/ClientFormModal";
// 一次性密钥展示与破坏性动作确认是两个界面共用的小组件（管理台与开发者中心），
// 因此放在 components/oauth/ 下，而不是留在某一个页签目录里。
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import { SecretRevealModal, type SecretReveal } from "@/components/oauth/SecretRevealModal";
import { AuditPanel } from "./oauthClients/AuditPanel";
import {
  deleteOAuthClient,
  describeOAuthError,
  fetchOAuthClients,
  formatStamp,
  revokeOAuthClientTokens,
  rotateOAuthClientSecret,
  type OAuthClient,
} from "./oauthClients/api";

/** 待确认的破坏性动作：三种都先弹确认，确认后执行的代码路径各不相同。 */
type Pending = { kind: "rotate" | "revoke" | "delete"; client: OAuthClient };

export function OAuthClientsTab() {
  const { t, locale } = useI18n();
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OAuthClient | null>(null);
  const [secret, setSecret] = useState<SecretReveal | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  // 审计面板的过滤条件：行内"查看审计"把它落成该行的 client_id，nonce 每次 +1 触发重查。
  const [auditClientId, setAuditClientId] = useState("");
  const [auditNonce, setAuditNonce] = useState(0);
  const auditRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await fetchOAuthClients());
      setError(null);
    } catch (err) {
      setClients([]);
      setError(describeOAuthError(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaved = (outcome: ClientFormOutcome) => {
    setCreating(false);
    setEditing(null);
    if (outcome.secret) {
      setSecret({ clientId: outcome.client.client_id, secret: outcome.secret, mode: "created" });
    }
    setNotice(
      outcome.mode === "created"
        ? t("admin.oauth.created", { client_id: outcome.client.client_id })
        : t("admin.oauth.updated", { client_id: outcome.client.client_id }),
    );
    void load();
  };

  const runPending = async () => {
    if (!pending) return;
    const clientId = pending.client.client_id;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === "rotate") {
        const res = await rotateOAuthClientSecret(clientId);
        setSecret({ clientId: res.client.client_id, secret: res.client_secret, mode: "rotated" });
        setNotice(t("admin.oauth.rotated", { client_id: clientId }));
      } else if (pending.kind === "revoke") {
        const res = await revokeOAuthClientTokens(clientId);
        setNotice(t("admin.oauth.revoked", { client_id: clientId, count: res.revoked }));
      } else {
        await deleteOAuthClient(clientId);
        setNotice(t("admin.oauth.deleted", { client_id: clientId }));
      }
      await load();
    } catch (err) {
      setError(describeOAuthError(err, t));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  const focusAudit = (clientId: string) => {
    setAuditClientId(clientId);
    setAuditNonce((n) => n + 1);
    auditRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const confirmText = (() => {
    if (!pending) return null;
    const vars = { client_id: pending.client.client_id };
    if (pending.kind === "rotate") {
      return {
        title: t("admin.oauth.rotateTitle"),
        message: t("admin.oauth.rotateConfirm", vars),
        label: t("admin.oauth.rotate"),
      };
    }
    if (pending.kind === "revoke") {
      return {
        title: t("admin.oauth.revokeTitle"),
        message: t("admin.oauth.revokeConfirm", vars),
        label: t("admin.oauth.revoke"),
      };
    }
    return {
      title: t("admin.oauth.deleteTitle"),
      message: t("admin.oauth.deleteConfirm", vars),
      label: t("admin.oauth.confirmDelete"),
    };
  })();

  const actionClass =
    "px-2 py-1 rounded-md bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body hover:text-text-strong text-[11px] transition-colors duration-fast ease-soft cursor-pointer inline-flex items-center gap-1";

  return (
    <div className="space-y-4">
      <Card padding="section" className="space-y-3">
        <CardTitle icon={<KeyRound className="w-4 h-4 text-primary" />}>{t("admin.oauth.title")}</CardTitle>
        <p className="text-xs text-text-muted leading-relaxed">{t("admin.oauth.subtitle")}</p>
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
          <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
          <span className="text-[11px] text-amber-400 leading-relaxed">{t("admin.oauth.securityNote")}</span>
        </div>
      </Card>

      <Card padding="section" className="space-y-3">
        <SectionTitle
          icon={<Users className="w-4 h-4 text-primary" />}
          actions={
            <>
              <button
                type="button"
                onClick={() => void load()}
                title={t("admin.oauth.reload")}
                className="p-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body transition-colors duration-fast ease-soft cursor-pointer"
              >
                <RefreshCw className={"w-3.5 h-3.5" + (loading ? " animate-spin text-primary" : "")} />
              </button>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-[11px] font-semibold transition-colors duration-fast ease-soft cursor-pointer inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t("admin.oauth.newClient")}</span>
              </button>
            </>
          }
        >
          {t("admin.oauth.clientsTitle")}
        </SectionTitle>

        {error ? (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-1">
            <p className="text-rose-300 text-xs leading-relaxed">{error}</p>
            <p className="text-[11px] text-rose-300/70 leading-relaxed">{t("admin.oauth.errForbiddenHint")}</p>
          </div>
        ) : null}

        {notice ? (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs leading-relaxed">{notice}</div>
        ) : null}

        {loading && clients.length === 0 ? (
          <div className="py-10 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>{t("admin.oauth.loading")}</span>
          </div>
        ) : clients.length === 0 ? (
          <div className="p-8 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
            {t("admin.oauth.empty")}
          </div>
        ) : (
          <div className="rounded-xl border border-line-subtle overflow-x-auto" data-mf-oauth-clients="">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line-subtle bg-surfaceSubtle text-text-muted font-mono text-[11px]">
                  <th className="py-2 px-3 font-medium">{t("admin.oauth.colClientId")}</th>
                  <th className="py-2 px-3 font-medium">{t("admin.oauth.colName")}</th>
                  <th className="py-2 px-3 font-medium">{t("admin.oauth.colRedirects")}</th>
                  <th className="py-2 px-3 font-medium">{t("admin.oauth.colScopes")}</th>
                  <th className="py-2 px-3 font-medium">{t("admin.oauth.colStatus")}</th>
                  <th className="py-2 px-3 font-medium">{t("admin.oauth.colCreated")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("admin.oauth.colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {clients.map((client) => (
                  <tr key={client.client_id} data-mf-oauth-row={client.client_id} className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft align-top">
                    <td className="py-2.5 px-3 font-mono text-[11px] text-text-strong break-all">{client.client_id}</td>
                    <td className="py-2.5 px-3 text-text-body">{client.name || "—"}</td>
                    <td className="py-2.5 px-3">
                      <div className="space-y-0.5">
                        {(client.redirect_uris || []).slice(0, 2).map((uri) => (
                          <div key={uri} className="font-mono text-[10px] text-text-muted break-all">{uri}</div>
                        ))}
                        {(client.redirect_uris || []).length > 2 ? (
                          <div className="font-mono text-[10px] text-text-faint">
                            {t("admin.oauth.moreItems", { count: client.redirect_uris.length - 2 })}
                          </div>
                        ) : null}
                        {(client.redirect_uris || []).length === 0 ? (
                          <div className="font-mono text-[10px] text-rose-400">{t("admin.oauth.noRedirects")}</div>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-1">
                        {(client.scopes || []).map((scope) => (
                          <span key={scope} className="px-1 py-0.5 rounded-chip bg-surfaceSubtle border border-line text-[10px] font-mono text-text-muted">
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={
                            "px-1.5 py-0.5 rounded-chip text-[10px] font-mono " +
                            (client.disabled
                              ? "bg-rose-500/15 text-rose-300"
                              : "bg-emerald-500/15 text-emerald-300")
                          }
                        >
                          {client.disabled ? t("admin.oauth.badgeDisabled") : t("admin.oauth.badgeActive")}
                        </span>
                        {client.trusted ? (
                          <span className="px-1.5 py-0.5 rounded-chip bg-sky-500/15 text-sky-300 text-[10px] font-mono">
                            {t("admin.oauth.badgeTrusted")}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[10px] text-text-muted whitespace-nowrap">
                      {formatStamp(client.created_at, locale)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <button type="button" onClick={() => setEditing(client)} className={actionClass}>
                          <Pencil className="w-3 h-3" />
                          <span>{t("admin.oauth.edit")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending({ kind: "rotate", client })}
                          className={actionClass}
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>{t("admin.oauth.rotate")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending({ kind: "revoke", client })}
                          className={actionClass}
                        >
                          <ShieldOff className="w-3 h-3" />
                          <span>{t("admin.oauth.revoke")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => focusAudit(client.client_id)}
                          className={actionClass}
                        >
                          <ScrollText className="w-3 h-3" />
                          <span>{t("admin.oauth.viewAudit")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending({ kind: "delete", client })}
                          className="px-2 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[11px] transition-colors duration-fast ease-soft cursor-pointer inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>{t("admin.oauth.delete")}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[10px] text-text-faint leading-relaxed">{t("admin.oauth.seededProtected")}</p>
      </Card>

      <div ref={auditRef}>
        <AuditPanel clientId={auditClientId} nonce={auditNonce} />
      </div>

      <ClientFormModal
        open={creating || !!editing}
        client={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={handleSaved}
      />

      <SecretRevealModal reveal={secret} onClose={() => setSecret(null)} />

      <ConfirmDialog
        open={!!pending}
        title={confirmText?.title ?? ""}
        message={confirmText?.message ?? ""}
        confirmLabel={confirmText?.label ?? ""}
        busy={busy}
        onClose={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </div>
  );
}
