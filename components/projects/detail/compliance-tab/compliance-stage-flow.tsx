"use client";

import { AlertTriangle, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  ComplianceStage,
  ComplianceStageState,
} from "@/lib/compliance/stage-flow";

/**
 * Where the file is up to, and how long it has been there.
 *
 * The tab has always known which block the flow was waiting on and only ever
 * said so with a "Now" pill on one card among seven -- which answers "is this
 * the step" for a card already on screen and never answers "what is the route
 * and where are we on it". Somebody opening a job they have not seen for a
 * fortnight had to open blocks until they found the one with work in it, and
 * nothing anywhere said that the surveyor on it was nine days past their quote.
 *
 * Deliberately thin on text. Each node is a name, a state and at most one short
 * line under it -- "3 days left", "9 days over", "started 4 days ago". The
 * detail is a scroll away in the block itself and a sentence away in the alert
 * above the tabs; repeating either here would turn a header meant to be read at
 * a glance into a third copy of the same paragraph.
 */

/** The dot and the rail, which carry the state before any text is read. */
function StageMarker({
  state,
  isOverdue,
}: {
  state: ComplianceStageState;
  isOverdue: boolean;
}) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
        isOverdue
          ? "border-destructive/50 bg-destructive-light text-destructive-ink"
          : state === "done"
            ? "border-success/50 bg-success-light text-success-ink"
            : state === "current"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted text-muted-foreground",
      )}
      aria-hidden="true"
    >
      {isOverdue ? (
        <AlertTriangle className="size-3.5" />
      ) : state === "done" ? (
        <Check className="size-3.5" />
      ) : (
        <span
          className={cn(
            "size-2 rounded-full",
            state === "current" ? "bg-primary-foreground" : "bg-current",
          )}
        />
      )}
    </span>
  );
}

/**
 * The one line under a stage name.
 *
 * Four readings and no more, in the order they matter: how far past the quote
 * it is, how much of the quote is left, how long it has been running with no
 * quote to measure against, and nothing at all. The last is the common case for
 * a stage nobody has started, and an empty line is the honest answer there --
 * "0 days" on a surveyor nobody has written to reads as a clock that is running.
 */
function stageTiming(stage: ComplianceStage): string | null {
  const { daysLeft, elapsedBusinessDays, isOverdue } = stage;

  if (daysLeft !== null && daysLeft < 0) {
    return `${Math.abs(daysLeft)}d over`;
  }

  // Red without a clock behind it. A stale title search is raised against a
  // surveyor who answered on time, and a development approval requirement
  // against nobody at all, so there is no figure to show -- but the node is red
  // and a node that is red and says nothing reads as a rendering fault.
  if (isOverdue) {
    return "Needs attention";
  }

  if (daysLeft !== null) {
    return daysLeft === 0 ? "Due today" : `${daysLeft}d left`;
  }

  if (stage.state === "done") return null;

  if (elapsedBusinessDays !== null) {
    return elapsedBusinessDays === 0
      ? "Started today"
      : `${elapsedBusinessDays}d in`;
  }

  return null;
}

type ComplianceStageFlowProps = {
  stages: ComplianceStage[];
  /** Focuses the block this stage corresponds to. */
  onSelectStage?: (stage: ComplianceStage) => void;
  className?: string;
};

export function ComplianceStageFlow({
  stages,
  onSelectStage,
  className,
}: ComplianceStageFlowProps) {
  if (stages.length === 0) return null;

  return (
    <nav
      aria-label="Compliance stages"
      className={cn(
        "rounded-xl border border-border/70 bg-card px-4 py-3 shadow-sm",
        className,
      )}
    >
      {/* Scrolls rather than wraps. Seven stages in a row is wider than a phone
          and wrapping them puts the last two on a line of their own under a
          connector that no longer connects anything -- which reads as two
          flows rather than one. */}
      <ol className="flex min-w-0 items-start gap-1 overflow-x-auto pb-1">
        {stages.map((stage, index) => {
          const timing = stageTiming(stage);
          const isLast = index === stages.length - 1;

          return (
            <li
              key={stage.id}
              className="flex min-w-0 flex-1 items-start gap-1"
            >
              <button
                type="button"
                onClick={() => onSelectStage?.(stage)}
                aria-current={stage.state === "current" ? "step" : undefined}
                className={cn(
                  "group flex min-w-[7.5rem] flex-col items-center gap-1.5 rounded-md px-2 py-1.5 text-center transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  onSelectStage && "hover:bg-muted/60",
                )}
              >
                <StageMarker
                  state={stage.state}
                  isOverdue={stage.isOverdue}
                />

                <span
                  className={cn(
                    "text-xs leading-tight font-medium",
                    stage.isOverdue
                      ? "text-destructive-ink"
                      : stage.state === "upcoming"
                        ? "text-muted-foreground"
                        : "text-foreground",
                  )}
                >
                  {stage.label}
                </span>

                {/* The line is rendered even when empty, so the nodes that have
                    one and the nodes that do not still sit on the same
                    baseline. A row of dots at seven different heights is
                    harder to read than one with gaps in its second line. */}
                <span
                  className={cn(
                    "text-[11px] leading-tight tabular-nums",
                    stage.isOverdue
                      ? "font-medium text-destructive-ink"
                      : "text-muted-foreground",
                  )}
                >
                  {timing ?? " "}
                </span>
              </button>

              {!isLast ? (
                // Aligned to the middle of the marker rather than to the top of
                // the node, so the rail reads as one line through the dots
                // rather than as a rule above the labels.
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-3 h-px min-w-4 flex-1 rounded-full",
                    stage.state === "done" ? "bg-success/40" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
