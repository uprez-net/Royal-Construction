import { TradieDetailClient } from "@/components/tradie-management/details/tradie-detail-client";
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

  return <TradieDetailClient tradie={tradieDetails} />;
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
