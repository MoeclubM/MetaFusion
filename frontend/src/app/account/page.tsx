import { Account } from "@/components/catalog-v2/CatalogPages";
import { CatalogProvider } from "@/components/catalog-v2/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import "../catalog/catalog.css";

export default function Page() {
  return (
    <>
      <Navbar />
      <CatalogProvider>
        <div className="catalog-v2 cv-main">
          <Account />
        </div>
      </CatalogProvider>
    </>
  );
}
