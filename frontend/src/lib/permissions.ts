// 前端权限判定：码表由 backend/internal/catalog/permission.go 与各子系统仓库声明生成
// （见 frontend/scripts/generate-contracts.mjs），本文件不再手抄任何码。
//
// 权限码由账号服务装进组（auth.groups.permissions），各子系统声明并解释自己的码。
// 这里只做"能不能看到入口"的判断；真正的写入授权仍在服务端，前端判定只是别把
// 用户引到注定 403 的按钮上，也不能因为前端放行就以为服务端会放行。

import type { User } from "./api";
import {
  ALL_PERMISSION_CODES,
  AUTH_GROUPS_MANAGE,
  AUTH_SETTINGS_MANAGE,
  AUTH_USERS_MANAGE,
  CATALOG_DEFINITIONS_MANAGE,
  CATALOG_ENTITY_EDIT,
  CATALOG_LIFECYCLE_MANAGE,
  CATALOG_SHELVES_MANAGE,
} from "./permissions.generated";

// 既有调用点从 "@/lib/permissions" 取这些常量，导出名保持不变；
// 用 export { ... } from 而不是 export const，以保留生成物里的字面量类型。
export {
  AUTH_GROUPS_MANAGE,
  AUTH_INVITES_MANAGE,
  AUTH_OAUTH_MANAGE,
  AUTH_SETTINGS_MANAGE,
  AUTH_USERS_MANAGE,
  CATALOG_DEFINITIONS_MANAGE,
  CATALOG_ENTITY_EDIT,
  CATALOG_IMPORT_SUBMIT,
  CATALOG_LIFECYCLE_MANAGE,
  CATALOG_RELATION_EDIT,
  CATALOG_SHELVES_MANAGE,
  COMMUNITY_BOARD_MANAGE,
  COMMUNITY_POST_CREATE,
  COMMUNITY_POST_MODERATE,
  COMMUNITY_TOPIC_PIN,
  STORAGE_ASSET_MODERATE,
  STORAGE_ASSET_UPLOAD,
} from "./permissions.generated";

type AnyUser = Pick<User, "id" | "role"> & Partial<Pick<User, "permissions" | "groups">>;

/**
 * can 判定"这个用户持有某个权限码吗"。
 *
 * 令牌带 permissions 时一律以码为准（含通配符 *）；没带（老令牌或实例尚未配置权限组）时
 * 按角色兜底，与后端 User.Can 完全一致，避免前后端出现"前端给按钮、后端拒绝"的分裂。
 */
export function can(user: AnyUser | null | undefined, code: string): boolean {
  if (!user) return false;
  const perms = user.permissions || [];
  if (perms.includes("*") || perms.includes(code)) return true;
  if (perms.length > 0) return false;
  if (user.role === "admin") return true;
  if (code === CATALOG_ENTITY_EDIT && user.role === "editor") return true;
  return false;
}

/**
 * 个人访问令牌（PAT）可授权的权限码：只能是自己持有的那些码。
 *
 * 服务端按「用户权限 ∩ 令牌 scopes」收敛，所以勾了自己没有的码也拿不到东西——
 * 前端先把不可能生效的选项去掉，别让用户勾完才发现白勾。
 * 与 can() 同一套回落：老令牌（没有 permissions 声明）按历史 role 兜底；
 * 带 * 通配时展开成具体码，因为 scopes 要落库、要能被人看懂。
 * 本实例自定义的码不在生成物里也照样列出：它可能真实存在，藏起来只会更糟。
 */
export function grantablePermissionCodes(user: AnyUser | null | undefined): string[] {
  if (!user) return [];
  const perms = user.permissions || [];
  const known = ALL_PERMISSION_CODES as readonly string[];
  if (perms.includes("*")) return [...known];
  if (perms.length > 0) {
    const listed = known.filter((code) => perms.includes(code));
    const custom = perms.filter((code) => !known.includes(code));
    return [...listed, ...custom];
  }
  if (user.role === "admin") return [...known];
  if (user.role === "editor") return [CATALOG_ENTITY_EDIT];
  return [];
}

/** 能否进入管理中台：账号域或目录域的任一管理码，或老令牌下的 admin 角色。 */
export function canEnterAdmin(user: AnyUser | null | undefined): boolean {
  return [AUTH_SETTINGS_MANAGE, AUTH_GROUPS_MANAGE, AUTH_USERS_MANAGE,
    CATALOG_DEFINITIONS_MANAGE, CATALOG_SHELVES_MANAGE, CATALOG_LIFECYCLE_MANAGE]
    .some((code) => can(user, code));
}

/** 能否编辑这个实体：审核/生命周期码放行一切；编辑码放行（含协作维护已发布条目）；否则只能改自己的草稿。 */
export function canEditEntity(user: AnyUser | null | undefined, entity: { status?: string; created_by?: string } | null | undefined): boolean {
  if (!user || !entity) return false;
  if (entity.status === "deleted" || entity.status === "merged") return false;
  if (can(user, CATALOG_LIFECYCLE_MANAGE)) return true;
  if (can(user, CATALOG_ENTITY_EDIT)) return true;
  return entity.created_by === user.id && entity.status !== "published";
}

/** 能否把条目直接置为已发布（草稿/待审之外的状态选项）。 */
export function canPublishEntity(user: AnyUser | null | undefined, entity: { created_by?: string } | null | undefined): boolean {
  if (!user) return false;
  if (can(user, CATALOG_LIFECYCLE_MANAGE)) return true;
  if (!can(user, CATALOG_ENTITY_EDIT)) return false;
  return !entity?.created_by || entity.created_by === user.id;
}
