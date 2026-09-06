import { CatalogProvider } from "@/components/catalog-v2/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import "./catalog.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <CatalogProvider>{children}</CatalogProvider>
    </>
  );
}
