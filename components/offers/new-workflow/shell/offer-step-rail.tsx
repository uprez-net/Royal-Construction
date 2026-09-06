"use client";

// The persistent step rail.
//
// It replaces a ten-node horizontal stepper that was `aria-hidden`, conveyed
// complete/locked/available by colour alone, and let a keyboard user tab to a
// locked step and hear "Jump to Contract". Every row here is a real button with
// its state in the accessible name, and carries a one-line digest so the rail
// answers "what does this step say?" without opening it.

import { Check, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OfferStepId } from "@/lib/offer/step-digests";
import {
  OFFER_WORKFLOW_PHASES,
  OFFER_WORKFLOW_STEPS,
} from "@/lib/offer/workflow-steps";

export type OfferStepState = "complete" | "incomplete" | "locked";

type OfferStepRailProps = {
  readonly activeStepId: OfferStepId;
  readonly collapsed: boolean;
  readonly digests: Readonly<Record<OfferStepId, string>>;
  readonly stepStates: Readonly<Record<OfferStepId, OfferStepState>>;
  readonly onSelect: (stepId: OfferStepId) => void;
  readonly onToggleCollapsed: () => void;
};

export function OfferStepRail({
  activeStepId,
  collapsed,
  digests,
  stepStates,
  onSelect,
  onToggleCollapsed,
}: OfferStepRailProps) {
  return (
    <nav
      aria-label="Offer workflow"
      className={cn(
        "flex shrink-0 flex-col border-r border-border/70 bg-white/60 transition-[width]",
        // Icon-only below lg regardless of the toggle: a 240px rail against a
        // ~600px pane on a small laptop was a quarter of the width on nav.
        collapsed ? "w-14" : "w-14 lg:w-60",
      )}
    >
      <ol className="flex-1 overflow-y-auto py-2">
        {OFFER_WORKFLOW_PHASES.map((phase) => {
          const steps = OFFER_WORKFLOW_STEPS.filter((s) => s.phase === phase.id);
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
                  <p className="hidden px-4 pb-1 pt-3 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80 lg:block">
                    {phase.label}
                  </p>
                </>
              )}
              <ol>
                {steps.map((step) => (
                  <li key={step.id}>
                    <RailRow
                      active={step.id === activeStepId}
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
        className="flex items-center gap-2 border-t border-border/70 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        {collapsed ? (
          <ChevronRight className="size-4" aria-hidden="true" />
        ) : (
          <>
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span className="hidden lg:inline">Collapse</span>
          </>
        )}
      </button>
    </nav>
  );
}

function RailRow({
  active,
  collapsed,
  digest,
  index,
  label,
  state,
  onSelect,
}: {
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly digest: string;
  readonly index: number;
  readonly label: string;
  readonly state: OfferStepState;
  readonly onSelect: () => void;
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
        "flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
        active ? "bg-royal-gold-light/70" : "hover:bg-muted/50",
        locked && !active && "opacity-60",
      )}
    >
      <StepGlyph active={active} index={index} state={state} />
      {collapsed ? null : (
        <span aria-hidden="true" className="hidden min-w-0 flex-1 lg:block">
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
      <span aria-hidden="true" className={cn(base, "bg-royal-gold text-white")}>
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
        className={cn(base, "bg-muted text-muted-foreground/70")}
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
