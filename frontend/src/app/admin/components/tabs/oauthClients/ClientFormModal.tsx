"use client";

import React, { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Modal } from "@/components/ui/Modal";
import {
  createOAuthClient,
  updateOAuthClient,
  describeOAuthError,
  OAUTH_CLIENT_ID_RE,
  OAUTH_SCOPES,
  type OAuthClient,
  type OAuthClientDraft,
} from "./api";

/** 保存结果：created 时带回一次性 secret，由调用方弹展示框；updated 只更新列表。 */
export type ClientFormOutcome = { mode: "created" | "updated"; client: OAuthClient; secret?: string };

type FormState = {
  clientId: string;
  name: string;
  redirects: string;
  scopes: string[];
  trusted: boolean;
  disabled: boolean;
};

/** 回调白名单是"一行一个"：换行/空格都当分隔，去空去重后与原值比较才谈得上"改没改"。 */
function parseRedirects(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const uri = line.trim();
    if (uri && !out.includes(uri)) out.push(uri);
  }
  return out;
}

/** 与 store.ValidateRedirectURIs 同口径的前置校验：通配符、相对地址、片段、内嵌凭据一律不收。 */
function invalidRedirect(uri: string): boolean {
  if (uri.includes("*") || uri.includes("#")) return true;
  try {
    const u = new URL(uri);
    return (u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username !== "" || u.password !== "";
  } catch {
    return true;
  }
}

function formOf(client: OAuthClient | null): FormState {
  if (!client) {
    return { clientId: "", name: "", redirects: "", scopes: ["openid", "profile", "email"], trusted: false, disabled: false };
  }
  return {
    clientId: client.client_id,
    name: client.name,
    redirects: (client.redirect_uris || []).join("\n"),
    scopes: [...(client.scopes || [])],
    trusted: !!client.trusted,
    disabled: !!client.disabled,
  };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * 新建 / 编辑客户端表单。
 * 编辑走局部更新：只有真正改动过的字段才进请求体，避免"回填即提交"把没碰过的开关一起写库。
 */
export function ClientFormModal({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client: OAuthClient | null;
  onClose: () => void;
  onSaved: (outcome: ClientFormOutcome) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(() => formOf(client));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 每次打开都按当前对象重建表单：上一次的残留输入不该出现在下一次编辑里。
  useEffect(() => {
    if (open) {
      setForm(formOf(client));
      setError(null);
      setBusy(false);
    }
  }, [open, client]);

  const editing = !!client;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clientId = form.clientId.trim();
    const name = form.name.trim();
    const redirects = parseRedirects(form.redirects);

    if (!editing && !OAUTH_CLIENT_ID_RE.test(clientId)) {
      setError(t("admin.oauth.invalidClientId"));
      return;
    }
    if (!name) {
      setError(t("admin.oauth.requiredFields"));
      return;
    }
    if (redirects.length === 0) {
      setError(t("admin.oauth.fieldRedirectsRequired"));
      return;
    }
    const bad = redirects.find(invalidRedirect);
    if (bad) {
      setError(t("admin.oauth.invalidRedirectUri", { uri: bad }));
      return;
    }
    if (form.scopes.length === 0) {
      setError(t("admin.oauth.scopeRequired"));
      return;
    }

    setBusy(true);
    try {
      if (!client) {
        const res = await createOAuthClient({
          client_id: clientId,
          name: name,
          redirect_uris: redirects,
          scopes: form.scopes,
          trusted: form.trusted,
        });
        onSaved({ mode: "created", client: res.client, secret: res.client_secret });
      } else {
        const patch: OAuthClientDraft = {};
        if (name !== client.name) patch.name = name;
        if (!sameList(redirects, client.redirect_uris || [])) patch.redirect_uris = redirects;
        if (!sameList(form.scopes, [...(client.scopes || [])])) patch.scopes = form.scopes;
        if (form.trusted !== !!client.trusted) patch.trusted = form.trusted;
        if (form.disabled !== !!client.disabled) patch.disabled = form.disabled;
        const updated = await updateOAuthClient(client.client_id, patch);
        onSaved({ mode: "updated", client: updated });
      }
    } catch (err) {
      // 后端拒绝的原因（回调不合法 / scope 不支持 / client_id 撞车）如实显示，不做笼统"保存失败"。
      setError(describeOAuthError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t("admin.oauth.editTitle") : t("admin.oauth.createTitle")}
      icon={<KeyRound className="w-4 h-4 text-primary" />}
    >
      <form onSubmit={submit} className="space-y-3.5 text-xs">
        <div>
          <label className="block text-[11px] font-mono text-text-muted mb-1" htmlFor="oauth-client-id">
            {t("admin.oauth.fieldClientId")}
          </label>
          <input
            id="oauth-client-id"
            type="text"
            required
            disabled={editing}
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
            placeholder="third-party-app"
            className="w-full px-2.5 py-1.5 rounded-lg bg-surfaceSubtle border border-line font-mono text-text-strong placeholder:text-text-faint focus:border-primary outline-none disabled:opacity-60"
          />
          <p className="text-[10px] text-text-faint mt-1 leading-relaxed">{t("admin.oauth.fieldClientIdHint")}</p>
        </div>

        <div>
          <label className="block text-[11px] font-mono text-text-muted mb-1" htmlFor="oauth-client-name">
            {t("admin.oauth.fieldName")}
          </label>
          <input
            id="oauth-client-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-2.5 py-1.5 rounded-lg bg-surfaceSubtle border border-line text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
          />
        </div>

        <div>
          <label className="block text-[11px] font-mono text-text-muted mb-1" htmlFor="oauth-client-redirects">
            {t("admin.oauth.fieldRedirects")}
          </label>
          <textarea
            id="oauth-client-redirects"
            rows={3}
            value={form.redirects}
            onChange={(e) => setForm({ ...form, redirects: e.target.value })}
            placeholder={"https://client.example/oauth/callback"}
            className="w-full px-2.5 py-1.5 rounded-lg bg-surfaceSubtle border border-line font-mono text-[11px] text-text-strong placeholder:text-text-faint focus:border-primary outline-none resize-y"
          />
          <p className="text-[10px] text-text-faint mt-1 leading-relaxed">{t("admin.oauth.fieldRedirectsHint")}</p>
        </div>

        <fieldset>
          <legend className="text-[11px] font-mono text-text-muted mb-1">{t("admin.oauth.fieldScopes")}</legend>
          <div className="flex flex-wrap gap-3">
            {OAUTH_SCOPES.map((scope) => (
              <label key={scope} className="inline-flex items-center gap-1.5 text-[11px] font-mono text-text-body cursor-pointer">
                <input
                  type="checkbox"
                  value={scope}
                  checked={form.scopes.includes(scope)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      scopes: e.target.checked
                        ? OAUTH_SCOPES.filter((s) => s === scope || form.scopes.includes(s))
                        : form.scopes.filter((s) => s !== scope),
                    })
                  }
                  className="accent-primary"
                />
                <span>{scope}</span>
              </label>
            ))}
          </div>
          <p className="text-[10px] text-text-faint mt-1 leading-relaxed">{t("admin.oauth.fieldScopesHint")}</p>
        </fieldset>

        <label className="flex items-start gap-2 p-2.5 rounded-lg bg-surfaceSubtle border border-line-subtle cursor-pointer">
          <input
            type="checkbox"
            checked={form.trusted}
            onChange={(e) => setForm({ ...form, trusted: e.target.checked })}
            className="mt-0.5 accent-primary"
          />
          <span>
            <span className="block text-text-strong font-medium">{t("admin.oauth.fieldTrusted")}</span>
            <span className="block text-[10px] text-text-faint leading-relaxed mt-0.5">{t("admin.oauth.fieldTrustedHint")}</span>
          </span>
        </label>

        {editing ? (
          <label className="flex items-start gap-2 p-2.5 rounded-lg bg-surfaceSubtle border border-line-subtle cursor-pointer">
            <input
              type="checkbox"
              checked={form.disabled}
              onChange={(e) => setForm({ ...form, disabled: e.target.checked })}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-text-strong font-medium">{t("admin.oauth.fieldDisabled")}</span>
              <span className="block text-[10px] text-text-faint leading-relaxed mt-0.5">{t("admin.oauth.fieldDisabledHint")}</span>
            </span>
          </label>
        ) : null}

        {error ? (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 leading-relaxed">{error}</div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1 border-t border-line-subtle">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body transition-colors duration-fast ease-soft cursor-pointer"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>{busy ? t("admin.oauth.saving") : editing ? t("admin.oauth.save") : t("admin.oauth.create")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
