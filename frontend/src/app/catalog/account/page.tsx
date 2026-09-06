import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  if (return_to) {
    redirect(`/account?return_to=${encodeURIComponent(return_to)}`);
  }
  redirect("/account");
}
