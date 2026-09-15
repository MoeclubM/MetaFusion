// 账号服务把稳定错误码放在响应体的 error 字段（respond() 统一只给单一 error）。
// 这里把码映射成四语文案：前端只认 auth.error.* 字典，未知码回退到通用提示，
// 绝不把原始 code 抛给用户看。
//
// 同一句人话对应多个码时走别名表，避免为服务端的近义码各写一条文案。

const AUTH_ERROR_ALIASES: Record<string, string> = {
  // 注册撞名：服务端用 username_or_email_taken，历史上还有下面几种写法
  username_taken: "user_already_exists",
  username_or_email_taken: "user_already_exists",
  email_taken: "user_already_exists",
  // 邀请码无效：服务端 consumeInvite 给 invalid_invite_code
  invite_invalid: "invalid_invite_code",
  // 注册关闭：服务端 Register 给 registration_closed
  registration_disabled: "registration_closed",
};

/** 读取响应错误对象上的状态码：只按字段探测，不 import api.ts 的错误类，避免跨模块耦合。 */
export function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * 把账号服务错误码翻译成当前语言的人话；未知码回退到通用请求失败提示。
 * status 只用来兜住"路由不存在/上游不可用"这类没有业务码的情况
 * （例如账号服务尚未部署这些端点时返回的 404 纯文本）。
 */
export function authErrorText(
  code: string | null | undefined,
  t: (key: string) => string,
  status?: number,
  fallbackKey = "auth.requestFailed"
): string {
  if (status === 404 || (status !== undefined && status >= 500)) {
    return t("auth.error.service_unavailable");
  }
  if (status === 429) return t("auth.error.rate_limit_exceeded");
  const raw = (code || "").trim();
  if (!raw) return t(fallbackKey);
  for (const candidate of [raw, AUTH_ERROR_ALIASES[raw]]) {
    if (!candidate) continue;
    const key = `auth.error.${candidate}`;
    const translated = t(key);
    if (translated && translated !== key) return translated;
  }
  return t(fallbackKey);
}
