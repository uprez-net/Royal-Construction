"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  OfferWorkspaceJob,
  OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { Download, Send } from "lucide-react";
import { formatCurrency } from "./offer-workspace-format";

const WORKFLOW_STEPS = [
  "Job setup",
  "Cost schedule",
  "Pricing",
  "Scope",
  "Offer document",
  "Tender",
  "Handoff",
  "Project",
] as const;

type OfferWorkspaceHeaderProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly job: OfferWorkspaceJob;
  readonly onDownloadPreview: () => void;
  readonly onMarkSent: () => void;
  readonly status: OfferWorkspaceStatus;
};

export function OfferWorkspaceHeader({
  customerPrice,
  job,
  onDownloadPreview,
  onMarkSent,
  status,
}: OfferWorkspaceHeaderProps) {
  return (
    <section className="sticky top-0 z-20 rounded-lg border border-border/70 bg-white/95 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-royal-gold text-white">
              {job.reference}-{job.revision}
            </Badge>
            <Badge variant="outline">{status === "sent" ? "Sent" : "Pending"}</Badge>
            <Badge variant="secondary">Working draft</Badge>
          </div>
          <h1 className="mt-2 font-heading text-2xl font-semibold">
            New Offer workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            {job.clientNames} · {job.siteAddress}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-lg bg-background px-3 py-2 text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Offer price
            </p>
            <p className="font-mono font-semibold">
              {formatCurrency(customerPrice.selectedContractValueIncGst)}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onDownloadPreview}>
            <Download className="size-4" />
            Download preview
          </Button>
          <Button
            disabled={customerPrice.needsOverrideReason || status === "sent"}
            title={
              customerPrice.needsOverrideReason
                ? "Add an override reason before marking the Offer document sent."
                : undefined
            }
            type="button"
            variant="outline"
            onClick={onMarkSent}
          >
            <Send className="size-4" />
            Mark sent
          </Button>
        </div>
      </div>
    </section>
  );
}

export function OfferWorkflowSteps() {
  return (
    <nav className="hidden self-start rounded-lg border border-border/70 bg-white/95 p-3 shadow-sm xl:block">
      <ol className="space-y-2">
        {WORKFLOW_STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-2 text-sm">
            <span
              className={
                index === 0
                  ? "flex size-5 items-center justify-center rounded-full bg-royal-gold text-white"
                  : index < 5
                    ? "flex size-5 items-center justify-center rounded-full border border-royal-gold/40 bg-royal-gold-light/70 text-foreground"
                    : "flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground"
              }
            >
              {index + 1}
            </span>
            <span className={index < 5 ? "font-medium" : "text-muted-foreground"}>
              {step}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
