import { notFound } from "next/navigation";
import { NewOfferWorkspace } from "@/components/offers/new-workflow/new-offer-workspace";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Offer Workflow",
  description: "Excel-style Offer costing workspace for Royal Constructions.",
};

export default async function LeadNewOfferWorkflowPage({
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
