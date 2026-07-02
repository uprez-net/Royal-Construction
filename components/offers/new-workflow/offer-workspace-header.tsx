"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  OFFER_STATUS_LABEL,
  type OfferWorkspaceJob,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import {
  activeOfferPhase,
  offerPhaseIndex,
  type OfferWorkflowPhase,
} from "@/lib/offer/workflow";
import { cn } from "@/lib/utils";
import { Check, Download, Send } from "lucide-react";
import { formatCurrency } from "./offer-workspace-format";

// The workflow runs across three phases — Offer, Tender, Contract — then the
// signed Contract is handed off to Project. See CONTEXT.md and ADR 0001.
// Phase order + status→phase mapping live in @/lib/offer/workflow.
const WORKFLOW_PHASES: readonly {
  readonly id: OfferWorkflowPhase;
  readonly label: string;
}[] = [
  { id: "offer", label: "Offer" },
  { id: "tender", label: "Tender" },
  { id: "contract", label: "Contract" },
  { id: "handoff", label: "Handoff" },
];

const WORKFLOW_STEPS: readonly {
  readonly label: string;
  readonly phase: OfferWorkflowPhase;
  readonly target: string | null;
}[] = [
  { label: "Job setup", phase: "offer", target: "offer-step-job-setup" },
  { label: "Cost schedule", phase: "offer", target: "offer-step-cost-schedule" },
  { label: "Pricing", phase: "offer", target: "offer-step-pricing" },
  { label: "Scope", phase: "offer", target: "offer-step-scope" },
  { label: "Offer document", phase: "offer", target: "offer-step-offer-document" },
  { label: "Send & negotiate", phase: "offer", target: "offer-step-send" },
  { label: "Tender", phase: "tender", target: "offer-step-tender" },
  { label: "Contract", phase: "contract", target: "offer-step-contract" },
  { label: "Project", phase: "handoff", target: "offer-step-project" },
];

// Current node label per status; the active phase comes from activeOfferPhase.
function currentStepLabel(status: OfferWorkspaceStatus): string {
  switch (status) {
    case "sent":
      return "Send & negotiate";
    case "agreed":
    case "tender_draft":
    case "tender_sent":
    case "tender_signed":
      return "Tender";
    case "contract_draft":
    case "contract_sent":
    case "contract_signed":
      return "Contract";
    case "project":
      return "Project";
    case "pending":
    default:
      return "Job setup";
  }
}

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
    <section className="rounded-lg border border-border/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-royal-gold text-white">
              {job.reference}-{job.revision}
            </Badge>
            <Badge variant="secondary">{OFFER_STATUS_LABEL[status]}</Badge>
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
            Download offer
          </Button>
          <Button
            className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
            disabled={customerPrice.needsOverrideReason || status !== "pending"}
            title={
              customerPrice.needsOverrideReason
                ? "Add an override reason before marking the Offer document sent."
                : undefined
            }
            type="button"
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

