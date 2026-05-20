import type { ProjectDetail, SafeVariation } from "@/types/project";

import { StatusPill } from "@/components/common/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VariationImpactTone, VariationTimelineImpact } from "@/types/ui";
import { Clock, Plus, Eye, Bell } from "lucide-react";

import { currency, dateFormat, variationStatusTone } from "../../../utils/formatters";

import { addDays, differenceInDays, format } from "date-fns";
import { DataTable } from "@/components/common/data-table";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";

const calculateVariationImpact = (
  variations: SafeVariation[],
  startDate: Date,
  endDate: Date,
): VariationTimelineImpact => {
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
      titleText: "Timeline On Track",
      card: "border-emerald-200 bg-emerald-50/70",
      iconWrapper: "bg-emerald-100 text-emerald-600",
      icon: "text-emerald-600",
      title: "text-emerald-700",
      originalBar: "bg-emerald-600",
      delayBar: "bg-emerald-400",
    },

    warning: {
      titleText: "Timeline Impact Detected",
      card: "border-amber-200 bg-amber-50/70",
      iconWrapper: "bg-amber-100 text-amber-600",
      icon: "text-amber-600",
      title: "text-amber-700",
      originalBar: "bg-teal-600",
      delayBar: "bg-amber-500",
    },

    danger: {
      titleText: "Critical Timeline Delay",
      card: "border-red-200 bg-red-50/70",
      iconWrapper: "bg-red-100 text-red-600",
      icon: "text-red-600",
      title: "text-red-700",
      originalBar: "bg-teal-600",
      delayBar: "bg-red-500",
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

    startDateLabel: format(startDate, "d MMM yyyy"),
    originalEndLabel: format(endDate, "d MMM yyyy"),
    adjustedEndLabel: format(adjustedEndDate, "d MMM yyyy"),

    styles: toneConfig[tone],
  };
};

export function ProjectVariationsTab({ project }: { project: ProjectDetail }) {
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
  const dispatch = useAppDispatch();

  return (
    <section className="space-y-4">
      <Card
        className={cn(
          "rounded-xl shadow-sm transition-colors",
          projectVariationImpact.styles.card,
        )}
      >
        <CardContent className="p-4">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                projectVariationImpact.styles.iconWrapper,
              )}
            >
              <Clock className="size-5" />
            </div>

            <div className="flex-1">
              <h4
                className={cn(
                  "mb-0.5 text-[13px] font-bold",
                  projectVariationImpact.styles.title,
                )}
              >
                {projectVariationImpact.title}
              </h4>

              <p className="text-xs text-muted-foreground">
                {projectVariationImpact.summary}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex h-6 overflow-hidden rounded-lg bg-white/70">
              <div
                className={cn(
                  "flex h-full items-center justify-center text-[10px] font-semibold text-white transition-all",
                  projectVariationImpact.styles.originalBar,
                )}
                style={{
                  width: `${projectVariationImpact.originalDurationPercent}%`,
                }}
              >
                Original Plan
              </div>

              {projectVariationImpact.totalDelayDays > 0 && (
                <div
                  className={cn(
                    "flex h-full items-center justify-center text-[10px] font-semibold text-white transition-all",
                    projectVariationImpact.styles.delayBar,
                  )}
                  style={{
                    width: `${projectVariationImpact.delayPercent}%`,
                  }}
                >
                  +{projectVariationImpact.totalDelayDays}d Delay
                </div>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap justify-between gap-2 px-1 text-[10px] text-muted-foreground">
              <span>{projectVariationImpact.startDateLabel}</span>

              <span>
                {projectVariationImpact.totalDelayDays > 0
                  ? projectVariationImpact.originalEndLabel
                  : "Estimated Completion"}
              </span>

              <span>{projectVariationImpact.adjustedEndLabel}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Variation Log
            </CardTitle>
            <Button
              size="sm"
              className="h-9 rounded-lg bg-teal-600 px-[14px] text-[12.5px] font-semibold text-white hover:bg-teal-700"
              onClick={() => dispatch(openModal({ type: "createVariation", payload: { project } }))}
            >
              <Plus className="mr-1 size-4" />
              Add Variation
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0 px-0 pb-5">
          <div className="overflow-x-auto">
            <DataTable
              headers={[
                "Var #",
                "Date Sent",
                "Reply Date",
                "Delay",
                "Description",
                "Reason",
                "Cost Impact",
                "New Total",
                "Status",
                "Action",
              ]}
              rows={project.variations.map((variation, index) => {
                const variationCost = Number(variation.cost);

                return [
                  <span className="font-semibold text-slate-900" key={variation.id}>
                    V-{String(index + 1).padStart(3, "0")}
                  </span>,

                  <span key={`${variation.id}-sent`}>{dateFormat.format(variation.requestedDate)}</span>,

                  <span key={`${variation.id}-approved`}>
                    {variation.approvedDate
                      ? dateFormat.format(variation.approvedDate)
                      : "-"}
                  </span>,

                  <span key={`${variation.id}-delay`} className="text-center text-slate-700">
                    {variation.delayDays ? `${variation.delayDays} days` : "-"}
                  </span>,

                  <span className="max-w-[200px] truncate text-slate-700" key={`${variation.id}-description`}>
                    {variation.description}
                  </span>,

                  <span className="text-slate-600" key={`${variation.id}-reason`}>
                    Client Request
                  </span>,

                  <span className="font-semibold text-red-600" key={`${variation.id}-cost`}>
                    +{currency.format(variationCost)}
                  </span>,

                  <span className="font-medium text-slate-900" key={`${variation.id}-new-total`}>
                    {currency.format(totalBudget + variationCost)}
                  </span>,

                  <StatusPill id={`${variation.id}-status`} tone={variationStatusTone(variation.status)}>
                    {variation.status}
                  </StatusPill>,

                  <div className="flex justify-end gap-1.5" key={`${variation.id}-actions`}>
                    {variation.status !== "APPROVED" && (
                      <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-[#D97706] hover:bg-amber-50 hover:text-[#D97706]">
                        <Bell className="size-3.5" />
                      </button>
                    )}

                    <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                      <Eye className="size-3.5" />
                    </button>
                  </div>,
                ];
              })}
              onRowClick={(rowIndex) => {
                const variation = project.variations[rowIndex];

                // handle navigation / dialog
                console.log("Clicked variation:", variation.id);
              }}
            />
          </div>
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3">
            <div className="text-[13px]">
              <b>Original Quote:</b> {currency.format(totalBudget)} &rarr;{" "}
              <b>With Variations:</b>{" "}
              <span className="ml-1 text-base font-extrabold text-[#E8730C]">
                {currency.format(totalBudget + variationTotal)}
              </span>
            </div>
            <div className="text-[13px]">
              <b>Total Variation Cost:</b>{" "}
              <span className="ml-1 text-[14px] font-extrabold text-red-600">
                +{currency.format(variationTotal)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
