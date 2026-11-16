"use client";

// The persistent step rail.
//
// It replaces a ten-node horizontal stepper that was `aria-hidden`, conveyed
// complete/locked/available by colour alone, and let a keyboard user tab to a
// locked step and hear "Jump to Contract". Every row here is a real button with
// its state in the accessible name, and carries a one-line digest so the rail
// answers "what does this step say?" without opening it.

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { OfferStepId } from "@/lib/offer/step-digests";
import {
  OFFER_WORKFLOW_PHASES,
  OFFER_WORKFLOW_STEPS,
} from "@/lib/offer/workflow-steps";

export type OfferStepState = "complete" | "incomplete" | "locked";

type OfferStepRailProps = {
  readonly activeStepId: OfferStepId;
  readonly blockedStepId?: OfferStepId | null;
  readonly collapsed: boolean;
  readonly digests: Readonly<Record<OfferStepId, string>>;
  readonly stepStates: Readonly<Record<OfferStepId, OfferStepState>>;
  readonly onSelect: (stepId: OfferStepId) => void;
  readonly onToggleCollapsed: () => void;
};

export function OfferStepRail({
  activeStepId,
  blockedStepId,
  collapsed,
  digests,
  stepStates,
  onSelect,
  onToggleCollapsed,
}: OfferStepRailProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeIndex = OFFER_WORKFLOW_STEPS.findIndex(
    (step) => step.id === activeStepId,
  );
  const activeStep = OFFER_WORKFLOW_STEPS[activeIndex];
  const previousStep =
    activeIndex > 0 ? OFFER_WORKFLOW_STEPS[activeIndex - 1] : undefined;
  const nextStep = OFFER_WORKFLOW_STEPS[activeIndex + 1];
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(
      `[data-step-id="${blockedStepId ?? activeStepId}"]`,
    );
    if (!list || !row) return;
    // Reveal feedback inside the rail without scrolling the page or the pane.
    const bounds = list.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    // Rects include any ancestor transform or zoom; scrollTop uses unscaled
    // layout pixels, so the scale is measured rather than assumed.
    const scale = bounds.height / list.offsetHeight || 1;
    if (rowBounds.top < bounds.top)
      list.scrollTop += (rowBounds.top - bounds.top) / scale;
    else if (rowBounds.bottom > bounds.bottom)
      list.scrollTop += (rowBounds.bottom - bounds.bottom) / scale;
  }, [activeStepId, blockedStepId]);

  return (
    <>
      {/* A phone works the steps in order, so the neighbours are one tap
          away; the sheet is for jumping. They go through onSelect like a rail
          row does, so a locked step opens read-only here too. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/70 bg-background p-1.5 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            previousStep
              ? `Previous step: ${previousStep.label}`
              : "Previous step"
          }
          disabled={!previousStep}
          onClick={() => previousStep && onSelect(previousStep.id)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-w-0 flex-1 justify-between"
          onClick={() => setMobileOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
        >
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">
              {activeIndex + 1}/{OFFER_WORKFLOW_STEPS.length}
            </span>{" "}
            {activeStep?.label}
            <span className="sr-only">, choose a step</span>
          </span>
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={nextStep ? `Next step: ${nextStep.label}` : "Next step"}
          disabled={!nextStep}
          onClick={() => nextStep && onSelect(nextStep.id)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-xl">
          <SheetHeader>
            <SheetTitle>Offer workflow</SheetTitle>
            <SheetDescription>
              Choose a step. Each step shows its progress and current details.
            </SheetDescription>
          </SheetHeader>
          <nav
            aria-label="Offer workflow steps"
            className="min-h-0 overflow-y-auto overscroll-contain pb-4"
          >
            {OFFER_WORKFLOW_PHASES.map((phase) => (
              <div key={phase.id}>
                <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {phase.label}
                </p>
                <ol>
                  {OFFER_WORKFLOW_STEPS.filter(
                    (step) => step.phase === phase.id,
                  ).map((step) => (
                    <li key={step.id}>
                      <RailRow
                        active={step.id === activeStepId}
                        blocked={step.id === blockedStepId}
                        collapsed={false}
                        mobile
                        digest={digests[step.id]}
                        index={OFFER_WORKFLOW_STEPS.indexOf(step) + 1}
                        label={step.label}
                        state={stepStates[step.id]}
                        onSelect={() => {
                          onSelect(step.id);
                          setMobileOpen(false);
                        }}
                      />
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
      <nav
        aria-label="Offer workflow"
        className={cn(
          "hidden shrink-0 flex-col border-r border-border/70 bg-card/60 transition-[width] md:flex",
          // Icon-only below lg regardless of the toggle: a 240px rail against a
          // ~600px pane on a small laptop was a quarter of the width on nav.
          collapsed ? "w-14" : "w-14 lg:w-60",
        )}
      >
        <ol ref={listRef} className="flex-1 overflow-y-auto py-2">
          {OFFER_WORKFLOW_PHASES.map((phase) => {
            const steps = OFFER_WORKFLOW_STEPS.filter(
              (s) => s.phase === phase.id,
            );
            if (steps.length === 0) {
              return null;
            }
            return (
              <li key={phase.id}>
                {collapsed ? (
                  <hr className="mx-3 my-2 border-border/70" />
                ) : (
                  <>
                    <hr className="mx-3 my-2 border-border/70 lg:hidden" />
                    <p className="hidden px-4 pb-1 pt-3 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:block">
                      {phase.label}
                    </p>
                  </>
                )}
                <ol>
                  {steps.map((step) => (
                    <li key={step.id} data-step-id={step.id}>
                      <RailRow
                        active={step.id === activeStepId}
                        blocked={step.id === blockedStepId}
                        collapsed={collapsed}
                        digest={digests[step.id]}
                        index={OFFER_WORKFLOW_STEPS.indexOf(step) + 1}
                        label={step.label}
                        state={stepStates[step.id]}
                        onSelect={() => onSelect(step.id)}
                      />
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand step rail" : "Collapse step rail"}
          aria-expanded={!collapsed}
          // Below lg the rail is icon-only whatever the toggle says, so there the
          // button would change nothing but still sit in the tab order.
          className="hidden items-center gap-2 border-t border-border/70 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 lg:flex"
        >
          {collapsed ? (
            <ChevronRight className="size-4" aria-hidden="true" />
          ) : (
            <>
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </nav>
    </>
  );
}

function RailRow({
  active,
  blocked,
  collapsed,
  digest,
  index,
  label,
  state,
  onSelect,
  mobile = false,
}: {
  readonly active: boolean;
  readonly blocked: boolean;
  readonly collapsed: boolean;
  readonly digest: string;
  readonly index: number;
  readonly label: string;
  readonly state: OfferStepState;
  readonly onSelect: () => void;
  readonly mobile?: boolean;
}) {
  const locked = state === "locked";
  // State goes in the accessible name, not just the colour. A locked step is
  // still selectable — the pane explains why it is locked, which is more useful
  // than a dead control — but it never claims to be available.
  const stateWord =
    state === "complete" ? "complete" : locked ? "locked" : "incomplete";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "step" : undefined}
      aria-label={`Step ${index}, ${label}, ${stateWord}. ${digest}`}
      title={`${label} — ${digest}`}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 px-4 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
        active ? "bg-royal-gold-light/70" : "hover:bg-muted/50",
        blocked && "bg-warning-light",
      )}
    >
      <StepGlyph active={active} index={index} state={state} />
      {collapsed ? null : (
        <span
          aria-hidden="true"
          className={cn("min-w-0 flex-1", mobile ? "block" : "hidden lg:block")}
        >
          <span
            className={cn(
              "block truncate text-sm leading-tight",
              active ? "font-semibold text-foreground" : "font-medium",
            )}
          >
            {label}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {digest}
          </span>
        </span>
      )}
    </button>
  );
}

function StepGlyph({
  active,
  index,
  state,
}: {
  readonly active: boolean;
  readonly index: number;
  readonly state: OfferStepState;
}) {
  const base =
    "grid size-5 shrink-0 place-items-center rounded-full font-mono text-[0.625rem] font-semibold";
  if (active) {
    return (
      <span
        aria-hidden="true"
        className={cn(base, "bg-royal-gold-light text-royal-gold-ink-text")}
      >
        {index}
      </span>
    );
  }
  if (state === "complete") {
    return (
      <span
        aria-hidden="true"
        className={cn(base, "bg-success-light text-success-ink")}
      >
        <Check className="size-3" />
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span
        aria-hidden="true"
        className={cn(base, "bg-muted text-muted-foreground")}
      >
        <Lock className="size-2.5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        base,
        "border border-dashed border-muted-foreground/40 text-muted-foreground",
      )}
    >
      {index}
    </span>
  );
}
