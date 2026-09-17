// 互动服务错误码 → 四语文案键。
//
// 与 lib/catalogErrors.ts 同风格：先查本表，未命中的码交给共享的目录表
// （invalid_payload / forbidden / authentication_required 各服务同码同义，文案已在那边），
// 仍未命中就保留原文——不把没覆盖的码伪装成已解释。
//
// 码表来源：metafusion-community/internal/handler 的 fail() 与 register.go 的 guard/require。
import { catalogErrorKey, localizeCatalogError } from "./catalogErrors";

const CODE_KEYS: Record<string, string> = {
  // 互动服务自身故障：评论写入失败、目录依赖取不到都会回这个码。
  module_error: "community.error.moduleError",
  // /community/entities/:id/* 先按请求身份回查目录，草稿/待审条目对作者与审核者之外
  // 就是 404 not_found（与"条目真的不存在"同码，文案要同时覆盖两种可能）。
  not_found: "community.error.entityNotFound",
};

/** 取错误码对应的文案键；未知码返回 null（调用方回退原文）。 */
export function communityErrorKey(message: string): string | null {
  if (!message) return null;
  // 与目录表同一扫描口径：按冒号分段取第一个已知码，兼容被外层包住的码。
  for (const segment of message.trim().split(":")) {
    const code = segment.trim();
    const key = CODE_KEYS[code] || catalogErrorKey(code);
    if (key) return key;
  }
  return null;
}

/** 把互动服务错误消息本地化：命中码就用人话，未命中保留原文。 */
export function localizeCommunityError(message: string, t: (k: string) => string): string {
  const key = communityErrorKey(message);
  if (!key) return message;
  const text = t(key);
  // 字典缺键时退回目录表/原文，不把文案键本身渲染给用户。
  return text && text !== key ? text : localizeCatalogError(message, t);
}
