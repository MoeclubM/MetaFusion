import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EntityDetailView } from "@/components/catalog/EntityDetailView";
import { Entity } from "@/components/catalog/api";
import { fetchApi } from "@/lib/api";
import { formalDetailUrl, keepsGenericView } from "@/lib/entityRoutes";

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

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = queryStringOf(await searchParams);

  // 路由收敛：/catalog/[id] 是兜底路由，work/release/medium 一律回到正式路由，
  // 免得同一实体在两条路由上各有一套观感。先取 kind 再跳，客户端不会先闪一次通用视图；
  // redirect 是 replace 语义，浏览器后退不会陷在重定向里。
  // 带 ?edit=1 时例外：编辑器只挂在通用视图上（见 lib/entityRoutes）。
  if (!keepsGenericView(query)) {
    const target = formalDetailUrl(await resolveKind(id), id, query);
    if (target) redirect(target);
  }

  return (
    // EntityDetailView 内使用 useSearchParams（?edit=1 直达编辑），需要 Suspense 边界。
    <Suspense fallback={null}>
      <EntityDetailView id={id} />
    </Suspense>
  );
}
