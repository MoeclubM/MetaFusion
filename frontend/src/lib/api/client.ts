const getApiBase = () => {
  if (typeof window !== "undefined") {
    // 浏览器端：使用网关相对路径，自适应任何主机/域名/IP
    return "/api";
  }
  // 服务端 (SSR)：使用容器内网
  return process.env.INTERNAL_API_URL || "http://backend:8080/api";
};

export interface User {
  id: string;
  username: string;
  display_name?: string | null;
  /** 账号服务没绑邮箱时整字段缺席（不要造 `用户名@metafusion.local` 之类的假值）；
   *  展示端用 settings.unboundEmail 兜底。 */
  email?: string;
  role: string;
  /** 账号服务给的组与权限码：授权判定以 permissions 为准（见 lib/permissions.ts）。
   *  原始响应到 User 的映射只有一处：lib/api/auth.ts 的 normalizeSessionUser。 */
  groups?: string[];
  permissions?: string[];
  invite_code?: string;
  invites_remaining?: number;
  invited_by?: string;
  avatar_url?: string;
  bio?: string;
  favorites_public?: boolean;
  email_public?: boolean;
  is_email_verified?: boolean;
  created_at?: string;
  updated_at?: string;
  inviter?: User;
}

export function displayNameOf(u: Pick<User, "username" | "display_name">): string {
  const dn = (u as any).display_name;
  if (typeof dn === "string" && dn.trim() !== "") return dn.trim();
  return u.username;
}

// ── 自助注册与个人邀请码（账号服务 /api/auth/*）──

/** POST /auth/register 的响应：成功即签发登录令牌，前端可直接进入登录态。 */

let refreshPromise: Promise<string | null> | null = null;

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("metafusion_token");
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("metafusion_refresh_token");
}

export function setAuthTokens(accessToken: string, refreshToken?: string | null): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("metafusion_token", accessToken);
  if (refreshToken) {
    localStorage.setItem("metafusion_refresh_token", refreshToken);
  }
}

export function clearAuthTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("metafusion_token");
  localStorage.removeItem("metafusion_refresh_token");
}

async function requestTokenRefresh(): Promise<string | null> {
  // 后端 /auth/refresh 以 Bearer/Cookie 识别调用方，不读 body 里的 refresh_token；
  // HttpOnly Cookie 会随同源请求自动携带，因此没有存储 refresh_token 也能续期。
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        clearAuthTokens();
        return null;
      }

      const data = await res.json();
      const newAccessToken = data.access_token || data.token;
      const newRefreshToken = data.refresh_token;

      if (newAccessToken) {
        setAuthTokens(newAccessToken, newRefreshToken);
        return newAccessToken;
      } else {
        clearAuthTokens();
        return null;
      }
    } catch {
      clearAuthTokens();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * API 错误：保留 HTTP 状态码。
 * 调用方据此区分 403/404/503（提示"权限不足/不存在/上游不可用"），而不是去解析错误文案。
 * 继承 Error 且 message 与旧实现一致，既有 `err.message` 用法不受影响。
 */

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    // 目标为 ES5 时 Error 子类的原型链会断开，显式接回，保证 instanceof 判断仍可用。
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

// 供 fetchApi 带上 x-locale / Accept-Language：语言从 NEXT_LOCALE cookie 读，
// 拆分前它与 fetchApi 同在一个文件，随请求层一起搬到 core。
function readLocaleCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token = getAccessToken();
  const locale = typeof window !== "undefined" ? readLocaleCookie() : null;
  const headers: Record<string, string> = {
    ...(!(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (locale) {
    if (!headers["x-locale"] && !headers["X-Locale"]) headers["x-locale"] = locale;
    if (!headers["Accept-Language"]) headers["Accept-Language"] = locale;
  }
  const baseUrl = getApiBase();
  let res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  });

  // 处理 401 Unauthorized：静默续期后重试一次（凭 HttpOnly Cookie，无需 refresh_token）。
  const isAuthEndpoint =
    endpoint.startsWith("/auth/login") ||
    endpoint.startsWith("/auth/register") ||
    endpoint.startsWith("/auth/refresh") ||
    endpoint.startsWith("/auth/logout");

  if (res.status === 401 && !isAuthEndpoint && (getRefreshToken() || getAccessToken())) {
    const freshToken = await requestTokenRefresh();
    if (freshToken) {
      headers["Authorization"] = `Bearer ${freshToken}`;
      res = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers,
      });
    }
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Request failed" }));
    throw new ApiError(errorData.error || `HTTP ${res.status}`, res.status);
  }

  return res.json();
}
