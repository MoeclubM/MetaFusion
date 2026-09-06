import { Compare } from "@/components/catalog-v2/CatalogPages";
import { CatalogProvider } from "@/components/catalog-v2/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import "../catalog/catalog.css";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  return (
    <>
      <Navbar />
      <CatalogProvider>
        <Compare ids={ids || ""} />
      </CatalogProvider>
    </>
  );
}
