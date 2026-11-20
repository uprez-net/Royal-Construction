import { TradieDetailClient } from "@/components/tradie-management/details/tradie-detail-client";
import { getTradieByIdCached } from "@/lib/data/tradie-management";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Metadata } from "next";
import TradieDetailsSkeleton from "./loading";
import { currentPrincipal } from "@/lib/data/current-principal";
import { canSeeProjectFinancials } from "@/lib/domain/access/projects";
import { withoutTradieQuotes } from "@/lib/domain/projects/financial-redaction";

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
    ]
      .filter(Boolean)
      .join(" "),
  };
}

async function TradieDetailContent({ params }: TradieDetailPageProps) {
  const { id } = await params;
  const [tradieDetails, principal] = await Promise.all([
    getTradieByIdCached(id),
    currentPrincipal(),
  ]);

  if (!tradieDetails) {
    notFound();
  }

  // The activity history spells out quotes and invoices; `listTradieActivity`
  // refuses anyone who may not see project money, so the card is not drawn.
  // The tradie's own price goes the same way (`withoutTradieQuotes`). A copy,
  // never the cached object: the cache is shared by every viewer.
  const seesMoney = canSeeProjectFinancials(principal);
  return (
    <TradieDetailClient
      tradie={seesMoney ? tradieDetails : withoutTradieQuotes(tradieDetails)}
      showActivity={seesMoney}
    />
  );
}

export default function TradieDetailPage({ params }: TradieDetailPageProps) {
  return (
    <Suspense fallback={<TradieDetailsSkeleton />}>
      <TradieDetailContent params={params} />
    </Suspense>
  );
}
