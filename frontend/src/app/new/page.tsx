import { redirect } from "next/navigation";
import { EntityEditor } from "@/components/catalog/EntityEditor";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import { PageShell } from "@/components/ui/PageShell";

// 编辑器样式统一在 globals.css（与 /catalog/[id] 编辑页共用）；v1 的 catalog/catalog.css
// 已整体删除（写死深色、且与 globals.css 的 .cv-* 同名双定义），本页不再需要任何路由级 CSS。
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
  // 不带层级的 /new 就是「新建」入口：先落到编目枢纽（/contribute）二选一——
  // 手动编目入库挑一个层级、或走已有的外部权威库导入弹窗。带 ?kind= 说明层级已定
  // （枢纽卡片、/works/new 等旧重定向都会带），直接进编辑器，不再拐回枢纽。
  if (!kind?.trim()) {
    redirect("/contribute");
  }
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
