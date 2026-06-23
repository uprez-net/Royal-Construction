import { getTradieByIdCached } from "@/lib/data/tradie-management";
import { Loader2 } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

interface TradieDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

async function TradieDetailContent({ params }: TradieDetailPageProps) {
  const { id } = await params;
  const tradieDetails = await getTradieByIdCached(id);

  if (!tradieDetails) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {JSON.stringify(tradieDetails, null, 2)}
    </div>
  );
}

export default function TradieDetailPage({ params }: TradieDetailPageProps) {
  return (
    <Suspense
      fallback={<Loader2 className="animate-spin text-blue-500 size-14" />}
    >
      <TradieDetailContent params={params} />
    </Suspense>
  );
}
