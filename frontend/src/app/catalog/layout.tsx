import { Navbar } from "@/components/Navbar";

// CatalogProvider 统一挂在 app/layout.tsx（全站一次），本 layout 不再重复挂载——
// 重复挂载会各自发一次 /capabilities 与 /setup，还会让"哪些路由有 modules"重新分叉。
// 本 layout 只包 /catalog/[id] 详情与其 releases 子页（历史 URL 的兜底跳转已整体删除）。
// 这里原来 import 的 catalog/catalog.css 是 v1 表单样式：通篇写死深色（输入框 #0e141e、按钮 #202c3c、
// 主色按钮字色 #102621），浅色模式下与主题冲突，且与 globals.css 的 .cv-* 编辑器样式同名双定义。
// 具体页面（/account）改用 ui/Card + ui/PageShell + 语义令牌类，这份 CSS 已整体删除。
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      {children}
    </>
  );
}
