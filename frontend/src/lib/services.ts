// 页面由网关按路径转发到各服务；账号登录与初始化页由账号服务唯一维护。
const FORUM_PAGES_ENABLED: boolean = false;

export const FORUM_SERVICE_URL =
  process.env.NEXT_PUBLIC_FORUM_URL || "/community";

// 资源站是独立外部服务，它自己就有页面（/subject/<id>），与上面两个服务不同：
// 未显式配置地址时视为尚未开放，不展示任何跳转入口，避免出现指向不存在域名的死链
// （曾硬编码 resources.findverse.cc，DNS 无此记录）。
const CONFIGURED_STORAGE_URL =
  process.env.NEXT_PUBLIC_RESOURCE_STATION_URL ||
  process.env.NEXT_PUBLIC_STORAGE_URL ||
  "";

export const STORAGE_SERVICE_URL = /^https?:\/\//i.test(CONFIGURED_STORAGE_URL)
  ? CONFIGURED_STORAGE_URL.replace(/\/+$/, "")
  : "";

/** 资源站是否已接入：为 false 时所有资源跳转入口都应隐藏。 */
export function hasResourceStation(): boolean {
  return STORAGE_SERVICE_URL !== "";
}

export const DOCS_SERVICE_URL =
  process.env.NEXT_PUBLIC_DOCS_URL || "/docs";

export function getAuthLoginUrl(returnTo?: string): string {
  const redirect = returnTo || (typeof window !== "undefined" ? window.location.href : "/");
  return `/login?redirect=${encodeURIComponent(redirect)}`;
}

// 密码设置由主站 settings 页维护，供账号管理入口使用。
export function getAuthPasswordUrl(): string {
  return "/settings?tab=password";
}

// 账号域的管理面是独立控制台（metafusion-auth/admin，网关 /admin/account/），不是本前端的页面。
// 入口只在探活通过后渲染，见 components/Navbar.tsx。
export function getAuthUsersAdminUrl(): string {
  return "/admin/account/";
}

// 条目 → 论坛的地址。条目页的「在论坛打开」原来有两种拼法（这里只有 entity_id，
// works/[id] 那边手拼 board_code=comment），统一收在这里：板块可选，社区页从
// board_code 读初始板块（app/community/page.tsx），不传就是全部板块。
export function getForumEntityUrl(entityId: string, boardCode?: string): string {
  const query = new URLSearchParams({ entity_id: entityId });
  if (boardCode) query.set("board_code", boardCode);
  if (FORUM_PAGES_ENABLED && FORUM_SERVICE_URL.startsWith("http")) {
    return `${FORUM_SERVICE_URL}?${query.toString()}`;
  }
  return `/community?${query.toString()}`;
}

export function getForumCollectionUrl(collectionId: string): string {
  if (FORUM_PAGES_ENABLED && FORUM_SERVICE_URL.startsWith("http")) {
    return `${FORUM_SERVICE_URL}/collections/${encodeURIComponent(collectionId)}`;
  }
  return `/catalog/${encodeURIComponent(collectionId)}`;
}

export function getStorageEntityUrl(entityId?: string): string {
  if (STORAGE_SERVICE_URL) {
    return entityId
      ? `${STORAGE_SERVICE_URL}/subject/${encodeURIComponent(entityId)}`
      : STORAGE_SERVICE_URL;
  }
  const query = entityId ? `?subject_id=${encodeURIComponent(entityId)}` : "";
  return `/downloads${query}`;
}
