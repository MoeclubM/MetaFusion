import { redirect } from "next/navigation";

// /developer/apps 不是独立页面：应用管理（接入配置 + 我的应用列表/新建/轮换/删除）本来就在
// /developer 页上，数据取自接口 /api/developer/apps*（见 app/developer/page.tsx 与
// lib/developer.ts 顶部契约说明）——接口路径与页面路由是两回事。
// 这里不复刻第二份实现，只把访问（含查询串）送回 /developer，避免该路径落到 404；
// 未登录时由 AuthGate 按 /developer 前缀接管，跳到 /login?redirect=/developer/apps。
export default async function DeveloperAppsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries((await searchParams) ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (value !== undefined) {
      query.append(key, value);
    }
  }
  const qs = query.toString();
  redirect(qs ? `/developer?${qs}` : "/developer");
}
