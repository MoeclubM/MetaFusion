import { redirect } from "next/navigation";

// 旧轨编辑器已退役：统一重定向到新轨编辑器入口 /new（EntityEditor）。
export default function Page() {
  redirect("/new");
}
