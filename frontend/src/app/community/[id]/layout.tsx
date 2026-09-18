import type { Metadata } from "next";
import { topicMetadata } from "@/lib/seo";

// 社区讨论主题的页面级 metadata / OG（互动服务取数，失败回落站点级）。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return topicMetadata(id);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
