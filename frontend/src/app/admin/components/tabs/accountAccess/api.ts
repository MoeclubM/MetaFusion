// 账号服务（metafusion-auth）管理台契约的前端薄封装。
//
// 契约来源（只读核对，本任务未改账号服务代码）：
//   metafusion-auth/internal/handler/handler.go     —— 路由与响应形状
//   metafusion-auth/internal/store/groups.go        —— Group / Invite DTO
//   metafusion-auth/internal/store/access.go        —— PermissionCode 与实例设置键
//   metafusion-auth/internal/store/identity.go      —— ListUsers 含 groups/permissions
//
// 边界：账号服务只负责"存组、存权限码、算出权限集合"，**不解释权限码的含义**。
// 本模块同样不解释，只把接口给的 service 前缀原样透出，由界面标明
// "元数据系统与论坛各解释自己那些码"。

import { ApiError, fetchApi } from "@/lib/api";

/** 实例设置是后端返回的键值补丁：键与类型都由接口决定，前端不维护字段清单。 */
export type SettingsMap = Record<string, unknown>;

/** 权限码清单项；service 是它所属子系统前缀（auth / catalog / community / storage）。 */
export interface AdminPermissionCode {
  code: string;
  service?: string;
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
}

/** 权限组：一份权限码集合 + 四语显示名。is_system 的组可以改权限，但不可删。 */
export interface AdminGroup {
  id?: string;
  code: string;
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
  permissions?: string[];
  is_system?: boolean;
  sort_order?: number;
}

/** 用户投影：groups 是组码，permissions 是服务端展开后的权限集合（含 * 短路）。 */
export interface AdminUser {
  id: string;
  username: string;
  email?: string;
  role?: string;
  /** 封禁是访问控制而不是"人不存在"：被封禁者仍出现在列表里，带 banned=true。 */
  banned?: boolean;
  groups?: string[];
  permissions?: string[];
}

/**
 * 角色枚举取自 store/identity.go 的校验分支（CreateUserWithRole 与 UpdateUserRole 都只认这三个值）。
 * 这里不发明第四种：名单外的角色写进去只会拿回 invalid_role。
 */
export const ADMIN_ROLES = ["user", "editor", "admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** 角色的字典键：沿用已存在的 admin.users.role* 词条，不另起一套。 */
export function roleLabelKey(role: string): string {
  if (role === "admin") return "admin.users.roleAdmin";
  if (role === "editor") return "admin.users.roleArchivist";
  return "admin.users.roleUser";
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** useI18n() 的 tr：缺键时返回后备值（用于"接口有键就翻译、没有就原样显示"的覆盖层）。 */
export type TranslateOrFn = (key: string, fallback: string, vars?: Record<string, string | number>) => string;

// ── 请求 ──

export function fetchAdminSettings(): Promise<SettingsMap> {
  return fetchApi<SettingsMap>("/admin/settings");
}

/** PUT 是补丁语义：只提交改动过的键，未知键会被后端拒绝（invalid_setting）。 */
export function updateAdminSettings(patch: SettingsMap): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>("/admin/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function fetchAdminGroups(): Promise<AdminGroup[]> {
  const res = await fetchApi<{ items?: AdminGroup[] }>("/admin/groups");
  return res.items ?? [];
}

export async function fetchAdminPermissions(): Promise<AdminPermissionCode[]> {
  const res = await fetchApi<{ items?: AdminPermissionCode[] }>("/admin/permissions");
  return res.items ?? [];
}

export function createAdminGroup(group: AdminGroup): Promise<AdminGroup> {
  return fetchApi<AdminGroup>("/admin/groups", {
    method: "POST",
    body: JSON.stringify(group),
  });
}

/** 组码不可改：它是路由参数与成员关系的锚点，因此 body 里不带 code。 */
export function updateAdminGroup(code: string, group: AdminGroup): Promise<AdminGroup> {
  return fetchApi<AdminGroup>(`/admin/groups/${encodeURIComponent(code)}`, {
    method: "PUT",
    body: JSON.stringify({
      names: group.names ?? {},
      descriptions: group.descriptions ?? {},
      permissions: group.permissions ?? [],
      sort_order: group.sort_order ?? 0,
    }),
  });
}

export function deleteAdminGroup(code: string): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>(`/admin/groups/${encodeURIComponent(code)}`, { method: "DELETE" });
}

/**
 * 建号：邮箱可留空，服务端会用 `<username>@findverse.cc` 兜底（store.CreateUserWithRole）。
 * 用户名 2–80 位、密码 12–72 位，越界是 invalid_credentials_format。
 */
export function createAdminUser(input: {
  username: string;
  email?: string;
  password: string;
}): Promise<AdminUser> {
  return fetchApi<AdminUser>("/admin/users", {
    method: "POST",
    body: JSON.stringify({ username: input.username, email: input.email ?? "", password: input.password }),
  });
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await fetchApi<{ items?: AdminUser[] }>("/admin/users");
  return res.items ?? [];
}

/** 覆盖式写入：传空数组即清空该用户的全部组。 */
export function setAdminUserGroups(userId: string, groups: string[]): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>(`/admin/users/${encodeURIComponent(userId)}/groups`, {
    method: "PUT",
    body: JSON.stringify({ groups }),
  });
}

/**
 * 改角色是**写透两处**的：store.UpdateUserRole 先把 auth.user_groups 该用户的成员关系全删掉，
 * 再按 RoleToGroups 重建（admin → admin；editor → catalog_editor, member；其余 → member）。
 * 也就是说手工分配的权限组会被角色默认组覆盖——界面必须在提交前讲清这件事。
 */
