import { TradieDetailClient } from "@/components/tradie-management/details/tradie-detail-client";
import { getTradieByIdCached } from "@/lib/data/tradie-management";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Metadata } from "next";
import TradieDetailsSkeleton from "./loading";
import { rateCurrency } from "@/utils/formatters";

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
      title: "Tradie not found",
      description: "The requested tradie could not be found.",
    };
  }

  const rating = tradie.rating
    ? `${Number(tradie.rating).toFixed(1)}/5`
    : "No rating";
  const hourlyRate =
    tradie.hourlyRate != null && !Number.isNaN(Number(tradie.hourlyRate))
      ? rateCurrency.format(Number(tradie.hourlyRate))
      : null;

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
      hourlyRate ? `Hourly rate: ${hourlyRate} per hour.` : null,
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
      fallback={<TradieDetailsSkeleton />}
    >
      <TradieDetailContent params={params} />
    </Suspense>
  );
}
