"use client";

import { AlertTriangle } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHbcfProjectBreach } from "@/hooks/useHbcfProjectBreach";
import { hbcfParseDate, type HbcfProjectBreach } from "@/lib/insurance/hbcf";
import { compactCurrency, currency, dateFormat } from "@/utils/formatters";

/**
 * Warns that this project's cover window sits across a period the HBCF pool
 * cannot carry.
 *
 * Renders nothing at all unless there is a breach — no loading skeleton, no
 * "all clear" state. A badge that is usually present teaches the eye to skip
 * it, and this one has to be noticed the once it appears. It also means the
 * header keeps its layout on every ordinary project while the check is in
 * flight.
 */

/** How many overlapping projects the tooltip names before summarising. */
const NAMED_OVERLAPS = 3;

function OverlapList({ breach }: { breach: HbcfProjectBreach }) {
  const named = breach.overlappingClaims.slice(0, NAMED_OVERLAPS);
  const remaining = breach.overlappingClaims.length - named.length;

  if (named.length === 0) {
    // This project alone is bigger than the whole pool — there is nothing to
    // list, and saying "overlapping with 0 projects" would be worse than mute.
    return null;
  }

  return (
    <div className="space-y-0.5">
      <p className="text-background/70">Also holding cover that day</p>
      <ul className="space-y-0.5">
        {named.map((claim) => (
          <li key={claim.projectId} className="flex items-baseline gap-2">
            <span className="truncate">{claim.label}</span>
            <span className="ml-auto font-mono tabular-nums text-background/80">
              {compactCurrency.format(claim.claimAmount)}
            </span>
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <p className="text-background/70">
          and {remaining} other {remaining === 1 ? "project" : "projects"}
        </p>
      ) : null}
    </div>
  );
}

export function HbcfCapacityBadge({ projectId }: { projectId: string }) {
  const { data: breach } = useHbcfProjectBreach(projectId);

  if (!breach) return null;

  const peak = dateFormat.format(hbcfParseDate(breach.peakDate));
  const summary = `HBCF cover for this project is over the pool by ${currency.format(breach.exceededBy)} on ${peak}.`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            aria-label={summary}
            className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-warning/40 bg-warning-light px-2.5 py-1 text-xs font-medium text-warning-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            tabIndex={0}
          >
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            HBCF over capacity
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className="max-w-xs flex-col items-stretch gap-2 py-2 text-left"
        >
          <p>
            On <span className="font-mono tabular-nums">{peak}</span> this
            project&apos;s cover window overlaps others hard enough to commit{" "}
            <span className="font-mono tabular-nums font-semibold">
              {currency.format(breach.peakUsedAmount)}
            </span>{" "}
            against a{" "}
            <span className="font-mono tabular-nums">
              {currency.format(breach.totalSumAssured)}
            </span>{" "}
            pool —{" "}
            <span className="font-mono tabular-nums font-semibold">
              {currency.format(breach.exceededBy)}
            </span>{" "}
            over.
          </p>
          <p className="text-background/70">
            This project holds{" "}
            <span className="font-mono tabular-nums">
              {compactCurrency.format(breach.claimAmount)}
            </span>{" "}
            of that, from{" "}
            <span className="font-mono tabular-nums">
              {dateFormat.format(
                hbcfParseDate(breach.insuranceClaimStartDate),
              )}
            </span>{" "}
            to{" "}
            <span className="font-mono tabular-nums">
              {dateFormat.format(hbcfParseDate(breach.insuranceClaimEndDate))}
            </span>
            .
          </p>
          <OverlapList breach={breach} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
