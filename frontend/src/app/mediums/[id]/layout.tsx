import type { Metadata } from "next";
import { entityMetadata } from "@/lib/seo";

// 载体详情页的页面级 metadata / OG。
// 只加 metadata：页面本身仍是客户端组件（SSR 骨架化不在本次范围）。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return entityMetadata(id, "/mediums");
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
