import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { LeadDetailScreen } from "@/components/leads/detail/lead-detail-screen";
import { getLeadForPage } from "@/lib/data/leads";

import LeadDetailLoading from "./loading";

/** Lead ids are auto-increment integers; anything else is not a lead. */
function parseLeadId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const leadId = parseLeadId(id);
  const lead = leadId === null ? null : await getLeadForPage(leadId);

  if (lead) {
    return {
      title: `${lead.name} — Lead`,
      description: `Lead details for ${lead.name}${lead.location ? `, ${lead.location}` : ""}.`,
    };
  }

  return {
    title: "Lead not found",
    description: "The requested lead could not be found.",
  };
}

async function LeadDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const leadId = parseLeadId(id);

  if (leadId === null) {
    notFound();
  }

  const lead = await getLeadForPage(leadId);

  if (!lead) {
    notFound();
  }

  return <LeadDetailScreen lead={lead} />;
}

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<LeadDetailLoading />}>
      <LeadDetailContent params={params} />
    </Suspense>
  );
}
