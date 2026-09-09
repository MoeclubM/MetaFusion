export const AUTH_SERVICE_URL =
  process.env.NEXT_PUBLIC_AUTH_URL || "/account";

export const FORUM_SERVICE_URL =
  process.env.NEXT_PUBLIC_FORUM_URL || "/community";

export const STORAGE_SERVICE_URL =
  process.env.NEXT_PUBLIC_RESOURCE_STATION_URL ||
  process.env.NEXT_PUBLIC_STORAGE_URL ||
  "https://resources.findverse.cc";

export const DOCS_SERVICE_URL =
  process.env.NEXT_PUBLIC_DOCS_URL || "/docs";

export function getAuthLoginUrl(returnTo?: string): string {
  const redirect = returnTo || (typeof window !== "undefined" ? window.location.href : "/");
  if (AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/login?redirect_uri=${encodeURIComponent(redirect)}`;
  }
  return `/login?redirect=${encodeURIComponent(redirect)}`;
}

export function getAuthRegisterUrl(returnTo?: string): string {
  const redirect = returnTo || (typeof window !== "undefined" ? window.location.href : "/");
  if (AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/register?redirect_uri=${encodeURIComponent(redirect)}`;
  }
  return `/login?tab=register&redirect=${encodeURIComponent(redirect)}`;
}

export function getAuthSettingsUrl(): string {
  if (AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/settings`;
  }
  return "/account";
}

export function getAuthPasswordUrl(): string {
  if (AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/password`;
  }
  return "/account";
}

export function getAuthUsersAdminUrl(): string {
  if (AUTH_SERVICE_URL.startsWith("http")) {
    return `${AUTH_SERVICE_URL}/admin/users`;
  }
  return "/account";
}

export function getForumEntityUrl(entityId: string): string {
  if (FORUM_SERVICE_URL.startsWith("http")) {
    return `${FORUM_SERVICE_URL}?entity_id=${encodeURIComponent(entityId)}`;
  }
  return `/community?entity_id=${encodeURIComponent(entityId)}`;
}

export function getForumCollectionUrl(collectionId: string): string {
  if (FORUM_SERVICE_URL.startsWith("http")) {
    return `${FORUM_SERVICE_URL}/collections/${encodeURIComponent(collectionId)}`;
  }
  return `/catalog/${encodeURIComponent(collectionId)}`;
}

export function getStorageEntityUrl(entityId?: string): string {
  if (STORAGE_SERVICE_URL.startsWith("http")) {
    return entityId
      ? `${STORAGE_SERVICE_URL}/subject/${encodeURIComponent(entityId)}`
      : STORAGE_SERVICE_URL;
  }
  const query = entityId ? `?subject_id=${encodeURIComponent(entityId)}` : "";
  return `/downloads${query}`;
}
