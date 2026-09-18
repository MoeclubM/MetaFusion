import type { Metadata } from "next";
import { userMetadata } from "@/lib/seo";

// 用户主页的页面级 metadata / OG（账号服务取数，失败回落站点级）。
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  return userMetadata(params.id);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
