"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ShieldCheck,
} from "lucide-react";
import {
  eachMonthOfInterval,
  endOfMonth,
  format,
  startOfMonth,
} from "date-fns";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHbcfTimeline } from "@/hooks/useHbcfTimeline";
import {
  HBCF_FREE_COLOUR,
  hbcfAxisRange,
  hbcfClaimColour,
  hbcfClaimLabel,
  hbcfParseDate,
  type HbcfAssessment,
  type HbcfProjectClaim,
} from "@/lib/insurance/hbcf";
import { cn } from "@/lib/utils";
import { compactCurrency, currency, dateFormat } from "@/utils/formatters";

/**
 * HBCF Claim Timeline.
 *
 * Shows how much of the builder's HBCF pool is committed, when each project's
 * cover expires, and — from that — the earliest this lead's build could start.
 * The card fetches its own data (§3), so the lead detail screen passes nothing
 * but the lead id.
 */

interface Segment {
  key: string;
  label: string;
  amount: number;
  colour: string;
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** A pale wash of a claim's colour, for row backgrounds and unfilled bars. */
function tint(colour: string, percent: number) {
  return `color-mix(in oklab, ${colour} ${percent}%, transparent)`;
}

/* -------------------------------------------------------------------------- */
/*                             Allocation summary                             */
/* -------------------------------------------------------------------------- */

const RING_RADIUS = 34;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Usage reads as pressure, so the ring warms as the pool fills. */
function ringColour(usedPercent: number) {
  if (usedPercent >= 90) return "var(--destructive)";
  if (usedPercent >= 75) return "var(--warning)";
  return "var(--chart-2)";
}

function AllocationRing({ usedPercent }: { usedPercent: number }) {
  const colour = ringColour(usedPercent);
  const filled = (clampPercent(usedPercent) / 100) * RING_CIRCUMFERENCE;

  return (
    <div className="relative shrink-0">
      <svg
        width="88"
        height="88"
        viewBox="0 0 88 88"
        role="img"
        aria-label={`${Math.round(usedPercent)} percent of HBCF capacity used`}
      >
        <circle
          cx="44"
          cy="44"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="9"
        />
        <circle
          cx="44"
          cy="44"
          r={RING_RADIUS}
          fill="none"
          stroke={colour}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 44 44)"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-lg font-semibold tabular-nums text-foreground">
          {Math.round(usedPercent)}%
        </span>
        <span className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase">
          Used
        </span>
      </div>
    </div>
  );
}

