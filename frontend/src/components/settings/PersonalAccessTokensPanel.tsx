"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldOff,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { grantablePermissionCodes } from "@/lib/permissions";
import { DOCS_SERVICE_URL } from "@/lib/services";
import { authErrorText, httpStatusOf } from "@/lib/authErrors";
import {
  createPersonalAccessToken,
  fetchPersonalAccessTokens,
  revokePersonalAccessToken,
  type CreatedPersonalAccessToken,
  type PersonalAccessToken,
} from "@/lib/api";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import { PatRevealModal } from "@/components/settings/PatRevealModal";

// 个人访问令牌（PAT）自助：列出我的令牌、创建（名称 + scopes + 有效期）、一次性看明文、撤销。
//
// 契约（账号服务）：
//   GET    /api/auth/tokens      → { items: [{ id, name, token_prefix, scopes, expires_at, last_used_at, created_at, revoked_at }] }
//   POST   /api/auth/tokens      → 201 { token: "mfp_…", item: {…} }（明文只此一次）
//   DELETE /api/auth/tokens/:id  → { ok: true }（写 revoked_at）
// 明文库里只有 sha256，刷新页面就再也拿不回来：所以创建成功后必须**立刻**把明文摆在用户眼前，
// 不做"稍后再看"，也不把它塞进任何持久化状态。
//
// 撤销有窗口：下游服务的内省结果按 token_hash 缓存 60 秒，写库成功不等于立刻全站失效。
// 这句必须在界面上说清（曾经字典写的是"立即失效"，与实现相反）。
//
// scopes 是权限码：可选清单 = 持有人自己的权限码（用户权限 ∩ scopes 才是令牌的实际权限），
// 默认一项都不勾——最小权限是默认值，勾选是用户的显式动作。

/** 有效期选项：0 表示不带 expires_in_days（服务端即永不过期）。 */
const EXPIRY_CHOICES = [0, 30, 90, 365] as const;

