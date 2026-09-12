import { EntityEditor } from "@/components/catalog/EntityEditor";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { Navbar } from "@/components/Navbar";

// 不再引入 catalog/catalog.css：那套 .catalog-root 表单覆盖会以更高优先级
// 盖掉 globals.css 的 cv-* 编辑器样式，造成编辑与新建两页样式分裂。
// 编辑器样式统一在 globals.css（与 /catalog/[id] 编辑页共用）。
export default function Page() {
  return (
    <>
      <Navbar />
      <CatalogProvider>
        <div className="cv-page">
          <EntityEditor />
        </div>
      </CatalogProvider>
    </>
  );
}
