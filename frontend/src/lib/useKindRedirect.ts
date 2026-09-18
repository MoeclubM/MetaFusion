"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { canonicalDetailUrl } from "./entityRoutes";

/**
 * 专用详情路由的种类守卫。
 *
 * /works/:id、/releases/:id、/mediums/:id 各自隐含一种实体种类，但路由本身不校验：把任意
 * kind 的 id 接到这些路由上，页面会照路由模板渲染出互相矛盾的类型标签（线上实测 14 组
 * 「路由 × 种类」矩阵全部 200，同一个 track id 在 /works、/mediums、/catalog 下分别是
 * 作品、载体、收录位置）。这里复用 lib/entityRoutes 的同一份判定，把不符的访问收敛到
 * 该 kind 的规范路由（work/release/medium 走正式路由，其余回通用兜底 /catalog/[id]）。
 *
 * 判定放在页面自己那次取数之后（而不是服务端 layout / middleware）：那条路要给每次详情
 * 导航再加一跳上游实体查询，而匿名面 entities 的限流预算本来就紧（线上 120/分钟全站共享），
 * 且 Next 的 Link 预取会把这些请求成倍放大。/catalog/[id] 的收敛也是同一口径。
 *
 * 返回值 true 表示正在收敛：调用方必须停在加载态，绝不能按路由模板渲染别的种类。
 * 无死循环：kind 与路由相符时不触发；不符时目标是另一条正式路由或 /catalog/[id]，
 * 而 /catalog/[id] 只对 work/release/medium 再收敛一次（见 app/catalog/[id]/page.tsx）。
 */
export function useKindRedirect(
  requiredKind: string,
  actualKind: string | null | undefined,
  id: string | null | undefined,
): boolean {
  const router = useRouter();
  const target =
    actualKind && id && actualKind !== requiredKind
      ? canonicalDetailUrl(actualKind, id, typeof window === "undefined" ? "" : window.location.search)
      : null;

  useEffect(() => {
    if (!target) return;
    // replace 语义：错误路由不进历史，浏览器后退不会在两条路由之间来回弹。
    router.replace(target);
  }, [target, router]);

  return target !== null;
}

export default useKindRedirect;