export function PersonalAccessTokensPanel() {
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [tokens, setTokens] = useState<PersonalAccessToken[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiryDays, setExpiryDays] = useState<number>(0);
  const [creating, setCreating] = useState(false);

  // 明文只活在这一次会话的内存里：关闭弹窗即丢弃。
  const [reveal, setReveal] = useState<CreatedPersonalAccessToken | null>(null);

  const [confirming, setConfirming] = useState<PersonalAccessToken | null>(null);
  const [revokingId, setRevokingId] = useState("");

  const grantable = useMemo(() => grantablePermissionCodes(user), [user]);

  // 按服务前缀分组：scopes 是权限码，同一子系统的码看在一起才好选。
  const groups = useMemo<[string, string[]][]>(() => {
    const byService = new Map<string, string[]>();
    for (const code of grantable) {
      const service = code.split(".")[0] || code;
      const list = byService.get(service) || [];
      list.push(code);
      byService.set(service, list);
    }
    // Array.from 而不是展开 MapIterator：tsconfig 的 target 低于 es2015 时不可展开迭代器。
    return Array.from(byService.entries());
  }, [grantable]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchPersonalAccessTokens()
      .then((r) => {
        if (alive) setTokens(r.items);
      })
      .catch((e: unknown) => {
        if (alive) {
          // 保持 null：加载失败时不能落成"空列表"，否则界面上会同时出现"加载失败"和
          // "暂无令牌"两句话，把失败讲成"你还没有令牌"。
          setTokens(null);
          setError(patErrorText(e, "settings.patLoadFailed"));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // 账号服务的错误码可能带明细后缀（invalid_scope: catalog.entity.edit、
  // scope_not_granted: <code>）：先按码取名话，再把明细原样附在后面——码本身不翻译，
  // 但用户必须看得见是哪一个码被拒了，否则只能对着"请求失败"猜。
  const patErrorText = (e: unknown, fallbackKey: string): string => {
    const raw = e instanceof Error ? e.message : String(e);
    const cut = raw.indexOf(": ");
    const code = cut >= 0 ? raw.slice(0, cut) : raw;
    const detail = cut >= 0 ? raw.slice(cut + 2).trim() : "";
    const text = authErrorText(code, t, httpStatusOf(e), fallbackKey);
    return detail ? `${text} (${detail})` : text;
  };

  const formatTime = (value?: string | null): string | null => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString(locale);
  };

  // 未翻译的键会把裸键名显示出来：动态拼接的键（权限码）缺译文时回退到码本身，
  // 至少用户知道自己在勾什么。
  const labelOf = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const toggleScope = (code: string) => {
    setScopes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("settings.patNameRequired"));
      return;
    }
    if (scopes.length === 0) {
      setError(t("settings.patScopesRequired"));
      return;
    }
    setCreating(true);
    try {
      const created = await createPersonalAccessToken({
        name: trimmed,
        scopes,
        ...(expiryDays > 0 ? { expires_in_days: expiryDays } : {}),
      });
      setReveal(created);
      setName("");
      setScopes([]);
      // 以服务端为准回读列表，不在本地拼一条假记录。
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setError(patErrorText(err, "settings.patCreateFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!confirming) return;
    const target = confirming;
    setRevokingId(target.id);
    setError("");
    setNotice("");
    try {
      await revokePersonalAccessToken(target.id);
      setConfirming(null);
      setNotice(t("settings.patRevokeDone", { name: target.name }));
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setConfirming(null);
      setError(patErrorText(err, "settings.patRevokeFailed"));
    } finally {
      setRevokingId("");
    }
  };

  // 服务端算好的 active 优先：两端时钟不一致时，本地按 expires_at 比时间会把刚过期的
  // 令牌显示成"有效"。只有缺这个字段（旧服务端）才回落到本地判定。
  const statusOf = (token: PersonalAccessToken): "revoked" | "expired" | "active" => {
    if (token.active === true) return "active";
    if (token.active === false) return token.revoked_at ? "revoked" : "expired";
    if (token.revoked_at) return "revoked";
    if (token.expires_at) {
      const exp = new Date(token.expires_at);
      if (!Number.isNaN(exp.getTime()) && exp.getTime() <= Date.now()) return "expired";
    }
    return "active";
  };

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-text-strong flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-500" />
          <span>{t("settings.patTitle")}</span>
        </h3>
        <p className="text-xs text-text-faint leading-relaxed">{t("settings.patDesc")}</p>
        <p className="text-[11px] text-text-faint leading-relaxed">{t("settings.patRateLimitHint")}</p>
        <p className="text-[11px] text-amber-600 dark:text-warn leading-relaxed flex items-start gap-1.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.6} />
          <span>{t("settings.patWindowHint")}</span>
        </p>
        <a
          href={`${DOCS_SERVICE_URL}/api-auth`}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {t("settings.patViewDevDocs")}
        </a>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-danger-soft font-mono text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-2 h-6 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-line text-[11px] inline-flex items-center gap-1 shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{t("common.retry")}</span>
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-success-soft font-mono text-xs flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          <span>{notice}</span>
        </div>
      )}

      {/* 创建 */}
      <form onSubmit={handleCreate} className="p-3.5 rounded-xl bg-surfaceSubtle border border-line-subtle space-y-3">
        <div className="flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-text-muted" strokeWidth={1.8} />
          <span className="font-mono text-xs font-semibold text-text-body">{t("settings.patCreateTitle")}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1 min-w-0">
            <label className="font-mono text-[11px] text-text-muted">{t("settings.patTokenName")}</label>
            <input
              type="text"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.patNamePlaceholder")}
              className="w-full h-9 px-3 bg-background border border-line rounded-lg text-text-strong text-sm placeholder:text-text-muted focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono text-[11px] text-text-muted">{t("settings.patExpiry")}</label>
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className="h-9 px-3 bg-background border border-line rounded-lg text-text-strong text-sm focus:outline-none focus:border-primary/50"
            >
              {EXPIRY_CHOICES.map((days) => (
                <option key={days} value={days}>
                  {days === 0 ? t("settings.patExpiryNever") : t("settings.patExpiryDays", { days })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-text-muted">{t("settings.patScopes")}</span>
            {grantable.length > 0 && (
              <span className="font-mono text-[10px] text-text-muted">
                {t("settings.patSelected", { count: scopes.length, total: grantable.length })}
              </span>
            )}
          </div>

          {grantable.length === 0 ? (
            <p className="p-3 rounded-lg bg-background border border-line-subtle text-[11px] text-text-body leading-relaxed">
              {t("settings.patNoScopes")}
            </p>
          ) : (
            <div className="space-y-2">
              {groups.map(([service, codes]) => (
                <div key={service} className="space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                    {labelOf(`settings.patScopeGroup.${service}`, service)}
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
                              : "bg-background border-line text-text-body hover:border-primary/30")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleScope(code)}
                            className="sr-only"
                          />
                          {checked ? <Check className="w-3 h-3 text-primary" /> : null}
                          <span>{labelOf(`settings.patScope.${code}`, code)}</span>
                          <span className="font-mono text-[9px] text-text-muted">{code}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-text-faint leading-relaxed">{t("settings.patScopesHint")}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={creating || grantable.length === 0}
            className="px-3.5 h-9 rounded-lg bg-primary text-white keep-white font-semibold text-xs inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{creating ? t("settings.patCreating") : t("settings.patCreateBtn")}</span>
          </button>
          <span className="text-[11px] text-text-faint">{t("settings.patLimitHint")}</span>
        </div>
      </form>

      {/* 已颁发令牌 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-text-body">{t("settings.patIssuedTitle")}</span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="ml-auto px-2 h-7 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-line text-[11px] inline-flex items-center gap-1 text-text-body"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{t("settings.patRefresh")}</span>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-text-faint text-xs font-mono flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>{t("settings.patLoading")}</span>
          </div>
        ) : tokens === null ? null : tokens.length === 0 ? (
          <div className="p-6 rounded-xl bg-surfaceSubtle border border-line-subtle text-center space-y-2">
            <KeyRound className="w-5 h-5 text-text-muted mx-auto" strokeWidth={1.5} />
            <div className="text-xs text-text-body">{t("settings.patEmpty")}</div>
          </div>
        ) : (
          <ul className="space-y-2">
            {tokens.map((token) => {
              const status = statusOf(token);
              const lastUsed = formatTime(token.last_used_at);
              const createdAt = formatTime(token.created_at);
              const expiresAt = formatTime(token.expires_at);
              const statusClass =
                status === "active"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-success border-emerald-500/30"
                  : status === "expired"
                    ? "bg-amber-500/10 text-amber-600 dark:text-warn border-amber-500/30"
                    : "bg-rose-500/10 text-rose-600 dark:text-danger-soft border-rose-500/30";
              return (
                <li key={token.id} className="p-3 rounded-lg bg-background border border-line-subtle space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text-strong truncate">{token.name}</span>
                        <span className={"text-[10px] font-mono px-1.5 py-0.5 rounded-sm border " + statusClass}>
                          {status === "active"
                            ? t("settings.patActive")
                            : status === "expired"
                              ? t("settings.patExpired")
                              : t("settings.patRevoked")}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-text-faint" data-mf-pat-prefix={token.token_prefix}>
                        {t("settings.patPrefix", { prefix: token.token_prefix })}
                      </div>
                    </div>

                    {status !== "revoked" && (
                      <button
                        type="button"
                        onClick={() => {
                          setNotice("");
                          setError("");
                          setConfirming(token);
                        }}
                        className="shrink-0 px-2.5 h-7 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-danger-soft text-xs font-medium inline-flex items-center gap-1.5"
                      >
                        <ShieldOff className="w-3.5 h-3.5" />
                        <span>{t("settings.patRevoke")}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-text-faint">
                    {createdAt && (
                      <span>
                        {t("settings.patCreatedAt", { time: createdAt })}
                      </span>
                    )}
                    <span>
                      {lastUsed
                        ? t("settings.patLastUsedAt", { time: lastUsed })
                        : t("settings.patNeverUsed")}
                    </span>
                    <span>
                      {expiresAt
                        ? t("settings.patExpiresAt", { time: expiresAt })
                        : t("settings.patNoExpiry")}
                    </span>
                  </div>

                  {token.scopes.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {token.scopes.map((code) => (
                        <span
                          key={code}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-sky-500/10 text-sky-600 dark:text-info border border-sky-500/20"
                        >
                          {labelOf(`settings.patScope.${code}`, code)}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <PatRevealModal created={reveal} onClose={() => setReveal(null)} />

      {/* 撤销二次确认：用 Modal 版 ConfirmDialog，不用原生 confirm（不可本地化/不可样式化） */}
      <ConfirmDialog
        open={!!confirming}
        title={t("settings.patRevokeTitle")}
        message={t("settings.patRevokeConfirm", { name: confirming?.name || "" })}
        confirmLabel={t("settings.patRevoke")}
        busy={!!revokingId}
        onClose={() => setConfirming(null)}
        onConfirm={handleRevoke}
      />
    </div>
  );
}

export default PersonalAccessTokensPanel;