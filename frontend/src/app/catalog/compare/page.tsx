import { Compare } from "@/components/catalog-v2/CatalogPages";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  return <Compare ids={ids || ""} />;
}
