// 实体详情页的页面级 metadata（title / description / OG / twitter:card）。
// 约束：
//   1) 只做 metadata，不改渲染策略（这些页面仍是客户端取数渲染，SSR 骨架化是另一件事）；
//   2) 取数失败/超时一律回落到站点级 metadata，绝不把详情页变成 500；
//   3) 题名走既有 locale 解析 helper（lib/titles.ts 的选取链），不新造回退链。
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { getMessages } from "@/i18n/getMessages";
import { normalizeLocale, parseAcceptLanguage } from "@/i18n/routing";
import { pickRecordEntry } from "./titles";
import { SITE_NAME, absoluteUrl } from "./site";

/** 服务端取数超时：metadata 取不到就回落站点级，不让首字节被上游拖住。 */
const SEO_FETCH_TIMEOUT_MS = 2500;

type TranslationRow = {
  title?: string;
  name?: string;
  summary?: string;
  biography?: string;
  aliases?: string[];
};

type SeoEntity = {
  id?: string;
  kind?: string;
  title?: string;
  original_language?: string;
  translations?: Record<string, TranslationRow>;
  pictures?: { url?: string }[];
  attributes?: Record<string, any>;
};

/**
 * 请求语种：Accept-Language 优先（爬虫与分享预览常带），其次界面语言 Cookie，最后默认。
 * headers()/cookies() 是异步请求 API（Next 15 起返回 Promise，Next 16 不再接受同步取值）：
 * 这里必须 await——原来同步调用在 Next 16 直接抛错，被下面的 catch 静默折成 null，
 * 表现是"metadata 语言悄悄退回默认"，不报错也测不出来。
 */
async function requestLocale(): Promise<string> {
  let accept: string | null = null;
  let cookieLocale: string | null = null;
  try {
    accept = (await headers()).get("accept-language");
  } catch {
    accept = null;
  }
  try {
    cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value ?? null;
  } catch {
    cookieLocale = null;
  }
  return parseAcceptLanguage(accept) || normalizeLocale(cookieLocale);
}

/** 目录服务的服务端基址：与 lib/api/client.ts 同一约定（容器内直连，不经网关、不占用限流预算）。 */
function catalogBase(): string {
  return (process.env.INTERNAL_API_URL || "http://backend:8080/api").replace(/\/$/, "");
}

/**
 * 非目录服务（账号 / 互动）的服务端基址：这些服务不在 INTERNAL_API_URL 之后，
 * 未显式配置 *_INTERNAL_API_URL 时回退到"用请求自身的站点地址走网关"——网关按
 * 前缀把它们分流到对应服务，因此在部署形态下可用；本地开发拿不到就回落站点级
 * metadata（不报错、不 500）。
 */
async function serviceBase(envUrl: string | undefined, fallbackPath: string): Promise<string | null> {
  if (envUrl) return envUrl.replace(/\/$/, "");
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") || "http";
    return `${proto}://${host}${fallbackPath}`;
  } catch {
    return null;
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(SEO_FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 站点级兜底：任何取数失败都回到这里（父级 layout 的 metadata 语义）。 */
function siteFallback(): Metadata {
  return { title: SITE_NAME, description: SITE_NAME };
}

function coverUrl(e: SeoEntity): string | null {
  const raw = e.pictures?.[0]?.url;
  return raw ? absoluteUrl(raw) : null;
}

/** 摘要缺失时的结构化兜底：种类名 + 前几个标签（都能本地化，不留空描述）。 */
function structuredDescription(e: SeoEntity, locale: string): string {
  const messages = getMessages(locale);
  const kindKey = "catalog.kind." + (e.kind || "");
  const kindLabel = e.kind ? messages[kindKey] || e.kind : "";
  const tags = Array.isArray(e.attributes?.tags)
    ? (e.attributes!.tags as any[]).map((v) => String(v)).filter(Boolean).slice(0, 6)
    : [];
  return [kindLabel, tags.map((t: string) => "#" + t).join(" ")].filter(Boolean).join(" · ");
}

function clamp(text: string, max = 300): string {
  const v = text.replace(/\s+/g, " ").trim();
  return v.length > max ? v.slice(0, max - 1) + "…" : v;
}

function build(
  title: string,
  description: string,
  path: string,
  image: string | null,
  type: "article" | "profile",
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      url: absoluteUrl(path),
      title,
      description,
      siteName: SITE_NAME,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/**
 * 目录实体详情页的 metadata。
 * routePrefix 是本次渲染的正式路由（/works、/releases、/mediums、/catalog），
 * 用实体自身 id 收敛（resolve 会跟随合并），这样 canonical 与 OG url 指向规范地址。
 */
export async function entityMetadata(id: string, routePrefix: string): Promise<Metadata> {
  const entity = await getJson<SeoEntity>(
    `${catalogBase()}/catalog/entities/${encodeURIComponent(id)}/resolve`,
  );
  if (!entity) return siteFallback();
  const locale = await requestLocale();
  const { title, body } = pickRecordEntry(
    locale,
    entity.translations,
    entity.title || "",
    "",
    { originalLanguage: entity.original_language },
  );
  const displayTitle = (title || entity.title || "").trim();
  if (!displayTitle) return siteFallback();
  const description = clamp(body || structuredDescription(entity, locale) || displayTitle);
  return build(displayTitle, description, `${routePrefix}/${entity.id || id}`, coverUrl(entity), "article");
}

/** 用户主页的 metadata（账号服务 /users/:id；取不到回落站点级）。 */
export async function userMetadata(id: string): Promise<Metadata> {
  const base = await serviceBase(process.env.AUTH_INTERNAL_API_URL, "/api");
  if (!base) return siteFallback();
  const profile = await getJson<{ user?: { username?: string; display_name?: string } }>(
    `${base}/users/${encodeURIComponent(id)}`,
  );
  const name = (profile?.user?.display_name || profile?.user?.username || "").trim();
  if (!name) return siteFallback();
  const locale = await requestLocale();
  const description = getMessages(locale)["seo.userDescription"] || SITE_NAME;
  return build(name, description, `/users/${id}`, null, "profile");
}

/** 社区讨论主题的 metadata（互动服务 /community/topics/:id）。 */
export async function topicMetadata(id: string): Promise<Metadata> {
  const base = await serviceBase(process.env.COMMUNITY_INTERNAL_API_URL, "/api");
  if (!base) return siteFallback();
  const topic = await getJson<{ title?: string; content?: string; board_code?: string }>(
    `${base}/community/topics/${encodeURIComponent(id)}`,
  );
  const title = (topic?.title || "").trim();
  if (!title) return siteFallback();
  const locale = await requestLocale();
  const description = clamp(
    (topic?.content || "").trim() || getMessages(locale)["seo.topicDescription"] || SITE_NAME,
    200,
  );
  return build(title, description, `/community/${id}`, null, "article");
}
