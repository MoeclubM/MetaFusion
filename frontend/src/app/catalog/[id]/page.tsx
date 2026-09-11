import { Suspense } from "react";
import { EntityDetailView } from "@/components/catalog/EntityDetailView";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    // EntityDetailView 内使用 useSearchParams（?edit=1 直达编辑），需要 Suspense 边界。
    <Suspense fallback={null}>
      <EntityDetailView id={id} />
    </Suspense>
  );
}
