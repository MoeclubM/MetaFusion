import type { MetadataRoute } from "next";

// 站点公开入口（网关只发布这一个域名，与后端/编排的 issuer 默认值同源）；
// sitemap 的 url 必须是绝对地址。
const SITE_ORIGIN = "https://findverse.cc";

// 只列公开且稳定 200 的静态路径，四类不列：
//   * 受登录保护的 /admin、/account、/settings、/developer、/new、/contribute、/invites
//     （AuthGate.PROTECTED_PREFIXES）；
//   * 服务端 307 的 /about 与 /catalog/*（旧路径兜底跳转）；
//   * 无参数不成页的 /compare 与各实体详情页（内容全靠客户端取数）；
//   * /login、/setup 与只做客户端外跳的 /developers，没有可收录内容。
const PUBLIC_PATHS = ["/", "/landing", "/explore", "/community", "/downloads"];

// 构建期求值一次、只产出静态 /sitemap.xml：不查目录服务，也不发任何网络请求。
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: `${SITE_ORIGIN}${path}` }));
}
