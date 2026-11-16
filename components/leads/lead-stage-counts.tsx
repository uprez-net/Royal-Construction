"use client";

import type { LeadStage as DBLeadStage } from "@prisma/client";

import { LEAD_STAGE_OPTIONS } from "@/lib/leads/lead-helpers";
import { PIPELINE_STAGES } from "@/lib/leads/pipeline-stages";
import {
  LeadStageToLeadStageDBMapping,
  type LeadStage,
} from "@/lib/leads/types";
import { cn } from "@/lib/utils";

/**
 * The stages a card is shown for: every selectable stage, in the picker's
 * order, and after them any retired stage that still holds a lead, so a lead
 * left on one is never missing from the row.
 */
function stagesToShow(byStage: Partial<Record<DBLeadStage, number>>) {
  const shown: LeadStage[] = [...LEAD_STAGE_OPTIONS];
  const retired = (
    Object.keys(LeadStageToLeadStageDBMapping) as LeadStage[]
  ).filter(
    (label) =>
      !shown.includes(label)
      && (byStage[LeadStageToLeadStageDBMapping[label]] ?? 0) > 0,
  );
  return [...shown, ...retired];
}

/**
 * One small card per lead stage, under the six summary cards: how many leads
 * sit in each, for the timeframe the summary cards count. A click filters the
 * table to that stage, the same as its chip, and the number is the rows it
 * opens (`getLeadsStats` counts with the stage filter's own `where`).
 *
 * On a phone the row scrolls sideways, like the summary cards above it.
 */
export function LeadStageCounts({
  byStage,
  activeMetric,
  onSelect,
}: {
  byStage: Partial<Record<DBLeadStage, number>>;
  activeMetric: string | null;
  onSelect: (stage: LeadStage) => void;
}) {
  const stages = stagesToShow(byStage);
  return (
    <div
      role="group"
      aria-label="Leads by stage"
      className={cn(
        "-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 no-scrollbar *:w-28 *:shrink-0",
        "sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto",
        stages.length > 10 ? "xl:grid-cols-7" : "xl:grid-cols-10",
      )}
    >
      {stages.map((stage) => {
        const code = LeadStageToLeadStageDBMapping[stage];
        const count = byStage[code] ?? 0;
        const active = activeMetric === stage;
        return (
          <button
            key={stage}
            type="button"
            onClick={() => onSelect(stage)}
            aria-pressed={active}
            aria-label={`${stage}: ${count} ${count === 1 ? "lead" : "leads"}`}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-all duration-200",
              "cursor-pointer select-none hover:border-muted-foreground/30 hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              active
                ? "border-transparent bg-white shadow-md ring-2 ring-royal-gold-ink"
                : "border-border/70 bg-white/95 shadow-sm",
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: `var(${PIPELINE_STAGES[code].colorVar})`,
                }}
                aria-hidden="true"
              />
              <span className="truncate text-xs font-medium text-muted-foreground">
                {stage}
              </span>
            </span>
            <span
              className={cn(
                "font-heading text-xl font-semibold leading-none tracking-tight tabular-nums",
                count === 0 ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
