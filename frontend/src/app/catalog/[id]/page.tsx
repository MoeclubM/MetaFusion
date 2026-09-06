import { Detail } from "@/components/catalog-v2/CatalogPages";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Detail id={id} />;
}
