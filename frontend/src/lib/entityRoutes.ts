/** 八种实体共用同一详情地址；kind 只决定页面内容，不参与 URL 命名。 */
export function canonicalDetailPath(
  _kind: string | null | undefined,
  id: string | null | undefined,
): string | null {
  return id ? `/catalog/${id}` : null;
}

/** 规范详情地址（含原样保留的查询串）。 */
export function canonicalDetailUrl(
  kind: string | null | undefined,
  id: string | null | undefined,
  query = "",
): string | null {
  const path = canonicalDetailPath(kind, id);
  if (!path) return null;
  const qs = query.replace(/^\?/, "");
  return qs ? `${path}?${qs}` : path;
}

/** 详情页唯一受保护的编辑入口。 */
export function isEditEntry(query = ""): boolean {
  return new URLSearchParams(query).get("edit") === "1";
}
