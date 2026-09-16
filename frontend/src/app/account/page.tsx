import { Account } from "@/components/catalog/CatalogPages";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import { PageShell } from "@/components/ui/PageShell";
import "../catalog/catalog.css";

export default function Page() {
  return (
    <>
      <Navbar />
      <CatalogProvider>
        {/* 容器宽度与内边距走 PageShell；.catalog-root 只保留旧表单样式作用域。 */}
        <PageShell width="page" spacing="none">
          <div className="catalog-root">
            <Account />
          </div>
        </PageShell>
      </CatalogProvider>
    </>
  );
}
