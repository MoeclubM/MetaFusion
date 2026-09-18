import type { Metadata } from "next";
import { entityMetadata } from "@/lib/seo";

// 发行版详情页的页面级 metadata / OG。
// 只加 metadata：页面本身仍是客户端组件（SSR 骨架化不在本次范围）。
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  return entityMetadata(params.id, "/releases");
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
