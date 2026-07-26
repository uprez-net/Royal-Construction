import type { ProjectDetail, SafeVariation } from "@/types/project";

import { StatusPill } from "@/components/common/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VariationImpactTone, VariationTimelineImpact } from "@/types/ui";
import { Clock, Plus } from "lucide-react";

import {
  currency,
  dateFormat,
  formatStatus,
  variationStatusTone,
} from "../../../utils/formatters";

import { addDays, differenceInDays } from "date-fns";
import { DataTable } from "@/components/common/data-table";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";

const calculateVariationImpact = (
  variations: SafeVariation[],
  startDate: Date,
  endDate: Date,
): VariationTimelineImpact => {
  const MIN_DELAY_VISUAL_PERCENT = 25;
  const originalDurationDays = Math.max(
    1,
    differenceInDays(endDate, startDate),
  );

  const approvedVariations = variations.filter(
    (variation) => variation.status === "APPROVED",
  );

  const totalDelayDays = approvedVariations.reduce(
    (total, variation) => total + (variation.delayDays ?? 0),
    0,
  );

  const adjustedDurationDays = originalDurationDays + totalDelayDays;

  const originalDurationPercent =
    adjustedDurationDays > 0
      ? (originalDurationDays / adjustedDurationDays) * 100
      : 100;

  const delayPercent =
    adjustedDurationDays > 0
      ? (totalDelayDays / adjustedDurationDays) * 100
      : 0;

  const adjustedEndDate = addDays(endDate, totalDelayDays);
  let visualDelayPercent = delayPercent;
  let visualOriginalPercent = originalDurationPercent;

  if (totalDelayDays > 0 && delayPercent < MIN_DELAY_VISUAL_PERCENT) {
    visualDelayPercent = MIN_DELAY_VISUAL_PERCENT;
    visualOriginalPercent = 100 - MIN_DELAY_VISUAL_PERCENT;
  }

  let tone: VariationImpactTone = "neutral";

  if (totalDelayDays >= 14) {
    tone = "danger";
  } else if (totalDelayDays > 0) {
    tone = "warning";
  }

  const toneConfig: Record<
    VariationImpactTone,
    VariationTimelineImpact["styles"] & { titleText: string }
  > = {
    neutral: {
      titleText: "Timeline on track",
      card: "border-border/70 bg-card",
      iconWrapper: "bg-success-light text-success-ink",
      icon: "text-success-ink",
      title: "text-foreground",
      originalBar: "bg-primary",
      delayBar: "bg-success",
    },

    warning: {
      titleText: "Timeline impact detected",
      card: "border-border/70 bg-card",
      iconWrapper: "bg-warning-light text-warning-ink",
      icon: "text-warning-ink",
      title: "text-warning-ink",
      originalBar: "bg-primary",
      delayBar: "bg-warning",
    },

    danger: {
      titleText: "Critical timeline delay",
      card: "border-border/70 bg-card",
      iconWrapper: "bg-destructive-light text-destructive-ink",
      icon: "text-destructive-ink",
      title: "text-destructive-ink",
      originalBar: "bg-primary",
      delayBar: "bg-destructive",
    },
  };

  const summary =
    totalDelayDays > 0
      ? `${approvedVariations.length} approved variation${
          approvedVariations.length === 1 ? "" : "s"
        } added ${totalDelayDays} day${
          totalDelayDays === 1 ? "" : "s"
        } to the project timeline.`
      : "No approved variations have impacted the project timeline.";

  return {
    tone,
    title: toneConfig[tone].titleText,
    summary,

    totalDelayDays,
    approvedVariationCount: approvedVariations.length,

    originalDurationPercent: Number(originalDurationPercent.toFixed(1)),
    delayPercent: Number(delayPercent.toFixed(1)),
    visualOriginalPercent,
    visualDelayPercent,

    startDateLabel: `${dateFormat.format(startDate)}`,
    originalEndLabel: `Original end ${dateFormat.format(endDate)}`,
    adjustedEndLabel: `New end ${dateFormat.format(adjustedEndDate)}`,

    styles: toneConfig[tone],
  };
};

