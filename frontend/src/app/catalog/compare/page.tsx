import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  if (ids) {
    redirect(`/compare?ids=${encodeURIComponent(ids)}`);
  }
  redirect("/compare");
}
