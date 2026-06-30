import { NewOfferWorkspace } from "@/components/offers/new-workflow/new-offer-workspace";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Offer Workflow",
  description: "Excel-style Offer costing workspace for Royal Constructions.",
};

export default function NewOfferWorkflowPage() {
  return <NewOfferWorkspace />;
}
