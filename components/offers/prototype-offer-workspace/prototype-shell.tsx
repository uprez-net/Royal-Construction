"use client";

// PROTOTYPE — a design surface. Not imported by production code, and the
// /prototype route 404s outside development and staging. Kept while the
// dwellings/duplex model and the offer packages are designed.
//
// The chrome the three variants share: a single-row command bar (the real page
// spends 275px — 34% of a laptop viewport — on a header block plus a ten-node
// stepper) and the phase-grouped step rail that replaces it.

import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  STEPS,
  formatCurrency,
  PRICING,
  type PrototypeJob,
  type PrototypeStep,
} from "./prototype-data";
import { StepGlyph } from "./prototype-shared";

export const VARIANTS = [
  {
    id: "a",
    name: "Focused",
    blurb: "One step on screen. Dwellings in tabs, pricing on the rail.",
  },
  {
    id: "b",
    name: "Document-aware",
    blurb:
      "Fields on the left, the customer's document rendering live beside them.",
  },
  {
    id: "c",
    name: "Comparison",
    blurb:
      "Dwellings side by side, pricing as a bottom strip. The chosen direction.",
    chosen: true,
  },
] as const;

export type VariantId = (typeof VARIANTS)[number]["id"];

// ── Command bar ────────────────────────────────────────────────────────────

export function CommandBar({ job }: { readonly job: PrototypeJob }) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border/70 bg-card px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="rounded-md bg-royal-gold-light px-2 py-0.5 font-mono text-xs font-semibold text-royal-gold-ink-text">
          {job.reference}-{job.revision}
        </span>
        <p className="truncate text-sm font-medium">{job.siteAddress}</p>
        <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground sm:inline">
          {job.status}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="hidden text-right md:block">
          <p className="font-mono text-sm font-semibold leading-none tabular-nums">
            {formatCurrency(PRICING.contractValueIncGst)}
          </p>
          <p className="mt-0.5 text-[0.6875rem] leading-none text-muted-foreground">
            Saved just now
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8">
          <Download className="size-3.5" aria-hidden="true" />
          <span className="hidden lg:inline">Preview</span>
        </Button>
        <Button
          size="sm"
          className="h-8 bg-royal-gold-ink hover:bg-royal-gold-ink-hover"
        >
          <Send className="size-3.5" aria-hidden="true" />
          Send offer
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="More actions"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}

// ── Step rail ──────────────────────────────────────────────────────────────

export function StepRail({
  activeId,
  onSelect,
  collapsed = false,
  onToggleCollapsed,
  digests,
}: {
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
  readonly collapsed?: boolean;
  readonly onToggleCollapsed?: () => void;
  // Live overrides for the one-line digest, so the rail reports what a step
  // currently says rather than what it said when the page loaded.
  readonly digests?: Readonly<Record<string, string>>;
}) {
  const phases = ["Offer", "Tender", "Contract", "Handoff"] as const;
  return (
    <nav
      aria-label="Offer workflow"
      className={cn(
        "flex shrink-0 flex-col border-r border-border/70 bg-card/60 transition-[width]",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div className="flex-1 overflow-y-auto py-3">
        {phases.map((phase) => {
          const steps = STEPS.filter((s) => s.phase === phase);
          if (steps.length === 0) return null;
          return (
            <div key={phase} className="mb-1">
              {collapsed ? (
                <div className="mx-3 my-2 border-t border-border/70" />
              ) : (
                <p className="px-4 pb-1 pt-3 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                  {phase}
                </p>
              )}
              {steps.map((step) => (
                <RailItem
                  key={step.id}
                  step={step}
                  digest={digests?.[step.id] ?? step.digest}
                  active={step.id === activeId}
                  collapsed={collapsed}
                  onSelect={() => onSelect(step.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
      {onToggleCollapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand step rail" : "Collapse step rail"}
          className="flex items-center gap-2 border-t border-border/70 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-royal-gold/40"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          ) : (
            <>
              <PanelLeftClose className="size-4" aria-hidden="true" />
              Collapse
            </>
          )}
        </button>
      ) : null}
    </nav>
  );
}

function RailItem({
  step,
  digest,
  active,
  collapsed,
  onSelect,
}: {
  readonly step: PrototypeStep;
  readonly digest: string;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly onSelect: () => void;
}) {
  const locked = step.state === "locked";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "step" : undefined}
      title={collapsed ? `${step.label} — ${digest}` : undefined}
      className={cn(
        "group relative flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-royal-gold/40",
        active ? "bg-royal-gold-light/70" : "hover:bg-muted/50",
        locked && "opacity-55",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-royal-gold"
        />
      ) : null}
      <StepGlyph state={active ? "active" : step.state} index={step.index} />
      {collapsed ? null : (
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm leading-tight",
              active ? "font-semibold text-foreground" : "font-medium",
            )}
          >
            {step.label}
          </span>
          {/* The digest is the point: the rail answers "what does this step
              say?" without opening it. */}
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {digest}
          </span>
        </span>
      )}
    </button>
  );
}

// ── Step footer ────────────────────────────────────────────────────────────

export function StepFooter({
  activeId,
  onSelect,
}: {
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
}) {
  const i = STEPS.findIndex((s) => s.id === activeId);
  const prev = i > 0 ? STEPS[i - 1] : null;
  const next = i < STEPS.length - 1 ? STEPS[i + 1] : null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-card/80 px-5 py-3">
      <Button
        variant="ghost"
        size="sm"
        disabled={!prev}
        onClick={() => prev && onSelect(prev.id)}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {prev?.label ?? "Back"}
      </Button>
      <p className="hidden text-xs text-muted-foreground sm:block">
        Step {i + 1} of {STEPS.length}
      </p>
      <Button
        size="sm"
        className="bg-royal-gold-ink hover:bg-royal-gold-ink-hover"
        disabled={!next}
        onClick={() => next && onSelect(next.id)}
      >
        {next?.label ?? "Done"}
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ── Variant switcher (prototype-only chrome) ───────────────────────────────

export function VariantBar({ active }: { readonly active: VariantId }) {
  return (
    // Sits in normal flow beneath the frame rather than floating over it: a
    // fixed bar covered whichever bottom-edge control each variant is being
    // judged on.
    <div className="mt-3 flex justify-center">
      <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
        <span className="px-3 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Prototype
        </span>
        {VARIANTS.map((v) => (
          <Link
            key={v.id}
            href={`/prototype?v=${v.id}`}
            scroll={false}
            title={v.blurb}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              v.id === active
                ? "bg-royal-gold-light text-royal-gold-ink-text"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {v.name}
            {"chosen" in v && v.chosen ? (
              <Check
                className="ml-1.5 inline size-3 align-[-1px]"
                aria-label="chosen direction"
              />
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