export function updateAdminUserRole(userId: string, role: string): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>(`/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

/** 重置密码：服务端只认 12–72 位（store.ResetUserPassword），过短过长都是 invalid_password_length。 */
export function resetAdminUserPassword(userId: string, password: string): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>(`/admin/users/${encodeURIComponent(userId)}/password`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });
}

/**
 * 封禁/解封同一个端点，body 是 `{banned}`——服务端把缺字段当非法载荷（不是"解封"）。
 * 响应回的是保存后的账号投影，界面据此刷新该行而不是猜结果。
 */
export function setAdminUserBanned(userId: string, banned: boolean): Promise<{ ok: boolean; user?: AdminUser }> {
  return fetchApi<{ ok: boolean; user?: AdminUser }>(`/admin/users/${encodeURIComponent(userId)}/ban`, {
    method: "PUT",
    body: JSON.stringify({ banned }),
  });
}

// ── 纯函数：分组、展开、错误文案 ──

/** 接口未给 service 时退回码的第一段；* 单独成组。 */
export function permissionPrefix(code: string, catalog?: AdminPermissionCode[]): string {
  if (code === "*") return "*";
  const service = catalog?.find((p) => p.code === code)?.service;
  if (service) return service;
  return code.split(".")[0] || code;
}

/** 按前缀分组，保持调用方给出的顺序（清单顺序即 auth → catalog → community → storage）。 */
export function groupPermissionsByPrefix(
  codes: string[],
  catalog?: AdminPermissionCode[]
): { prefix: string; codes: string[] }[] {
  const order: string[] = [];
  const byPrefix = new Map<string, string[]>();
  for (const code of codes) {
    const prefix = permissionPrefix(code, catalog);
    const bucket = byPrefix.get(prefix);
    if (bucket) {
      bucket.push(code);
    } else {
      byPrefix.set(prefix, [code]);
      order.push(prefix);
    }
  }
  return order.map((prefix) => ({ prefix, codes: byPrefix.get(prefix) ?? [] }));
}

/**
 * 本地镜像账号服务的 ExpandPermissions（见 auth/store/access.go）：
 * 按 groups 的给定顺序去重收集，遇到 * 直接短路为全权。
 * groups 需按接口顺序（sort_order, code）传入，才能与服务端集合一致。
 */
export function expandPermissions(groupCodes: string[], groups: AdminGroup[]): string[] {
  const selected = new Set(groupCodes);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    if (!selected.has(group.code)) continue;
    for (const raw of group.permissions ?? []) {
      const code = raw.trim();
      if (!code || seen.has(code)) continue;
      if (code === "*") return ["*"];
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/** 每个权限码由哪些选中的组提供：界面据此说明"通过组拿到哪些权限"。 */
export function permissionGranters(
  groupCodes: string[],
  groups: AdminGroup[]
): Map<string, string[]> {
  const selected = new Set(groupCodes);
  const out = new Map<string, string[]>();
  for (const group of groups) {
    if (!selected.has(group.code)) continue;
    for (const raw of group.permissions ?? []) {
      const code = raw.trim();
      if (!code) continue;
      out.set(code, [...(out.get(code) ?? []), group.code]);
    }
  }
  return out;
}

/**
 * 把接口错误翻成如实的中文提示：403 说清缺哪个权限码，5xx/网络错误说清账号服务不可达，
 * 其余把后端错误码原样带出。绝不把失败伪装成成功。
 */
export function describeAdminError(err: unknown, t: TranslateFn, requiredPermission: string): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return t("admin.account.errUnauthorized");
    if (err.status === 403) return t("admin.account.errForbidden", { code: requiredPermission });
    if (err.status === 404) return t("admin.account.errNotFound");
    if (err.status >= 502 && err.status <= 504) {
      return t("admin.account.errUpstream", { status: err.status });
    }
    return t("admin.account.errFailed", { status: err.status, message: err.message });
  }
  return t("admin.account.errNetwork", {
    message: err instanceof Error ? err.message : String(err),
  });
}

/**
 * 成员治理写操作的错误码表。
 *
 * 账号服务的 respond() 只把 forbidden→403、not_found→404 挑出来，其余全部落到 400 + {`error`: 码}，
 * 所以护栏类错误（不能封自己、不能动最后一个管理员）都会带着**稳定的错误码**回来。
 * 这些码必须逐条翻成人话：裸码对管理员没有意义，把 400 笼统说成"请求失败"又会丢掉唯一有用的信息。
 */
const USER_ADMIN_ERROR_KEYS: Record<string, string> = {
  cannot_ban_self: "admin.users.errCannotBanSelf",
  cannot_ban_sole_admin: "admin.users.errCannotBanSoleAdmin",
  cannot_demote_sole_admin: "admin.users.errCannotDemoteSoleAdmin",
  invalid_role: "admin.users.errInvalidRole",
  invalid_password_length: "admin.users.errInvalidPasswordLength",
  invalid_credentials_format: "admin.users.errInvalidCredentials",
  user_not_found: "admin.users.errUserNotFound",
  invalid_payload: "admin.users.errInvalidPayload",
};

export function describeUserAdminError(err: unknown, t: TranslateFn, requiredPermission: string): string {
  if (err instanceof ApiError) {
    const code = String(err.message || "");
    const key = USER_ADMIN_ERROR_KEYS[code];
    if (key) return t(key);
    // group_not_found 带参数（"group_not_found: 组码"），单列一条而不是塞进上面的定值表。
    if (code.startsWith("group_not_found")) {
      return t("admin.users.errGroupNotFound", { code: code.slice("group_not_found".length).replace(/^:\s*/, "") });
    }
  }
  return describeAdminError(err, t, requiredPermission);
}
