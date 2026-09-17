// 导入来源的展示解析：GET /importer/sources 的条目 → 显示名与图标。
//
// 来源的**可用性**由后端的适配器集合决定，名称/图标来自 external databases 注册表
// （后台改名、换图标即时生效），前端不维护第二份名单。导入弹窗的来源 tab 与编目枢纽的
// 来源徽标共用这一份解析：同一个库不会在两个界面显示成两个名字或两个图标。
import { authorityIcon } from "./authorityIcons";
import { pickLocalizedName, type ImporterSource } from "./api";

/** 来源 id → 字典键后缀（bangumi → Bangumi，official_website → OfficialWebsite）。 */
export function importerSourceKeySuffix(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** 来源显示名：优先复用既有 importer.source* 四语文案，缺键时用注册表里的名称。 */
export function importerSourceLabel(
  tr: (key: string, fallback: string) => string,
  locale: string,
  source: Pick<ImporterSource, "id" | "names">,
): string {
  return tr(
    `importer.source${importerSourceKeySuffix(source.id)}`,
    pickLocalizedName(locale, source.names, source.id),
  );
}

/** 来源图标：注册表的 icon 码，未知码由 authorityIcon 回落到 Globe。 */
export function importerSourceIcon(source: Pick<ImporterSource, "icon">): any {
  return authorityIcon(source.icon);
}
