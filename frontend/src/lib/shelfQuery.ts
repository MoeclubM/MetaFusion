// 将书架/频道规则（query_tags）转换为 explore 检索参数。
// 链接只携带标签条件而非 shelf 标识，任何用户打开结果一致，且可在探索页继续叠加筛选。
export interface ShelfRuleLike {
  query_tags?: string[] | null;
  require_all_tags?: boolean;
}

export function shelfRuleToExploreHref(rule: ShelfRuleLike): string {
  const params = new URLSearchParams();
  const tags = (rule.query_tags || []).map((t) => t.trim()).filter(Boolean);
  if (tags.length > 0) {
    params.set("tags", tags.join(","));
    params.set("tag_match", rule.require_all_tags ? "all" : "any");
  }
  return params.toString() ? `/explore?${params.toString()}` : "/explore";
}
