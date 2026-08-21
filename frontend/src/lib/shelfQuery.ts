// 将书架/频道规则（media_type + query_tags）转换为 explore 检索参数。
// 链接只携带检索条件而非 shelf 标识，任何用户打开结果一致，且可在探索页继续叠加筛选。
export interface ShelfRuleLike {
  media_type?: string;
  query_tags?: string[] | null;
  require_all_tags?: boolean;
}

export function shelfRuleToExploreHref(rule: ShelfRuleLike): string {
  const params = new URLSearchParams();
  const tags = rule.query_tags || [];
  if (tags.length > 0) {
    params.set("tags", tags.join(","));
    if (rule.require_all_tags) params.set("tag_match", "all");
  }
  const mt = rule.media_type;
  if (mt && mt !== "all") params.set("media_type", mt);
  return params.toString() ? `/explore?${params.toString()}` : "/explore";
}
