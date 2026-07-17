"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Completeness / state badge shown on a step header.
export type OfferStepStatus = {
  readonly tone: "complete" | "incomplete" | "neutral";
  readonly label: string;
};

function StepStatusBadge({ status }: { readonly status: OfferStepStatus }) {
  const toneClass =
    status.tone === "complete"
      ? "bg-success-light text-foreground"
      : status.tone === "incomplete"
        ? "bg-warning-light text-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        toneClass,
      )}
    >
      {status.tone === "complete" ? (
        <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
      ) : status.tone === "incomplete" ? (
        <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
      ) : null}
      {status.label}
    </span>
  );
}

type StepHeaderProps = {
  readonly index: number;
  readonly phase: string;
  readonly title: string;
  readonly active: boolean;
  readonly locked?: boolean;
  readonly status?: OfferStepStatus | null;
  readonly open?: boolean;
  readonly onToggle?: () => void;
};

function StepHeader({
  index,
  phase,
  title,
  active,
  locked = false,
  status = null,
  open,
  onToggle,
}: StepHeaderProps) {
  const collapsible = onToggle !== undefined;
  const inner = (
    <>
      {collapsible ? (
        open ? (
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold",
          active
            ? "bg-royal-gold text-white"
            : "border border-dashed border-muted-foreground/40 text-muted-foreground",
        )}
      >
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[10px] font-semibold uppercase tracking-[0.08em]",
            active ? "text-royal-gold-dark" : "text-muted-foreground",
          )}
        >
          {phase} phase
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-lg font-semibold leading-tight text-foreground">
            {title}
          </h2>
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <Lock className="size-3" aria-hidden="true" />
              Issued
            </span>
          ) : null}
        </div>
      </div>
      {status ? <StepStatusBadge status={status} /> : null}
    </>
  );

  if (collapsible) {
    return (
      <button
        aria-expanded={open}
        className="mb-3 flex w-full items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
        onClick={onToggle}
        type="button"
      >
        {inner}
      </button>
    );
  }
  return <div className="mb-3 flex items-center gap-2.5">{inner}</div>;
}

// Explains why the Offer-build steps are frozen and offers the one sanctioned
// way to change an issued offer: cut a new revision. Rendered above step 1 once
// the offer leaves the editable (pending) state.
export function OfferLockBanner({
  onCreateRevision,
  canRevise,
  revising,
  executed = false,
  notice = null,
}: {
  readonly onCreateRevision: () => void;
  readonly canRevise: boolean;
  readonly revising: boolean;
  // An executed contract can't be revised — its terms are binding; a change is
  // a contract variation, not a new revision.
  readonly executed?: boolean;
  // Outcome message from the last revision attempt (e.g. an envelope-void
  // warning, or the executed-contract explanation).
  readonly notice?: string | null;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-royal-gold/30 bg-royal-gold-light/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-start gap-2 text-sm text-foreground">
          <Lock
            className="mt-0.5 size-4 shrink-0 text-royal-gold-dark"
            aria-hidden="true"
          />
          <span className="max-w-prose">
            {executed
              ? "This offer's contract is executed. The terms are locked — a change now is a contract variation, a separate document, not a new revision."
              : "This offer has been issued, so job setup, cost schedule, pricing, scope and the offer document are locked to preserve the issued record. To change any of them, create a new revision."}
          </span>
        </p>
        {executed ? null : (
          <Button
            className="shrink-0"
            disabled={!canRevise || revising}
            onClick={onCreateRevision}
            size="sm"
            type="button"
            variant="outline"
          >
            <GitBranch className="size-4" aria-hidden="true" />
            {revising ? "Creating…" : "Create revision"}
          </Button>
        )}
      </div>
      {notice ? (
        <p className="text-xs font-medium text-foreground/80">{notice}</p>
      ) : null}
    </div>
  );
}

// A labeled, anchored, collapsible group of cards for one Offer-phase step. The
// stepper's node target points at this section's id; the header carries the
// step's completeness/state badge and toggles the body open/closed.
export function OfferStepSection({
  id,
  index,
  phase,
  title,
  locked = false,
  status = null,
  defaultOpen = true,
  children,
}: {
  readonly id: string;
  readonly index: number;
  readonly phase: string;
  readonly title: string;
  readonly locked?: boolean;
  readonly status?: OfferStepStatus | null;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="scroll-mt-[var(--offer-sticky-offset,13rem)]">
      <StepHeader
        active
        index={index}
        phase={phase}
        title={title}
        locked={locked}
        status={status}
        open={open}
        onToggle={() => setOpen((current) => !current)}
      />
      {!open ? null : locked ? (
        // A disabled fieldset natively blocks every descendant control (inputs,
        // selects, textareas, buttons) so the issued record can be read but not
        // edited. Opacity is kept at 100% on fields (this is a record to review,
        // not a temporarily-unavailable form); only action buttons dim.
        <fieldset
          disabled
          className="m-0 min-w-0 space-y-5 border-0 p-0 [&_:disabled]:cursor-default [&_input:disabled]:opacity-100 [&_textarea:disabled]:opacity-100 [&_[data-slot=select-trigger]]:opacity-100 [&_[data-slot=checkbox]]:opacity-100 [&_button:disabled]:opacity-50"
        >
          {children}
        </fieldset>
      ) : (
        <div className="space-y-5">{children}</div>
      )}
    </section>
  );
}

// A later-phase step (Tender / Contract / Project) that stays locked until the
// Offer status reaches it. See @/lib/offer/workflow (isOfferPhaseUnlocked).
export function OfferPhaseGate({
  id,
  index,
  phase,
  title,
  unlocked,
  unlockHint,
  children,
}: {
  readonly id: string;
  readonly index: number;
  readonly phase: string;
  readonly title: string;
  readonly unlocked: boolean;
  readonly unlockHint: string;
  readonly children?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-52">
      <StepHeader active={unlocked} index={index} phase={phase} title={title} />
      {unlocked ? (
        <div className="space-y-5">
          {children ?? (
            <div className="rounded-lg border border-border/70 bg-white/95 px-4 py-6 text-sm text-muted-foreground shadow-sm">
              This phase&apos;s tools arrive with the DocuSign build.
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{unlockHint}</span>
        </div>
      )}
    </section>
  );
}
