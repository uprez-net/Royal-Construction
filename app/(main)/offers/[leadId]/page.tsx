import { notFound } from "next/navigation";
import { NewOfferWorkspace } from "@/components/offers/new-workflow/new-offer-workspace";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offer Workspace",
  description:
    "Costing, pricing, tender and contract workspace for a lead's building offer.",
};

// The offer experience for a lead IS the new-workflow workspace (ADR 0002).
// The workspace self-provisions its Offer row via loadActiveOfferWorkspace, so
// no offer needs to exist beforehand.
export default async function OfferWorkspacePage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const parsedLeadId = Number(leadId);
  if (!Number.isInteger(parsedLeadId) || parsedLeadId <= 0) {
    notFound();
  }

  return <NewOfferWorkspace leadId={parsedLeadId} />;
}
