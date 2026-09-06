import { CatalogProvider } from "@/components/catalog-v2/CatalogProvider";
import "./catalog.css";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <CatalogProvider>{children}</CatalogProvider>;
}