export function ProjectVariationsTab({ project }: { project: ProjectDetail }) {
  const dispatch = useAppDispatch();
  const totalBudget = Number(project.totalBudget);
  const variationTotal = project.variations.reduce(
    (sum, variation) => sum + Number(variation.cost),
    0,
  );
  const projectVariationImpact = calculateVariationImpact(
    project.variations,
    new Date(project.startDate),
    new Date(project.estimatedEndDate),
  );
  const noDelay = projectVariationImpact.totalDelayDays === 0;
  // `adjustedEndLabel` carries a "New end " prefix for the chart caption; the
  // aria-label supplies its own wording, so it needs the bare date.
  const adjustedEndDateLabel = dateFormat.format(
    addDays(
      new Date(project.estimatedEndDate),
      projectVariationImpact.totalDelayDays,
    ),
  );

  // Variations arrive newest-first (`createdAt desc`). The log reads
  // chronologically: V-001 is the first variation raised, and each row's
  // "New total" is the contract total once that variation and every earlier
  // one has been applied — so the last row matches the footer total.
  const orderedVariations = [...project.variations].sort(
    (a, b) =>
      new Date(a.requestedDate).getTime() - new Date(b.requestedDate).getTime(),
  );

  const revisedTotals = orderedVariations.reduce<number[]>(
    (totals, variation) => [
      ...totals,
      (totals.at(-1) ?? totalBudget) + Number(variation.cost),
    ],
    [],
  );

  return (
    <section className="space-y-4">
      <Card
        className={cn(
          "rounded-xl shadow-sm",
          projectVariationImpact.styles.card,
        )}
      >
        <CardContent className="p-4">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-2xl",
                projectVariationImpact.styles.iconWrapper,
              )}
            >
              <Clock className="size-5" aria-hidden="true" />
            </div>

            <div className="flex-1">
              <h2
                className={cn(
                  "mb-0.5 text-base font-semibold",
                  projectVariationImpact.styles.title,
                )}
              >
                {projectVariationImpact.title}
              </h2>

              <p className="text-sm text-muted-foreground">
                {projectVariationImpact.summary}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <div
              className="flex h-6 overflow-hidden rounded-lg bg-muted"
              role="img"
              aria-label={
                noDelay
                  ? `Original plan runs the full duration, ${projectVariationImpact.startDateLabel} to ${adjustedEndDateLabel}.`
                  : `Original plan is ${projectVariationImpact.originalDurationPercent}% of the revised duration; approved variations add ${projectVariationImpact.totalDelayDays} days.`
              }
            >
              <div
                className={cn(
                  "h-full",
                  projectVariationImpact.styles.originalBar,
                )}
                style={{
                  width: `${projectVariationImpact.visualOriginalPercent}%`,
                }}
              />

              {!noDelay && (
                <div
                  className={cn(
                    "h-full",
                    projectVariationImpact.styles.delayBar,
                  )}
                  style={{
                    width: `${projectVariationImpact.visualDelayPercent}%`,
                  }}
                />
              )}
            </div>

            <ul className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full bg-primary"
                  aria-hidden="true"
                />
                Original plan
              </li>
              {!noDelay && (
                <li className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-block size-2 rounded-full",
                      projectVariationImpact.styles.delayBar,
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    Delay{" "}
                    <span className="font-mono tabular-nums">
                      +{projectVariationImpact.totalDelayDays}
                    </span>{" "}
                    {projectVariationImpact.totalDelayDays === 1
                      ? "day"
                      : "days"}
                  </span>
                </li>
              )}
            </ul>

            <div className="relative mt-2 h-5 font-mono text-xs tabular-nums text-muted-foreground">
              <span className="absolute left-0">
                {projectVariationImpact.startDateLabel}
              </span>

              <span
                className={cn(
                  "absolute whitespace-nowrap",
                  noDelay ? "-translate-x-full" : "-translate-x-1/2",
                )}
                style={{
                  left: noDelay
                    ? `calc(${projectVariationImpact.visualOriginalPercent}% - 8px)`
                    : `${projectVariationImpact.visualOriginalPercent}%`,
                }}
              >
                {noDelay
                  ? projectVariationImpact.adjustedEndLabel
                  : projectVariationImpact.originalEndLabel}
              </span>

              {!noDelay && (
                <span className="absolute right-0 whitespace-nowrap">
                  {projectVariationImpact.adjustedEndLabel}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle
              as="h2"
              className="text-base font-semibold text-foreground"
            >
              Variation log
            </CardTitle>
            <Button
              size="sm"
              className="h-9 rounded-lg px-3.5 text-sm font-medium"
              onClick={() =>
                dispatch(
                  openModal({ type: "createVariation", payload: { project } }),
                )
              }
            >
              <Plus className="mr-1 size-4" aria-hidden="true" />
              Add variation
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-0 pb-5 pt-0">
          <div className="mx-4 mt-2">
            <DataTable
              caption={`Variation log for ${project.name}, with dates, delay, cost impact and revised contract total.`}
              headers={[
                "Var #",
                "Date sent",
                "Reply date",
                "Delay",
                "Description",
                "Cost impact",
                "New total",
                "Status",
              ]}
              align={[
                "start",
                "start",
                "start",
                "end",
                "start",
                "end",
                "end",
                "start",
              ]}
              rows={orderedVariations.map((variation, index) => {
                const variationCost = Number(variation.cost);

                return [
                  <span
                    className="font-mono font-medium tabular-nums text-foreground"
                    key={variation.id}
                  >
                    V-{String(index + 1).padStart(3, "0")}
                  </span>,

                  <span
                    key={`${variation.id}-sent`}
                    className="font-mono tabular-nums"
                  >
                    {dateFormat.format(variation.requestedDate)}
                  </span>,

                  <span
                    key={`${variation.id}-approved`}
                    className="font-mono tabular-nums"
                  >
                    {variation.approvedDate
                      ? dateFormat.format(variation.approvedDate)
                      : "—"}
                  </span>,

                  <span
                    key={`${variation.id}-delay`}
                    className="font-mono tabular-nums"
                  >
                    {variation.delayDays
                      ? `${variation.delayDays} ${variation.delayDays === 1 ? "day" : "days"}`
                      : "—"}
                  </span>,

                  <span
                    className="block max-w-xs text-pretty"
                    key={`${variation.id}-description`}
                  >
                    {variation.description}
                  </span>,

                  <span
                    className="font-mono font-medium tabular-nums text-warning-ink"
                    key={`${variation.id}-cost`}
                  >
                    +{currency.format(variationCost)}
                  </span>,

                  <span
                    className="font-mono tabular-nums text-foreground"
                    key={`${variation.id}-new-total`}
                  >
                    {currency.format(revisedTotals[index])}
                  </span>,

                  <StatusPill
                    key={`${variation.id}-status`}
                    tone={variationStatusTone(variation.status)}
                  >
                    {formatStatus(variation.status)}
                  </StatusPill>,
                ];
              })}
              emptyState={
                <div className="flex flex-col items-center gap-1">
                  <p className="text-sm font-medium text-foreground">
                    No variations raised
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Changes to scope, cost or timeline will be logged here.
                  </p>
                </div>
              }
            />
          </div>
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-4 py-3">
            <p className="text-sm text-foreground">
              <span className="font-medium">Original quote:</span>{" "}
              <span className="font-mono tabular-nums">
                {currency.format(totalBudget)}
              </span>{" "}
              &rarr; <span className="font-medium">with variations:</span>{" "}
              <span className="ml-1 font-mono text-base font-semibold tabular-nums text-foreground">
                {currency.format(totalBudget + variationTotal)}
              </span>
            </p>
            <p className="text-sm text-foreground">
              <span className="font-medium">Total variation cost:</span>{" "}
              <span className="ml-1 font-mono text-base font-semibold tabular-nums text-warning-ink">
                +{currency.format(variationTotal)}
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
