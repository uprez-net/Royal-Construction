import { TradieDetailClient } from "@/components/tradie-management/details/tradie-detail-client";
import { getTradieByIdCached } from "@/lib/data/tradie-management";
import { Loader2 } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Metadata } from "next";

interface TradieDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({
  params,
}: TradieDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const tradie = await getTradieByIdCached(id);

  if (!tradie) {
    return {
      title: "Tradie Not Found",
      description: "The requested tradie could not be found.",
    };
  }

  const rating = tradie.rating
    ? `${Number(tradie.rating).toFixed(1)}/5`
    : "No rating";

  return {
    title: `${tradie.name} • ${tradie.trade}`,
    description: [
      `${tradie.name} is a ${tradie.trade} tradie`,
      `with ${tradie.jobsCompleted} completed jobs`,
      `${tradie.reviews.length} reviews`,
      `and a rating of ${rating}.`,
      tradie.incidents.length > 0
        ? `${tradie.incidents.length} incident${tradie.incidents.length > 1 ? "s" : ""} recorded.`
        : "No recorded incidents.",
      tradie.hourlyRate ? `Hourly rate: $${tradie.hourlyRate}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
  };
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
