/**
 * 详情路由收敛：work / release / medium 有专用正式路由，其余 kind 只有通用兜底 /catalog/[id]。
 * 服务端页面与客户端兜底共用这一份判定，避免两边各写一套名单。
 *
 * 只认固定八种骨架里的这三种 kind，不复用 catalogEntityHref：后者对未知 code 回退到 work，
 * 动态类型码会被它误送去 /works。
 */
export function formalDetailPath(
  kind: string | null | undefined,
  id: string | null | undefined,
): string | null {
  if (!kind || !id) return null;
  switch (kind) {
    case "work":
      return `/works/${id}`;
    case "release":
      return `/releases/${id}`;
    case "medium":
      return `/mediums/${id}`;
    default:
      return null;
  }
}

/** 收敛目标 = 正式路由 + 原样保留的查询串；没有正式路由时返回 null（保持通用视图）。 */
export function formalDetailUrl(
  kind: string | null | undefined,
  id: string | null | undefined,
  query = "",
): string | null {
  const path = formalDetailPath(kind, id);
  if (!path) return null;
  const qs = query.replace(/^\?/, "");
  return qs ? `${path}?${qs}` : path;
}

/**
 * ?edit=1 是实体编辑器的唯一入口，而编辑器只挂在通用详情视图上。这个参数决定两件事：
 * 详情路由不收敛到正式路由（keepsGenericView），以及登录闸门把它当受保护目标
 * （components/AuthGate.tsx：未登录先跳 /login 并带回完整目标，与 /new 同一套规则）。
 */
export function isEditEntry(query = ""): boolean {
  return new URLSearchParams(query).get("edit") === "1";
}

/** 收敛到正式路由会连编辑入口一起丢掉，所以带 ?edit=1 时保持通用视图。 */
export function keepsGenericView(query = ""): boolean {
  return isEditEntry(query);
}
