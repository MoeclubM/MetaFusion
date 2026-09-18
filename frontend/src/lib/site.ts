// 站点公开身份的唯一来源：站点地图、OG 的绝对地址与 metadataBase 都从这里取，
// 避免同一个域名在多个文件里各写一遍（sitemap.ts 原先自带一份 SITE_ORIGIN）。
// 网关只发布这一个域名，与后端/编排的 issuer 默认值同源。
export const SITE_ORIGIN = "https://findverse.cc";
export const SITE_NAME = "MetaFusion";

/** 相对路径 → 站点绝对地址（OG 的 url/image 必须是绝对地址）。 */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return SITE_ORIGIN + (path.startsWith("/") ? path : "/" + path);
}