function getScrollableAncestor(node: HTMLElement): HTMLElement {
  let el = node.parentElement;
  while (el) {
    const overflowY = getComputedStyle(el).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.body;
}

function scrollToWorkflowStep(target: string) {
  const el = document.getElementById(target);
  if (!el) {
    return;
  }
  const scroller = getScrollableAncestor(el);
  const scrollerTop = scroller.getBoundingClientRect().top;

  // Clear the sticky header + stepper that stay pinned at the scroller's top.
  // Measure the chrome's bottom relative to the scroller so the offset stays
  // correct across the scroller's own padding and responsive header heights.
  const stickyHeader = document.querySelector<HTMLElement>(
    "[data-offer-sticky-header]",
  );
  const chromeBottom = stickyHeader
    ? stickyHeader.getBoundingClientRect().bottom - scrollerTop
    : 128;
  const offset = chromeBottom + 12;
  const top =
    el.getBoundingClientRect().top - scrollerTop + scroller.scrollTop - offset;
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const nextTop = Math.max(0, top);

  if (prefersReducedMotion) {
    scroller.scrollTop = nextTop;
  } else {
    scroller.scrollTo({ top: nextTop, behavior: "smooth" });
  }
}

export function OfferWorkflowSteps({
  status,
}: {
  readonly status: OfferWorkspaceStatus;
}) {
  const currentLabel = currentStepLabel(status);
  const activeIndex = offerPhaseIndex(activeOfferPhase(status));
  const currentIndex = WORKFLOW_STEPS.findIndex(
    (step) => step.label === currentLabel,
  );

  return (
    <nav
      aria-label="Offer workflow stages"
      className="max-w-full overflow-x-auto rounded-lg border border-border/70 bg-white/95 px-4 py-3 shadow-sm"
    >
      {/* Phase bands: Offer / Tender / Contract, with Project set apart as handoff */}
      <ol aria-hidden="true" className="flex min-w-[920px]">
        {WORKFLOW_PHASES.map((phase) => {
          const count = WORKFLOW_STEPS.filter(
            (step) => step.phase === phase.id,
          ).length;
          const reached = offerPhaseIndex(phase.id) <= activeIndex;
          const isHandoff = phase.id === "handoff";

          return (
            <li
              key={phase.id}
              style={{ flexGrow: count }}
              className="min-w-0 basis-0 px-1"
            >
              <div
                className={cn(
                  "border-b-2 pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors",
                  isHandoff
                    ? "border-dashed border-muted-foreground/35 text-muted-foreground/70"
                    : reached
                      ? "border-royal-gold/70 text-royal-gold-dark"
                      : "border-border text-muted-foreground",
                )}
              >
                {phase.label}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Node rail */}
      <ol className="flex min-w-[920px] pt-3">
        {WORKFLOW_STEPS.map((step, index) => {
          const isFirst = index === 0;
          const isLast = index === WORKFLOW_STEPS.length - 1;
          const nodePhaseIndex = offerPhaseIndex(step.phase);
          const isCurrent = step.label === currentLabel;
          const isComplete =
            !isCurrent &&
            (nodePhaseIndex < activeIndex ||
              (nodePhaseIndex === activeIndex && index < currentIndex));
          const isAvailable =
            nodePhaseIndex === activeIndex && !isCurrent && !isComplete;
          const isLocked = nodePhaseIndex > activeIndex;
          const isReached = nodePhaseIndex <= activeIndex;
          const isNavigable = step.target !== null;
          const leftDashed = step.phase === "handoff";
          const rightDashed = WORKFLOW_STEPS[index + 1]?.phase === "handoff";
          const connectorClass = isReached
            ? "bg-royal-gold/60"
            : "bg-muted-foreground/35";

          const stepContent = (
            <>
              <div className="relative flex h-9 w-full items-center justify-center">
                {!isFirst ? (
                  leftDashed ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 right-1/2 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-muted-foreground/40"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute left-0 right-1/2 top-1/2 h-1 -translate-y-1/2",
                        connectorClass,
                      )}
                    />
                  )
                ) : null}
                {!isLast ? (
                  rightDashed ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 right-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-muted-foreground/40"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute left-1/2 right-0 top-1/2 h-1 -translate-y-1/2",
                        connectorClass,
                      )}
                    />
                  )
                ) : null}
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "relative z-10 flex size-8 items-center justify-center rounded-full font-mono text-xs font-medium transition-shadow",
                    isComplete
                      ? "border-2 border-royal-gold bg-royal-gold text-white"
                      : "bg-background",
                    isCurrent
                      ? "border-2 border-royal-gold text-royal-gold-dark shadow-[0_0_0_6px_var(--royal-gold-light)]"
                      : isAvailable
                        ? "border border-royal-gold/50 text-foreground group-hover:border-royal-gold group-hover:shadow-[0_0_0_5px_var(--royal-gold-light)]"
                        : isLocked
                          ? "border border-dashed border-muted-foreground/40 text-muted-foreground"
                          : "",
                  )}
                >
                  {isComplete ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : isCurrent ? (
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
                  ) : (
                    index + 1
                  )}
                </span>
              </div>
              <span
                className={cn(
                  "mt-2 text-center text-sm transition-colors group-hover:text-royal-gold-dark",
                  isCurrent
                    ? "font-semibold text-foreground"
                    : isLocked
                      ? "text-muted-foreground"
                      : "font-medium text-foreground",
                )}
              >
                {step.label}
              </span>
            </>
          );

          return (
            <li
              key={step.label}
              className="relative flex flex-1 flex-col items-center"
            >
              {isNavigable ? (
                <button
                  type="button"
                  aria-label={`Jump to ${step.label}`}
                  onClick={() => scrollToWorkflowStep(step.target as string)}
                  className="group flex w-full cursor-pointer flex-col items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
                >
                  {stepContent}
                </button>
              ) : (
                <div className="flex w-full flex-col items-center">
                  {stepContent}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
