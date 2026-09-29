/** 八种实体共用同一详情地址；kind 不参与 URL 命名，因此不进出参。 */
export function canonicalDetailPath(id: string | null | undefined): string | null {
  return id ? `/catalog/${id}` : null;
}

/** 详情页唯一受保护的编辑入口。 */
export function isEditEntry(query = ""): boolean {
  return new URLSearchParams(query).get("edit") === "1";
}
