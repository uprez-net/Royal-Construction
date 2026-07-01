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
  { label: "Job setup", phase: "offer", state: "current" },
  { label: "Cost schedule", phase: "offer", state: "available" },
  { label: "Pricing", phase: "offer", state: "available" },
  { label: "Scope", phase: "offer", state: "available" },
  { label: "Offer document", phase: "offer", state: "available" },
  { label: "Tender", phase: "downstream", state: "locked" },
  { label: "Handoff", phase: "downstream", state: "locked" },
  { label: "Project", phase: "downstream", state: "locked" },
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
          <h1
            id="new-offer-workspace-title"
            className="mt-2 font-heading text-2xl font-semibold"
          >
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
            <Download className="size-4" aria-hidden="true" />
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
            <Send className="size-4" aria-hidden="true" />
            Mark sent
          </Button>
        </div>
      </div>
    </section>
  );
}

export function OfferWorkflowSteps() {
  return (
    <nav
      aria-label="Offer workflow stages"
      className="max-w-full overflow-hidden rounded-lg border border-border/70 bg-white/95 px-4 py-3 shadow-sm"
    >
      <ol className="flex min-w-[920px] overflow-x-auto">
        {WORKFLOW_STEPS.map((step, index) => {
          const isFirst = index === 0;
          const isLast = index === WORKFLOW_STEPS.length - 1;
          const isCurrent = step.state === "current";
          const isAvailableOffer = step.state === "available";
          const isLocked = step.state === "locked";

          return (
            <li key={step.label} className="relative flex flex-1 flex-col items-center">
              <div className="relative flex h-9 w-full items-center justify-center">
                {!isFirst ? (
                  <span
                    aria-hidden="true"
                    className={
                      step.phase === "offer"
                        ? "absolute left-0 right-1/2 top-1/2 h-1 -translate-y-1/2 bg-royal-gold/60"
                        : "absolute left-0 right-1/2 top-1/2 h-1 -translate-y-1/2 bg-muted-foreground/35"
                    }
                  />
                ) : null}
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={
                      step.phase === "offer"
                        ? "absolute left-1/2 right-0 top-1/2 h-1 -translate-y-1/2 bg-royal-gold/60"
                        : "absolute left-1/2 right-0 top-1/2 h-1 -translate-y-1/2 bg-muted-foreground/35"
                    }
                  />
                ) : null}
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={
                    isCurrent
                      ? "relative z-10 flex size-8 items-center justify-center rounded-full border-2 border-royal-gold bg-background shadow-[0_0_0_8px_var(--royal-gold-light)]"
                      : isAvailableOffer
                        ? "relative z-10 flex size-7 items-center justify-center rounded-full border border-royal-gold/50 bg-background font-mono text-xs font-medium text-foreground"
                        : "relative z-10 flex size-3 items-center justify-center rounded-full bg-background ring-2 ring-muted-foreground/40"
                  }
                >
                  {isCurrent ? (
                    <>
                      <span
                        className="absolute size-5 rounded-full bg-royal-gold/35 motion-safe:animate-ping"
                        aria-hidden="true"
                      />
                      <span
                        className="relative size-2.5 rounded-full bg-royal-gold"
                        aria-hidden="true"
                      />
                    </>
                  ) : isAvailableOffer ? (
                    index + 1
                  ) : (
                    <span className="sr-only">{index + 1}</span>
                  )}
                </span>
              </div>
              <span
                className={
                  isCurrent
                    ? "mt-2 text-center text-sm font-semibold text-foreground"
                    : isLocked
                      ? "mt-2 text-center text-sm text-muted-foreground"
                      : "mt-2 text-center text-sm font-medium text-foreground"
                }
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
