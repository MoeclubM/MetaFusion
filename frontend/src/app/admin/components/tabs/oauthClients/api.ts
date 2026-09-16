// OAuth 授权方（第三方接入）管理面的前端薄封装。
//
// 契约来源（只读核对，本任务未改账号服务代码）：
//   metafusion-auth/internal/handler/oauth_admin.go —— 路由、请求形状与响应形状
//   metafusion-auth/internal/store/oauth.go         —— OAuthClient / OAuthClientInput / OAuthAuditEntry / SupportedScopes
//
// 边界：client_secret 只在创建与轮换的响应里出现一次（库里只有 bcrypt 哈希），
// 因此界面拿到后必须立刻让用户保存；"再看一眼密钥"这种入口不存在，也不该伪造。

import { ApiError, fetchApi } from "@/lib/api";

/** 客户端投影：不含密钥哈希（服务端 SecretHash 的 json tag 为 "-"）。 */
export interface OAuthClient {
  client_id: string;
  name: string;
  redirect_uris: string[];
  scopes: string[];
  trusted: boolean;
  disabled: boolean;
  created_at: string;
}

/** 创建 / 轮换的响应：client_secret 是**一次性明文**，离开这一次响应就无处可取。 */
export interface OAuthClientSecret {
  client: OAuthClient;
  client_secret: string;
}

/** 授权审计行：客户端删除后审计仍在（client_id 上没有外键）。 */
export interface OAuthAuditEntry {
  id: string;
  actor_user_id?: string;
  actor_username?: string;
  subject_user_id?: string;
  client_id: string;
  action: string;
  scopes: string[];
  detail?: string;
  created_at: string;
}

/** 写入形状：字段缺省即"不改这一项"（服务端用指针区分没传与传了零值）。 */
export interface OAuthClientDraft {
  client_id?: string;
  name?: string;
  redirect_uris?: string[];
  scopes?: string[];
  trusted?: boolean;
  disabled?: boolean;
}

/** 受支持的 scope，与 store.SupportedScopes 一致；界面只从这里出选项，不维护第二份清单。 */
export const OAUTH_SCOPES = ["openid", "profile", "email"] as const;

/** client_id 形状：小写字母开头，后续小写字母/数字/_/-（与 store.ValidClientID 同口径）。 */
export const OAUTH_CLIENT_ID_RE = /^[a-z][a-z0-9_-]{2,63}$/;

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

// ── 请求 ──

export async function fetchOAuthClients(): Promise<OAuthClient[]> {
  const res = await fetchApi<{ items?: OAuthClient[] }>("/admin/oauth/clients");
  return res.items ?? [];
}

export function createOAuthClient(draft: OAuthClientDraft): Promise<OAuthClientSecret> {
  return fetchApi<OAuthClientSecret>("/admin/oauth/clients", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

/**
 * 局部更新：只提交改动过的字段。
 * PUT 对服务端是补丁语义，多传的字段就等于改了它 —— 用表单原样回填会把禁用开关也一起写上。
 */
export function updateOAuthClient(id: string, patch: OAuthClientDraft): Promise<OAuthClient> {
  return fetchApi<{ client: OAuthClient }>("/admin/oauth/clients/" + encodeURIComponent(id), {
    method: "PUT",
    body: JSON.stringify(patch),
  }).then((res) => res.client);
}

export function rotateOAuthClientSecret(id: string): Promise<OAuthClientSecret> {
  return fetchApi<OAuthClientSecret>("/admin/oauth/clients/" + encodeURIComponent(id) + "/rotate-secret", {
    method: "POST",
  });
}

export function deleteOAuthClient(id: string): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>("/admin/oauth/clients/" + encodeURIComponent(id), { method: "DELETE" });
}

/** 吊销该客户端名下全部未过期令牌（并作废尚未兑换的授权码）。 */
export function revokeOAuthClientTokens(id: string): Promise<{ revoked: number }> {
  return fetchApi<{ revoked: number }>("/admin/oauth/clients/" + encodeURIComponent(id) + "/revoke-tokens", {
    method: "POST",
  });
}

/** 审计：client_id 过滤 + limit（服务端把 <=0 或 >500 归一到 100）。 */
export async function fetchOAuthAudits(clientId = "", limit = 100): Promise<OAuthAuditEntry[]> {
  const params = new URLSearchParams();
  if (clientId.trim()) params.set("client_id", clientId.trim());
  if (limit > 0) params.set("limit", String(limit));
  const qs = params.toString();
  const res = await fetchApi<{ items?: OAuthAuditEntry[] }>("/admin/oauth/audits" + (qs ? "?" + qs : ""));
  return res.items ?? [];
}

// ── 纯函数：时间与错误文案 ──

/** 接口给的是 UTC RFC3339；这里只做本地化展示，解析不了就原样显示，不猜。 */
export function formatStamp(value: string, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 把账号服务的错误码翻成人话（码表见 store/oauth.go）。
 * 码的形态有两种：单独的 code，以及 "code: detail"（例如 invalid_scope: email、
 * invalid_redirect_uri: /cb），后者把 detail 填进文案，让用户知道是哪一条被拒。
 * 未知码回退到"操作失败（HTTP xxx）：原码"，绝不把失败伪装成成功，也不吞掉状态码。
 */
export function describeOAuthError(err: unknown, t: TranslateFn): string {
  if (err instanceof ApiError) {
    const raw = (err.message || "").trim();
    const separator = raw.indexOf(":");
    const code = (separator >= 0 ? raw.slice(0, separator) : raw).trim();
    const detail = separator >= 0 ? raw.slice(separator + 1).trim() : "";
    if (code) {
      const key = "admin.oauth.error." + code;
      const translated = t(key, { detail: detail, status: err.status });
      if (translated !== key) return translated;
    }
    if (err.status === 401) return t("admin.oauth.error.unauthorized");
    if (err.status === 403) return t("admin.oauth.error.forbidden");
    if (err.status === 404) return t("admin.oauth.error.client_not_found");
    if (err.status >= 502 && err.status <= 504) return t("admin.oauth.error.upstream", { status: err.status });
    return t("admin.oauth.error.generic", { status: err.status, message: raw || "HTTP " + err.status });
  }
  return t("admin.oauth.error.network", {
    message: err instanceof Error ? err.message : String(err),
  });
}
