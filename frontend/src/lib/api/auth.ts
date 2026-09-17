// 由 frontend/src/lib/api.ts 按域拆分而来（机械搬运：导出名、签名、行为与拆分前一致）。
// 域：账号服务 /api/auth、/api/setup、邮箱验证
import { fetchApi } from "./client";
import type { User } from "./client";

export interface AuthSessionResponse {
  token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  user: User;
}

/**
 * 会话用户的唯一映射：/auth/me、/auth/login、/auth/register、/api/setup 拿到的原始对象
 * 都是账号服务 store.User 的 JSON 投影。这份映射原先在登录路径上手抄了五遍，其中登录的
 * 三处漏掉 groups/permissions（权限判定静默退回角色兜底），并用
 * `用户名@metafusion.local` 造了个假邮箱当成真实邮箱渲染。
 *
 * 拿不准的字段一律不造值：邮箱缺席就保持缺席（页面走 settings.unboundEmail），
 * display_name 缺席交给 displayNameOf 回落 username；组与权限码有就整份带住。
 * 其余字段（avatar_url / bio / is_email_verified / invite_code…）原样透传——
 * 它们是否存在由账号服务决定，前端不在这里裁剪。
 */
export function normalizeSessionUser(raw: unknown): User {
  const u = (raw || {}) as Record<string, any>;
  const { email, display_name, groups, permissions, ...rest } = u;
  return {
    ...rest,
    id: String(u.id ?? ""),
    username: String(u.username ?? ""),
    role: String(u.role ?? ""),
    ...(typeof email === "string" && email.trim() !== "" ? { email: email.trim() } : {}),
    ...(typeof display_name === "string" && display_name.trim() !== "" ? { display_name } : {}),
    // 账号服务按 omitempty 发这两个数组：给了就带住（空数组也是真实值），缺席才留空。
    ...(Array.isArray(groups) ? { groups: groups.filter((g: unknown) => typeof g === "string") } : {}),
    ...(Array.isArray(permissions) ? { permissions: permissions.filter((p: unknown) => typeof p === "string") } : {}),
  };
}

/**
 * 自助注册。是否需要邀请码由实例设置决定（GET /auth/settings 的 invite_required），
 * 服务端在注册事务里校验并消耗次数；前端只透传，不做本地判定。
 */

export function registerAccount(payload: {
  username: string;
  email?: string;
  password: string;
  invite_code?: string;
}): Promise<AuthSessionResponse> {
  return fetchApi<AuthSessionResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 邀请码：带次数上限与可选过期时间；used_count 由服务端在注册事务里累加。 */

export interface InviteCode {
  code: string;
  created_by: string;
  creator?: string;
  note: string;
  max_uses: number;
  used_count: number;
  revoked: boolean;
  expires_at?: string;
  created_at: string;
}

/** GET /auth/invite：我的邀请码台账 + 由我邀请进来的人 + 当前是否可签发。 */

export interface InviteLedger {
  items: InviteCode[];
  members: User[];
  can_create: boolean;
}

export function fetchInviteLedger(): Promise<InviteLedger> {
  return fetchApi<InviteLedger>("/auth/invite");
}

export function createInviteCode(payload: {
  note?: string;
  max_uses?: number;
  expires_in_days?: number;
}): Promise<InviteCode> {
  return fetchApi<InviteCode>("/auth/invite", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── 第三方授权自助：GET/DELETE /auth/oauth-grants ──
//
// 归属是当前登录身份（路径里没有别人的 user id），因此普通成员也能看/收回自己的授权。
// 后端返回的形状是 store.AuthorizedApp 的逐字投影：名称取不到时用 client_id 兜底，
// last_authorized_at 来自同意审计（授权过但令牌已过期的应用也会在列表里），
// expires_at 只在还有生效令牌时才有值——两者都是可选项，缺席就整行不渲染。
export interface AuthorizedApp {
  client_id: string;
  name: string;
  scopes: string[];
  /** 当前还有未过期令牌。 */
  active: boolean;
  last_authorized_at?: string;
  expires_at?: string;
}

export function fetchOAuthGrants(): Promise<{ items: AuthorizedApp[] }> {
  return fetchApi<{ items: AuthorizedApp[] }>("/auth/oauth-grants");
}

/** 撤回：后端按 (user_id, client_id) 删除未过期令牌并作废未兑换授权码，幂等（本来没有也回 ok）。 */
export function revokeOAuthGrant(clientId: string): Promise<{ ok: boolean; revoked: number }> {
  return fetchApi<{ ok: boolean; revoked: number }>("/auth/oauth-grants/" + encodeURIComponent(clientId), {
    method: "DELETE",
  });
}

// ── 目录关系图谱拓扑与关系边 ──
// ── OOBE 开箱初始化设置 ──
export interface SetupStatusResponse {
  is_initialized: boolean;
  has_admin: boolean;
  site_name: string;
  total_users: number;
}

export interface InitialSetupPayload {
  username: string;
  display_name?: string;
  email: string;
  password: string;
  site_name?: string;
  registration_enabled?: boolean;
  invite_required?: boolean;
}

export interface InitialSetupResult {
  message: string;
  user: User;
  token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export async function fetchSetupStatus(): Promise<SetupStatusResponse> {
  try {
    const res = await fetch("/api/setup", { credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      return { is_initialized: !data.needed, has_admin: !data.needed, site_name: "MetaFusion", total_users: 1 };
    }
  } catch {}
  return { is_initialized: true, has_admin: true, site_name: "MetaFusion", total_users: 1 };
}

export interface PublicAuthSettings {
  registration_enabled: boolean;
  invite_required: boolean;
  require_email_verification: boolean;
  email_verification_enabled: boolean;
  rate_limit_enabled?: boolean;
  auth_rate_limit_enabled?: boolean;
}

export function fetchAuthSettings(): Promise<PublicAuthSettings> {
  return fetchApi<PublicAuthSettings>("/auth/settings");
}

export async function performInitialSetup(payload: InitialSetupPayload): Promise<InitialSetupResult> {
  const setupRes = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: payload.username,
      email: payload.email,
      password: payload.password,
    }),
  });
  if (!setupRes.ok) {
    const err = await setupRes.json().catch(() => ({}));
    throw new Error(err.error || "setup_failed");
  }
  const user = await setupRes.json();
  const loginRes = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: payload.username,
      password: payload.password,
    }),
  });
  const loginData = loginRes.ok ? await loginRes.json() : {};
  return {
    message: "setup_success",
    // 初始化路径同样走唯一的会话映射：登录响应带 groups/permissions，不能在这里漏掉。
    user: normalizeSessionUser(loginData.user || user),
    token: loginData.token || "",
    access_token: loginData.token || "",
    refresh_token: "",
    expires_in: 86400,
    token_type: "Bearer",
  };
}

