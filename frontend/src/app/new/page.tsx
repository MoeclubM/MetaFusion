import { EntityEditor } from "@/components/catalog/EntityEditor";
import { Navbar } from "@/components/Navbar";
import { PageShell } from "@/components/ui/PageShell";

// 编辑器样式统一在 globals.css（与 /catalog/[id] 编辑页共用）；v1 的 catalog/catalog.css
// 已整体删除（写死深色、且与 globals.css 的 .cv-* 同名双定义），本页不再需要任何路由级 CSS。
// 页面容器用 PageShell（原来写死在 .cv-page 的 72rem + 内边距已删除）。
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  // ?kind= 是旧入口的约定（/works/new、/releases/new 的 next.config 重定向、
  // /catalog/new 的跳转、贡献页的四个入口都带着它）；这里必须把它交给编辑器做预选，
  // 否则用户点了"新建发行版本"却看到默认的作品层级。
  const raw = (await searchParams)?.kind;
  const kind = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  // /new 就是统一新建页：一切实体一个入口，层级在编辑器内随时切换。
  // ?kind= 只做预选（枢纽卡片、/works/new 等旧重定向会带）；不带时默认 work。
  const initialKind = kind?.trim() || "work";
  return (
    <>
      <Navbar />
      {/* CatalogProvider 已在 app/layout.tsx 全站挂载，这里不再重复挂。 */}
      <PageShell width="page" spacing="none">
        <EntityEditor initialKind={initialKind} />
      </PageShell>
    </>
  );
}
