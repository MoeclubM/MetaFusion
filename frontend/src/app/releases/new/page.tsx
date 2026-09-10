import { redirect } from "next/navigation";

// 旧轨编辑器已退役：统一重定向到新轨编辑器入口 /new（EntityEditor）。
// 若原链接带了 work_id，则透传给新编辑器；新编辑器不读取该参数，未知查询参数不会报错。
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ work_id?: string }>;
}) {
  const { work_id } = await searchParams;
  redirect(work_id ? `/new?work_id=${encodeURIComponent(work_id)}` : "/new");
}
