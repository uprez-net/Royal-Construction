"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import type {
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { CheckCircle2, HardHat, Rocket } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency } from "./offer-workspace-format";

type ProjectHandoffPanelProps = {
  readonly status: OfferWorkspaceStatus;
  readonly job: OfferWorkspaceJob;
  readonly customerPrice: OfferCustomerPrice;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly onCreateProject: () => void;
};

export function ProjectHandoffPanel({
  status,
  job,
  customerPrice,
  lines,
  paymentSchedule,
  onCreateProject,
}: ProjectHandoffPanelProps) {
  const isCreated = status === "project";
  const costLineCount = lines.filter((line) => line.includedInContract).length;
  const milestoneCount = paymentSchedule.length;

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Create the Project from the signed Contract and seed the costing report from the internal cost lines."
          icon={<HardHat className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Project handoff"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        {isCreated ? (
          <Banner tone="success">
            <span className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              Project created and handed off. The costing report is seeded and
              ready for budget-vs-actual tracking.
            </span>
          </Banner>
        ) : (
          <Banner tone="active">
            The Contract is signed. Create the Project to move this job into
            execution.
          </Banner>
        )}

        <dl className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-4 sm:grid-cols-2">
          <SummaryItem label="Reference" value={`${job.reference}-${job.revision}`} mono />
          <SummaryItem label="Client" value={job.clientNames} />
          <SummaryItem label="Site" value={job.siteAddress} />
          <SummaryItem
            label="Contract value inc GST"
            value={formatCurrency(customerPrice.selectedContractValueIncGst)}
            mono
          />
          <SummaryItem
            label="Costing report seed"
            value={`${costLineCount} included cost line${costLineCount === 1 ? "" : "s"}`}
          />
          <SummaryItem
            label="Payment milestones"
            value={`${milestoneCount} stage${milestoneCount === 1 ? "" : "s"}`}
          />
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {isCreated ? (
            <Button disabled size="sm" type="button" variant="outline">
              Open Project
            </Button>
          ) : (
            <Button
              className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
              size="sm"
              type="button"
              onClick={onCreateProject}
            >
              <Rocket className="size-4" aria-hidden="true" />
              Create Project
            </Button>
          )}
          {isCreated ? (
            <span className="text-xs text-muted-foreground">
              Project routing + the seeded costing report land with the Project
              module.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryItem({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "text-sm font-medium font-mono" : "text-sm font-medium"}>
        {value || "—"}
      </dd>
    </div>
  );
}

function Banner({
  children,
  tone,
}: {
  readonly children: React.ReactNode;
  readonly tone: "active" | "success";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/30 bg-success-light text-foreground"
      : "border-royal-gold/30 bg-royal-gold-light/40 text-foreground";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${toneClass}`}>
      {children}
    </div>
  );
}
