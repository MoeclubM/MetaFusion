import { EntityEditor } from "@/components/catalog-v2/EntityEditor";
import { CatalogProvider } from "@/components/catalog-v2/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import "../catalog/catalog.css";

export default function Page() {
  return (
    <>
      <Navbar />
      <CatalogProvider>
        <EntityEditor />
      </CatalogProvider>
    </>
  );
}
