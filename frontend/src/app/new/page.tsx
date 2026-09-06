import { EntityEditor } from "@/components/catalog/EntityEditor";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import "../catalog/catalog.css";

export default function Page() {
  return (
    <>
      <Navbar />
      <CatalogProvider>
        <div className="catalog-root cv-main">
          <EntityEditor />
        </div>
      </CatalogProvider>
    </>
  );
}
