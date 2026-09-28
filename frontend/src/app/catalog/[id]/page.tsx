import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingFallback } from "@/components/common/LoadingFallback";
import { entityMetadata } from "@/lib/seo";
import { EntityDetailView } from "@/components/catalog/EntityDetailView";
import { Entity } from "@/components/catalog/api";
import { fetchApi } from "@/lib/api";
import WorkDetailPage from "@/components/entity/WorkDetailPage";
import ReleaseDetailPage from "@/components/entity/ReleaseDetailPage";
import MediumDetailPage from "@/components/entity/MediumDetailPage";

/** searchParams 是解析后的对象：重建查询串时保留重复键与原始顺序，收敛后查询串不丢。 */
function queryStringOf(query: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      qs.append(key, v);
    }
  }
  return qs.toString();
}

/**
 * 服务端只解析 kind 用来判定路由。任何失败（未登录看不到草稿、上游不可用、超时）
 * 都返回 null，页面照常渲染通用视图，由 EntityDetailView 在客户端按同一规则再判一次。
 */
async function resolveKind(id: string): Promise<string | null> {
  try {
    const entity = await fetchApi<Entity>(`/catalog/entities/${encodeURIComponent(id)}/resolve`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return entity?.kind || null;
  } catch {
    return null;
  }
}

// 兜底路由同样要有页面级 metadata：客户端取数是渲染策略，与 metadata 无关
// （取数失败回落站点级，见 lib/seo.ts；这里不发第二个请求，直接复用同一份取数逻辑）。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return entityMetadata(id, "/catalog");
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = queryStringOf(await searchParams);

  // URL 不承载实体层级；仅内容组件按服务端 kind 选择。编辑器沿用通用详情。
  const kind = new URLSearchParams(query).get("edit") === "1" ? null : await resolveKind(id);
  if (kind === "work") return <WorkDetailPage key={id} />;
  if (kind === "release") return <ReleaseDetailPage key={id} />;
  if (kind === "medium") return <MediumDetailPage key={id} />;

  return (
    // EntityDetailView 内使用 useSearchParams（?edit=1 直达编辑），需要 Suspense 边界。
    // 首帧给同款加载态：fallback={null} 在这条兜底路由上是整屏空白（正式路由都有加载文案）。
    <Suspense fallback={<LoadingFallback />}>
      <EntityDetailView id={id} />
    </Suspense>
  );
}
