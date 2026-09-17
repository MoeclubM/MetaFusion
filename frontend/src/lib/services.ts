// 服务页面入口。
//
// NEXT_PUBLIC_*_URL 是**服务自带 UI 之后**的页面地址：在各服务还没有自己的页面之前，
// /login、/setup、/account、/community、/downloads 这些路由都由本前端提供
// （deploy/nginx.conf 的 location /），把地址拼到服务前缀上只会得到账号/互动服务上
// 不存在的页面（它们只有 JSON API）。所以：目标服务没有页面路由时一律退回同源路径。
//
// 审计 D1（每个服务自带 UI）落地后，把对应服务的 *_PAGES_ENABLED 打开，并在编排里把
// NEXT_PUBLIC_*_URL 配成该服务的页面地址（构建期 build arg，见 frontend/Dockerfile）。
const AUTH_PAGES_ENABLED: boolean = false;
const FORUM_PAGES_ENABLED: boolean = false;

export const AUTH_SERVICE_URL =
  process.env.NEXT_PUBLIC_AUTH_URL || "/account";

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
  if (AUTH_PAGES_ENABLED && AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/login?redirect_uri=${encodeURIComponent(redirect)}`;
  }
  return `/login?redirect=${encodeURIComponent(redirect)}`;
}

export function getAuthRegisterUrl(returnTo?: string): string {
  const redirect = returnTo || (typeof window !== "undefined" ? window.location.href : "/");
  if (AUTH_PAGES_ENABLED && AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/register?redirect_uri=${encodeURIComponent(redirect)}`;
  }
  return `/login?tab=register&redirect=${encodeURIComponent(redirect)}`;
}

// 账号自助页（资料/隐私/令牌/外观/已授权应用/改密码）由本前端提供：/settings。
export function getAuthSettingsUrl(): string {
  if (AUTH_PAGES_ENABLED && AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/settings`;
  }
  return "/settings";
}

// 改密码的唯一实现在本前端的设置页（?tab=password 是 SETTINGS_TABS 白名单内的深链），
// 供 /account 的入口链接使用：那边有错误码四语映射、minLength 与改密后的重新登录引导。
export function getAuthPasswordUrl(): string {
  if (AUTH_PAGES_ENABLED && AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/settings?tab=password`;
  }
  return "/settings?tab=password";
}

// 账号域的管理面是独立控制台（metafusion-auth/admin，网关 /admin/account/），不是本前端的页面，
// 也不随 AUTH_SERVICE_URL 这个"账号服务页面地址"开关走：恒定给网关路径（带尾斜杠省一次 301）。
// 入口只在探活通过后渲染，见 components/Navbar.tsx。
export function getAuthUsersAdminUrl(): string {
  return "/admin/account/";
}

export function getForumEntityUrl(entityId: string): string {
  if (FORUM_PAGES_ENABLED && FORUM_SERVICE_URL.startsWith("http")) {
    return `${FORUM_SERVICE_URL}?entity_id=${encodeURIComponent(entityId)}`;
  }
  return `/community?entity_id=${encodeURIComponent(entityId)}`;
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
