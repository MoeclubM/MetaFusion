"use client";

// API Key 新建弹窗：名称 + 有效期 + 权限 scope，创建成功把一次性明文交回调用方展示。
// 表单逻辑与校验和以前内联在 ApiKeysPanel 里时一致（搬家不改语义）：名称必填、至少勾一个
// scope；scopes 是权限码，按 grantablePermissionCodes(user) 取可授清单、按服务前缀分组；
// 默认一项都不勾——最小权限是默认值，勾选是用户的显式动作。

import React, { useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Loader2, Plus } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { Modal } from "@/components/ui/Modal";
import { grantablePermissionCodes } from "@/lib/permissions";
import { authErrorText, httpStatusOf } from "@/lib/authErrors";
import {
  createPersonalAccessToken,
  type CreatedPersonalAccessToken,
} from "@/lib/api";

/** 有效期选项：0 表示不带 expires_in_days（服务端即永不过期）。 */
const EXPIRY_CHOICES = [0, 30, 90, 365] as const;

export function ApiKeyCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreatedPersonalAccessToken) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiryDays, setExpiryDays] = useState<number>(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const grantable = useMemo(() => grantablePermissionCodes(user), [user]);

  const groups = useMemo<[string, string[]][]>(() => {
    const byService = new Map<string, string[]>();
    for (const code of grantable) {
      const service = code.split(".")[0] || code;
      const list = byService.get(service) || [];
      list.push(code);
      byService.set(service, list);
    }
    return Array.from(byService.entries());
  }, [grantable]);

  useEffect(() => {
    if (open) {
      setName("");
      setScopes([]);
      setExpiryDays(0);
      setError("");
      setBusy(false);
    }
  }, [open]);

  const labelOf = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const toggleScope = (code: string) => {
    setScopes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("developer.apiKeyNameRequired"));
      return;
    }
    if (scopes.length === 0) {
      setError(t("developer.apiKeyScopesRequired"));
      return;
    }
    setBusy(true);
    try {
      const created = await createPersonalAccessToken({
        name: trimmed,
        scopes,
        ...(expiryDays > 0 ? { expires_in_days: expiryDays } : {}),
      });
      onCreated(created);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(authErrorText(raw, t, httpStatusOf(err), "developer.apiKeyCreateFailed"));
      setBusy(false);
    }
  };

  const fieldClass =
    "w-full px-3 py-2 rounded-lg bg-surfaceSubtle border border-line text-text-body text-xs placeholder:text-text-faint focus:border-primary/50 focus:outline-none transition-colors duration-fast ease-soft";
  const labelClass = "block text-[11px] font-medium text-text-muted mb-1";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("developer.apiKeyCreateTitle")}
      icon={<KeyRound className="w-4 h-4 text-primary" />}
    >
      <form onSubmit={submit} className="space-y-3 text-xs">
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className={labelClass} htmlFor="mf-apikey-name">
              {t("developer.apiKeyTokenName")}
            </label>
            <input
              id="mf-apikey-name"
              type="text"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("developer.apiKeyNamePlaceholder")}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="mf-apikey-expiry">
              {t("developer.apiKeyExpiry")}
            </label>
            <select
              id="mf-apikey-expiry"
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className={fieldClass}
            >
              {EXPIRY_CHOICES.map((days) => (
                <option key={days} value={days}>
                  {days === 0 ? t("developer.apiKeyExpiryNever") : t("developer.apiKeyExpiryDays", { days })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[11px] font-medium text-text-muted">{t("developer.apiKeyScopes")}</span>
            {grantable.length > 0 && (
              <span className="font-mono text-[10px] text-text-faint">
                {t("developer.apiKeySelected", { count: scopes.length, total: grantable.length })}
              </span>
            )}
          </div>
          {grantable.length === 0 ? (
            <p className="p-3 rounded-lg bg-surfaceSubtle border border-line-subtle text-[11px] text-text-body leading-relaxed">
              {t("developer.apiKeyNoScopes")}
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
              {groups.map(([service, codes]) => (
                <div key={service} className="space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                    {labelOf(`developer.apiKeyScopeGroup.${service}`, service)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {codes.map((code) => {
                      const checked = scopes.includes(code);
                      return (
                        <label
                          key={code}
                          className={
                            "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md border cursor-pointer text-[11px] transition-colors duration-fast ease-soft " +
                            (checked
                              ? "bg-primary/10 border-primary/40 text-text-strong"
                              : "bg-surfaceSubtle border-line text-text-body hover:border-primary/30")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleScope(code)}
                            className="sr-only"
                          />
                          {checked ? <Check className="w-3 h-3 text-primary" /> : null}
                          <span>{labelOf(`developer.apiKeyScope.${code}`, code)}</span>
                          <span className="font-mono text-[9px] text-text-faint">{code}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-text-faint leading-relaxed">{t("developer.apiKeyScopesHint")}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={busy || grantable.length === 0}
            className="px-3.5 h-9 rounded-lg bg-primary text-white keep-white font-semibold text-xs inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{busy ? t("developer.apiKeyCreating") : t("developer.apiKeyCreateBtn")}</span>
          </button>
          <span className="text-[11px] text-text-faint">{t("developer.apiKeyLimitHint")}</span>
        </div>
      </form>
    </Modal>
  );
}
