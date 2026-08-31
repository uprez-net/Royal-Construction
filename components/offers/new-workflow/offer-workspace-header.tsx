"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatOwnerNamesLine,
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
import type { TenderGateStatus } from "@/lib/offer/workspace-persistence";
import { cn } from "@/lib/utils";
import { Check, Download, Loader2 } from "lucide-react";
import { formatCurrency, formatOfferReference } from "./offer-workspace-format";
import { OfferVersionsMenu } from "./offer-workspace-versions";
import type { OfferExpiry } from "@/lib/offer/offer-readiness";
import { UploadButton } from "@/components/common/upload-button";
import { File } from "@prisma/client";

type OfferSaveState = "idle" | "saving" | "saved" | "error";

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
  {
    label: "Cost schedule",
    phase: "offer",
    target: "offer-step-cost-schedule",
  },
  { label: "Pricing", phase: "offer", target: "offer-step-pricing" },
  { label: "Scope", phase: "offer", target: "offer-step-scope" },
  {
    label: "Offer document",
    phase: "offer",
    target: "offer-step-offer-document",
  },
  { label: "Send & negotiate", phase: "offer", target: "offer-step-send" },
  {
    label: "Tender access",
    phase: "tender",
    target: "offer-step-tender-gate",
  },
  { label: "Tender", phase: "tender", target: "offer-step-tender" },
  { label: "Contract", phase: "contract", target: "offer-step-contract" },
  { label: "Project", phase: "handoff", target: "offer-step-project" },
];

// Current node label per status; the active phase comes from activeOfferPhase.
// The Tender access gate sits between Send & negotiate and Tender: while the
// offer is AGREED but the gate is unresolved, the active node is "Tender
// access"; once the gate unlocks (or the offer moves to tender_draft+) it
// becomes "Tender".
function currentStepLabel(
  status: OfferWorkspaceStatus,
  tenderGateStatus: TenderGateStatus,
): string {
  switch (status) {
    case "sent":
    // Offer-acceptance signing (ADR 0004) is still the Send & negotiate step.
    case "offer_sent":
    case "offer_signed":
    case "offer_declined":
      return "Send & negotiate";
    case "agreed":
      return tenderGateStatus === "unlocked" ? "Tender" : "Tender access";
    case "tender_draft":
    case "tender_sent":
    case "tender_declined":
      return "Tender";
    case "tender_signed":
    case "contract_draft":
    case "contract_sent":
    case "contract_declined":
      return "Contract";
    case "contract_signed":
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
  readonly leadId?: number;
  readonly offerExpiry: OfferExpiry | null;
  readonly saveState: OfferSaveState;
  readonly onDownloadPreview: () => void;
  readonly status: OfferWorkspaceStatus;
};

export function OfferWorkspaceHeader({
  customerPrice,
  job,
  leadId,
  offerExpiry,
  saveState,
  onDownloadPreview,
  status,
}: OfferWorkspaceHeaderProps) {
  const activeRevisionNumber =
    Number.parseInt(job.revision.replace(/\D/g, ""), 10) || 1;
  return (
    <section className="rounded-lg border border-border/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-royal-gold text-white">
              {formatOfferReference(job.reference, job.revision)}
            </Badge>
            <Badge variant="secondary">{OFFER_STATUS_LABEL[status]}</Badge>
            {status === "pending" && (
              <Badge variant="secondary">Working draft</Badge>
            )}
            <ExpiryChip expiry={offerExpiry} />
          </div>
          <h1
            id="new-offer-workspace-title"
            className="mt-2 font-heading text-2xl font-semibold"
          >
            New Offer workspace
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {/* Name every owner, not just the primary — the documents list them
                all, so the workspace chrome shouldn't imply a single client
                (PR #124 sweep). */}
            <p className="text-sm text-muted-foreground">
              {formatOwnerNamesLine(job.owners ?? []) || job.clientNames} ·{" "}
              {job.siteAddress}
            </p>
            <SaveIndicator state={saveState} />
          </div>
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
          <UploadButton
            leadId={leadId?.toString()}
            maxFiles={5}
            accept=".pdf,.doc,.docx,.xls,.xlsx, image/*"
            onUpload={(files: File[]) => {
              // Handle the uploaded files here
              console.log("Uploaded files:", files);
            }}
          />
          <Button type="button" variant="outline" onClick={onDownloadPreview}>
            <Download className="size-4" aria-hidden="true" />
            Download offer
          </Button>
          {leadId !== undefined ? (
            <OfferVersionsMenu
              leadId={leadId}
              activeRevisionNumber={activeRevisionNumber}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

// Offer-validity chip. Silent until a date is set; escalates muted → warning →
// destructive as the fixed price approaches and passes its validity date, so an
// expired offer can never be emailed unnoticed.
function ExpiryChip({ expiry }: { readonly expiry: OfferExpiry | null }) {
  if (!expiry || expiry.state === "none") {
    return null;
  }
  const toneClass =
    expiry.state === "expired"
      ? "border-destructive/30 bg-destructive-light text-destructive"
      : expiry.state === "soon"
        ? "border-warning/40 bg-warning-light text-foreground"
        : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-medium",
        toneClass,
      )}
    >
      {expiry.label}
    </span>
  );
}

// Autosave chrome: makes the debounced persistence legible and flags a failed
// save instead of leaving the operator to assume their edits are safe.
function SaveIndicator({ state }: { readonly state: OfferSaveState }) {
  if (state === "idle") {
    return null;
  }
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="size-3" aria-hidden="true" />
        Saved
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-destructive" role="status">
      Save failed — your last edits may not be stored. Keep this tab open.
    </span>
  );
}

// Jump to a step's section. Native scrollIntoView honours the section's
// `scroll-mt-52`, which reserves space for the pinned header + stepper, so the
// target always lands just below the sticky chrome — reliable across header
// heights without manual offset math.
// Exported so `open_offer_section` moves the page the same way a click on
// the stepper does, rather than reimplementing the offset behaviour.
export function scrollToWorkflowStep(target: string) {
  const el = document.getElementById(target);
  if (!el) {
    return;
  }
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  el.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
}

export function OfferWorkflowSteps({
  status,
  tenderGateStatus,
}: {
  readonly status: OfferWorkspaceStatus;
  readonly tenderGateStatus: TenderGateStatus;
}) {
  const currentLabel = currentStepLabel(status, tenderGateStatus);
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
      <ol aria-hidden="true" className="flex min-w-230">
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
      <ol className="flex min-w-230 pt-3">
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
