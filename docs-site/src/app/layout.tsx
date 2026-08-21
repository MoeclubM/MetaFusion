import type { Metadata } from "next";
import "./globals.css";
import { DocsShell } from "@/components/DocsShell";
import { getNavGroups } from "@/lib/docs";

export const metadata: Metadata = {
  title: { default: "MetaFusion 文档", template: "%s — MetaFusion 文档" },
  description: "MetaFusion 开放典藏平台的理念、编辑指南、API 与协议文档。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const groups = getNavGroups();
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="font-sans min-h-screen bg-background antialiased">
        {/* theme bootstrapping */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('mf-docs-theme');var d=s? s==='dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})()`,
          }}
        />
        <DocsShell groups={groups}>{children}</DocsShell>
      </body>
    </html>
  );
}
