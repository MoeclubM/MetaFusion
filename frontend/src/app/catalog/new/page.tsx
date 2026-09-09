import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  if (kind) {
    redirect(`/new?kind=${encodeURIComponent(kind)}`);
  }
  redirect("/new");
}
