import { Navbar } from "@/components/Navbar";

// CatalogProvider 统一挂在 app/layout.tsx（全站一次），本 layout 不再重复挂载——
// 重复挂载会各自发一次 /capabilities 与 /setup，还会让"哪些路由有 modules"重新分叉。
// /catalog/* 只剩跳转与兜底（page/account/admin/compare/new 都只 redirect，[id] 渲染通用详情视图）。
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
