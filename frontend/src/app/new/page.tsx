import { EntityEditor } from "@/components/catalog/EntityEditor";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import { PageShell } from "@/components/ui/PageShell";

// 不再引入 catalog/catalog.css：那套 .catalog-root 表单覆盖会以更高优先级
// 盖掉 globals.css 的 cv-* 编辑器样式，造成编辑与新建两页样式分裂。
// 编辑器样式统一在 globals.css（与 /catalog/[id] 编辑页共用）。
// 页面容器用 PageShell（原来写死在 .cv-page 的 72rem + 内边距已删除）。
export default function Page({
  searchParams,
}: {
  searchParams?: { kind?: string | string[] };
}) {
  // ?kind= 是旧入口的约定（/works/new、/releases/new 的 next.config 重定向、
  // /catalog/new 的跳转、贡献页的四个入口都带着它）；这里必须把它交给编辑器做预选，
  // 否则用户点了"新建发行版本"却看到默认的作品层级。
  const raw = searchParams?.kind;
  const kind = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return (
    <>
      <Navbar />
      <CatalogProvider>
        <PageShell width="page" spacing="none">
          <EntityEditor initialKind={kind} />
        </PageShell>
      </CatalogProvider>
    </>
  );
}