function AllocationSummary({
  segments,
  usedAmount,
  totalSumAssured,
}: {
  segments: Segment[];
  usedAmount: number;
  totalSumAssured: number;
}) {
  const usedPercent =
    totalSumAssured > 0 ? (usedAmount / totalSumAssured) * 100 : 0;

  return (
    <section className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
      <AllocationRing usedPercent={usedPercent} />

      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Current allocation
          </h3>
          <p className="font-mono text-sm tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">
              {compactCurrency.format(usedAmount)}
            </span>{" "}
            / {compactCurrency.format(totalSumAssured)}
          </p>
        </div>

        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {segments.map((segment) => {
            const width =
              totalSumAssured > 0
                ? (segment.amount / totalSumAssured) * 100
                : 0;
            if (width <= 0) return null;

            const isFree = segment.key === "free";
            return (
              <div
                key={segment.key}
                title={`${segment.label} — ${compactCurrency.format(segment.amount)}`}
                style={{
                  width: `${clampPercent(width)}%`,
                  backgroundColor: isFree
                    ? tint(segment.colour, 22)
                    : segment.colour,
                }}
              />
            );
          })}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {segments.map((segment) => (
            <li
              key={segment.key}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: segment.colour }}
              />
              <span className="truncate">{segment.label}</span>
              <span className="font-mono tabular-nums text-foreground">
                {compactCurrency.format(segment.amount)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                             Capacity timeline                              */
/* -------------------------------------------------------------------------- */

interface AxisBar {
  leftPercent: number;
  widthPercent: number;
}

function CapacityTimeline({
  claims,
  colours,
  assessment,
  today,
  usedAmount,
  totalSumAssured,
}: {
  claims: HbcfProjectClaim[];
  colours: string[];
  assessment: HbcfAssessment;
  today: Date;
  usedAmount: number;
  totalSumAssured: number;
}) {
  const axis = useMemo(
    () =>
      hbcfAxisRange({
        claims,
        projectedWindow: assessment.projectedWindow,
        today,
      }),
    [claims, assessment.projectedWindow, today],
  );

  const spanMs = axis.end.getTime() - axis.start.getTime();

  // Positions are proportional to elapsed time, and the month gridlines are
  // measured the same way, so a 28-day February does not drift from its label.
  const position = (from: Date, to: Date): AxisBar => {
    if (spanMs <= 0) return { leftPercent: 0, widthPercent: 0 };

    const left = ((from.getTime() - axis.start.getTime()) / spanMs) * 100;
    const right = ((to.getTime() - axis.start.getTime()) / spanMs) * 100;

    return {
      leftPercent: clampPercent(left),
      widthPercent: Math.max(1.5, clampPercent(right) - clampPercent(left)),
    };
  };

  const months = eachMonthOfInterval({
    start: axis.start,
    end: axis.end,
  }).map((month) => ({
    key: month.toISOString(),
    label: format(month, "MMM"),
    ...position(startOfMonth(month), endOfMonth(month)),
  }));

  const nowLeft = clampPercent(
    ((today.getTime() - axis.start.getTime()) / spanMs) * 100,
  );

  const projected = assessment.projectedWindow
    ? position(
        hbcfParseDate(assessment.projectedWindow.start),
        hbcfParseDate(assessment.projectedWindow.end),
      )
    : null;

  const needLabel = assessment.needRange
    ? compactCurrency.format(assessment.needRange.high)
    : null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
          Capacity timeline
        </h3>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">
            {compactCurrency.format(usedAmount)}
          </span>{" "}
          / {compactCurrency.format(totalSumAssured)}
        </span>
      </div>

      <TooltipProvider>
        <div className="overflow-x-auto no-scrollbar">
          <div className="min-w-140">
            {/* Month axis */}
            <div className="flex">
              <div className="w-20 shrink-0" />
              <div className="relative h-5 flex-1">
                {months.map((month) => (
                  <span
                    key={month.key}
                    className="absolute top-0 overflow-hidden text-center text-[10px] text-muted-foreground"
                    style={{
                      left: `${month.leftPercent}%`,
                      width: `${month.widthPercent}%`,
                    }}
                  >
                    {month.label}
                  </span>
                ))}
                {/* Labelled once, at the top; the line itself repeats per row. */}
                <span
                  className="absolute top-4 -translate-x-1/2 rounded-sm bg-foreground px-1 text-[9px] font-bold tracking-wide text-background"
                  style={{ left: `${nowLeft}%` }}
                >
                  NOW
                </span>
              </div>
            </div>

            <div className="space-y-1.5 mt-3">
              {claims.map((claim, index) => {
                const bar = position(
                  hbcfParseDate(claim.insuranceClaimStartDate),
                  hbcfParseDate(claim.insuranceClaimEndDate),
                );

                return (
                  <div key={claim.projectId} className="flex items-center">
                    <span className="w-20 shrink-0 truncate pr-2 text-xs text-muted-foreground">
                      {hbcfClaimLabel(claim)}
                    </span>
                    <div className="relative h-7 flex-1 rounded-md bg-muted/40">
                      <NowMarker leftPercent={nowLeft} />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            tabIndex={0}
                            className="absolute inset-y-0.5 flex items-center justify-center overflow-hidden rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                            style={{
                              left: `${bar.leftPercent}%`,
                              width: `${bar.widthPercent}%`,
                              backgroundColor: colours[index],
                            }}
                          >
                            <span className="truncate text-[10px] font-semibold text-white">
                              {compactCurrency.format(claim.claimAmount)}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="space-y-0.5">
                            <p className="font-semibold">
                              {hbcfClaimLabel(claim)}
                            </p>
                            <p className="font-mono tabular-nums">
                              {currency.format(claim.claimAmount)}
                            </p>
                            <p className="text-background/70">
                              {format(
                                hbcfParseDate(claim.insuranceClaimStartDate),
                                "MMM yyyy",
                              )}{" "}
                              —{" "}
                              {format(
                                hbcfParseDate(claim.insuranceClaimEndDate),
                                "MMM yyyy",
                              )}
                            </p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}

              {projected && assessment.projectedWindow ? (
                <div className="flex items-center">
                  <span className="w-20 shrink-0 truncate pr-2 text-xs font-medium text-foreground">
                    This lead
                  </span>
                  <div className="relative h-7 flex-1 rounded-md bg-muted/40">
                    <NowMarker leftPercent={nowLeft} />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          tabIndex={0}
                          className="absolute inset-y-0.5 flex items-center justify-center overflow-hidden rounded-md border border-dashed px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          style={{
                            left: `${projected.leftPercent}%`,
                            width: `${projected.widthPercent}%`,
                            borderColor: "var(--warning-ink)",
                            backgroundColor: tint("var(--warning)", 18),
                          }}
                        >
                          <span className="truncate text-[10px] font-semibold text-warning-ink">
                            {needLabel}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-0.5">
                          <p className="font-semibold">This lead</p>
                          {needLabel ? (
                            <p className="font-mono tabular-nums">
                              {currency.format(assessment.needRange?.high ?? 0)}
                            </p>
                          ) : null}
                          <p className="text-background/70">
                            {format(
                              hbcfParseDate(assessment.projectedWindow.start),
                              "MMM yyyy",
                            )}{" "}
                            —{" "}
                            {format(
                              hbcfParseDate(assessment.projectedWindow.end),
                              "MMM yyyy",
                            )}
                          </p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </TooltipProvider>
    </section>
  );
}

function NowMarker({ leftPercent }: { leftPercent: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 z-10 w-px bg-foreground/40"
      style={{ left: `${leftPercent}%` }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*                          Build start assessment                            */
/* -------------------------------------------------------------------------- */

function BuildStartAssessment({
  assessment,
  estimatedStartDate,
}: {
  assessment: HbcfAssessment;
  estimatedStartDate?: string | null;
}) {
  const {
    needRange,
    // directAvailable,
    // decisiveClaim,
    canStartFrom,
    sufficient,
  } = assessment;

  if (!needRange) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        This lead has neither a recorded value nor a budget range, so there is
        nothing to assess capacity against yet.
      </p>
    );
  }

  // const needLabel = needRange.isOpenEnded
  //   ? `${compactCurrency.format(needRange.low)}+`
  //   : `~${compactCurrency.format(needRange.low)}–${compactCurrency.format(needRange.high)}`;

  return (
    <section
      className="space-y-2 rounded-xl border border-dashed p-3.5"
      style={{
        borderColor: "var(--warning-ink)",
        backgroundColor: "var(--warning-light)",
      }}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlertTriangle className="size-4 text-warning-ink" aria-hidden="true" />
        Build start assessment
      </h3>
      {estimatedStartDate ? (
        <p className="text-xs text-foreground">
          Planning from:{" "}
          <span className="font-mono font-semibold tabular-nums">
            {dateFormat.format(hbcfParseDate(estimatedStartDate))}
          </span>
          <span className="text-muted-foreground">
            {" "}
            — HBCF capacity is assessed from this date.
          </span>
        </p>
      ) : null}
      {/* Hidden now should later be pushed based on requirment */}
      {/* <p className="text-xs text-foreground">
        Direct amount available:{" "}
        <span className="font-mono font-semibold tabular-nums text-success-ink">
          {compactCurrency.format(directAvailable)}
        </span>{" "}
        <span className="text-muted-foreground">
          (
          {sufficient
            ? "sufficient for full build"
            : "insufficient for full build"}
          )
        </span>
      </p>

      <p className="text-xs text-foreground">
        This lead needs:{" "}
        <span className="font-mono font-semibold tabular-nums">
          {needLabel}
        </span>{" "}
        HBCF cover{" "}
        <span className="text-muted-foreground">
          (based on{" "}
          {needRange.source === "estimatedValue"
            ? "recorded deal value"
            : "budget range"}
          )
        </span>
      </p>

      {decisiveClaim ? (
        <p className="text-xs text-foreground">
          Nearest freeing up:{" "}
          <span className="font-mono font-semibold tabular-nums text-warning-ink">
            {compactCurrency.format(decisiveClaim.claimAmount)}
          </span>{" "}
          from <span className="italic">{decisiveClaim.label}</span> on{" "}
          <span className="font-mono font-semibold tabular-nums text-warning-ink">
            {dateFormat.format(hbcfParseDate(decisiveClaim.freesOn))}
          </span>
        </p>
      ) : null} */}

      <div className="border-t border-border/70 pt-2">
        {canStartFrom ? (
          <>
            <p className="flex items-start gap-1.5 text-xs text-foreground">
              <CheckCircle2
                className="mt-0.5 size-3.5 shrink-0 text-success-ink"
                aria-hidden="true"
              />
              <span>
                Can start build:{" "}
                <span className="font-semibold">
                  {sufficient
                    ? "Immediately"
                    : `After ${dateFormat.format(hbcfParseDate(canStartFrom))}`}
                </span>
                {sufficient ? null : " (if lead converts before then)"}
              </span>
            </p>
            {sufficient ? null : (
              <p className="mt-1 pl-5 text-[11px] text-muted-foreground">
                If converted early, the contract can be signed and prep work can
                begin while waiting for HBCF capacity.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-foreground">
            Even with every current claim expiring, the pool does not reach{" "}
            <span className="font-mono font-semibold tabular-nums">
              {compactCurrency.format(needRange.high)}
            </span>
            . This build needs additional HBCF eligibility.
          </p>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Card                                     */
/* -------------------------------------------------------------------------- */

function CardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="size-22 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

export function HbcfClaimCard({
  leadId,
  estimatedStartDate,
}: {
  leadId: number;
  estimatedStartDate?: string | null;
}) {
  const { data, loading, error } = useHbcfTimeline(leadId, estimatedStartDate);
  const [open, setOpen] = useState(false);

  const claims = useMemo(() => data?.claims ?? [], [data]);
  const assessment = data?.assessment ?? null;

  // `generatedAt` anchors the NOW marker and the assessment to the same instant
  // the server computed against, so the two can never disagree.
  const today = useMemo(
    () => (data ? hbcfParseDate(data.generatedAt) : new Date()),
    [data],
  );

  const colours = useMemo(
    () => claims.map((_, index) => hbcfClaimColour(index)),
    [claims],
  );

  const segments = useMemo<Segment[]>(() => {
    if (!assessment) return [];

    const claimSegments = claims.map((claim, index) => ({
      key: claim.projectId,
      label: hbcfClaimLabel(claim),
      amount: claim.claimAmount,
      colour: colours[index],
    }));

    return assessment.directAvailable > 0
      ? [
          ...claimSegments,
          {
            key: "free",
            label: "Free",
            amount: assessment.directAvailable,
            colour: HBCF_FREE_COLOUR,
          },
        ]
      : claimSegments;
  }, [assessment, claims, colours]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-border/70 bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
            <ShieldCheck className="size-4" aria-hidden="true" />
            HBCF timeline
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Track capacity across all active projects to determine when this
            lead can be accommodated.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {assessment ? (
            <Badge
              variant="secondary"
              className="rounded-full px-3 py-1 text-xs font-medium"
            >
              Sum assured:{" "}
              <span className="ml-1 font-mono tabular-nums">
                {compactCurrency.format(assessment.totalSumAssured)}
              </span>
            </Badge>
          ) : null}

          <CollapsibleTrigger
            className="group rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={
              open
                ? "Collapse HBCF claim timeline"
                : "Expand HBCF claim timeline"
            }
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <div className="space-y-4 border-t border-border/70 p-4">
          {loading ? <CardSkeleton /> : null}

          {!loading && error ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {error}
            </p>
          ) : null}

          {!loading && !error && assessment ? (
            claims.length === 0 ? (
              <div className="space-y-3">
                <p className="rounded-xl border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  No project is currently holding HBCF cover, so the full pool
                  of{" "}
                  <span className="font-mono tabular-nums">
                    {compactCurrency.format(assessment.totalSumAssured)}
                  </span>{" "}
                  is available.
                </p>
                <BuildStartAssessment
                  assessment={assessment}
                  estimatedStartDate={estimatedStartDate}
                />
              </div>
            ) : (
              <>
                <AllocationSummary
                  segments={segments}
                  usedAmount={assessment.usedAmount}
                  totalSumAssured={assessment.totalSumAssured}
                />
                <CapacityTimeline
                  claims={claims}
                  colours={colours}
                  assessment={assessment}
                  today={today}
                  usedAmount={assessment.usedAmount}
                  totalSumAssured={assessment.totalSumAssured}
                />
                <BuildStartAssessment
                  assessment={assessment}
                  estimatedStartDate={estimatedStartDate}
                />
              </>
            )
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
