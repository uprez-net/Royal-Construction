import { ReceiptText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currency } from "@/utils/formatters";
import { ProjectDetail } from "@/types/project";

interface ProjectPaymentsTabProps {
  project: ProjectDetail;
}

/**
 * Formats a Prisma Decimal-as-string money value, falling back to an em dash
 * rather than rendering a bare "$" or "$NaN" when the value is missing.
 */
function money(value: string | null | undefined) {
  // `Number(null)` and `Number("")` are both 0, so a missing value would
  // otherwise render as "$0" — a figure the project does not actually hold.
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? currency.format(parsed) : "—";
}

const calcMilestoneOverviewData = (milestones: ProjectDetail["milestones"]) => {
  const stageMilestoneMap = new Map<string, { completed: number; total: number }>();
  for (const milestone of milestones) {
    const stage = milestone.projectStage;
    if (!stageMilestoneMap.has(stage)) {
      stageMilestoneMap.set(stage, { completed: 0, total: 0 });
    }
    const stageData = stageMilestoneMap.get(stage)!;
    stageData.total++;
    if (milestone.status === "DONE" || milestone.status === "NOT_REQUIRED") {
      stageData.completed++;
    }
  }
  const totalStages = stageMilestoneMap.size;
  const completedStages = Array.from(stageMilestoneMap.values()).filter((stageData) => stageData.completed === stageData.total).length;
  return {
    totalStages,
    completedStages,
  };
};

export function ProjectPaymentsTab({ project }: ProjectPaymentsTabProps) {
  const { totalStages: projectStagesCount, completedStages: completedStagesCount } = calcMilestoneOverviewData(project.milestones);

  return (
    <section className="space-y-4">
      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle
            as="h2"
            className="text-base font-semibold text-foreground"
          >
            Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
              <dt className="text-sm font-medium text-muted-foreground">
                Project budget
              </dt>
              <dd className="mt-1 font-mono text-xl tabular-nums text-foreground">
                {money(project.totalBudget)}
              </dd>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
              <dt className="text-sm font-medium text-muted-foreground">
                Stages invoiced
              </dt>
              <dd className="mt-1 font-mono text-xl tabular-nums text-foreground">
                {completedStagesCount} of {projectStagesCount}
              </dd>
            </div>
          </dl>

          <div className="mx-auto mt-6 flex max-w-xl flex-col items-center gap-3 py-8 text-center">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
              <ReceiptText
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
            </div>

            <p className="text-base font-semibold text-foreground">
              {completedStagesCount === 0
                ? "No invoices have been raised for this project"
                : "Invoice details are held in Xero"}
            </p>

            <p className="text-sm text-muted-foreground">
              Progress claims are raised as Xero invoices against a milestone.
              Amounts, sent and paid dates and payment status are not stored in
              BuildPro, so an invoice history cannot be shown here.
            </p>

            <p className="text-sm text-muted-foreground">
              Milestone budgets and the contract stage schedule are on the
              Milestones tab.
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
