import { ReceiptText } from "lucide-react";

import { ProjectWithStats } from "@/types/project";
import { compactCurrency, currency } from "@/utils/formatters";
import { getBudgetStatus } from "@/lib/utils/project-budget-status";
import { DataTable } from "../common/data-table";

interface FinancialTabProps {
  project: ProjectWithStats;
}

function MoneyTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning" | "destructive";
}) {
  const valueTone =
    tone === "success"
      ? "text-success-ink"
      : tone === "warning"
        ? "text-warning-ink"
        : tone === "destructive"
          ? "text-destructive-ink"
          : "text-foreground";

  // A missing or non-numeric Decimal string must not reach the formatter: it
  // rendered "$NaN" in both the tile and its tooltip.
  const hasValue = Number.isFinite(value);

  return (
    <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-lg font-semibold tabular-nums ${valueTone}`}
        title={hasValue ? currency.format(value) : "Not recorded"}
      >
        {hasValue ? compactCurrency.format(value) : "—"}
      </p>
    </div>
  );
}

export function FinancialTab({ project }: FinancialTabProps) {
  const spent = Number(project.spent);
  const budget = Number(project.totalBudget);
  const variation = Number(project.approvedVariationSpend);
  const remaining = budget - spent;
  const status = getBudgetStatus(budget, spent);
  const isOverBudget = status === "OVER_BUDGET";
  const isNotStarted = status === "NOT_STARTED";

  // Guard both operands: a project with no budget recorded, or an unparseable
  // spend, must not render NaN% or an NaN-width bar.
  const utilisation =
    budget > 0 && Number.isFinite(spent)
      ? Math.round((spent / budget) * 100)
      : null;
  const barWidth = Math.min(100, Math.max(0, utilisation ?? 0));

  // Drive the fourth MoneyTile from the shared classifier so this tab agrees
  // with the stat cards, overview tab and project card.
  //
  // NOT_STARTED means either "no spend yet" or "no budget recorded", so the
  // remaining figure is only meaningful once there is a budget to draw down
  // from. When there is one, no spend means the entire budget is still
  // remaining — reporting $0 was the opposite of the truth, on the tab where
  // the number matters most. Without a budget the tile falls back to NaN,
  // which MoneyTile renders as "—" rather than an invented zero.
  const canShowRemaining = budget > 0 && Number.isFinite(spent);
  const summaryTileLabel = isOverBudget
    ? "Over budget"
    : canShowRemaining
      ? "Budget remaining"
      : budget > 0
        ? "No spend recorded"
        : "No budget recorded";
  const summaryTileTone: "neutral" | "success" | "destructive" = isOverBudget
    ? "destructive"
    : isNotStarted
      ? "neutral"
      : "success";
  const summaryTileValue = canShowRemaining ? Math.abs(remaining) : Number.NaN;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MoneyTile label="Total budget" value={budget} />
        <MoneyTile label="Actual spend" value={spent} />
        <MoneyTile label="Approved variations" value={variation} />
        <MoneyTile
          label={summaryTileLabel}
          value={summaryTileValue}
          tone={summaryTileTone}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">
            Budget utilisation
          </p>
          <p className="font-mono text-sm font-medium text-foreground tabular-nums">
            {utilisation === null ? "No budget recorded" : `${utilisation}%`}
          </p>
        </div>
        {/* aria-valuenow is clamped like the bar itself: an over-budget project
            must not announce a value above aria-valuemax. The exact figure
            stays in aria-valuetext. */}
        <div
          role="progressbar"
          aria-label="Budget utilisation"
          aria-valuenow={barWidth}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={
            utilisation === null
              ? "No budget recorded"
              : `${utilisation}% of budget spent`
          }
          className="h-3 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={`h-full transition-[width] duration-200 ease-out motion-reduce:transition-none ${
              isOverBudget
                ? "bg-destructive"
                : isNotStarted
                  ? "bg-muted"
                  : "bg-primary"
            }`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            {Number.isFinite(spent) ? currency.format(spent) : "—"}
          </span>{" "}
          spent of{" "}
          <span className="font-mono tabular-nums">
            {Number.isFinite(budget) ? currency.format(budget) : "—"}
          </span>
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-foreground">Invoices</h3>

        {/*
          Invoicing is not wired to this project yet. The previous version of
          this tab rendered three hardcoded invoices (INV-001…003) plus fake
          paid/pending/overdue totals, which read as real financial data.
          The table shell below names the columns that will appear once
          invoicing is connected, and states plainly that there is nothing yet.
        */}
        <DataTable
          headers={["Invoice", "Description", "Amount", "Date", "Status"]}
          align={["start", "start", "end", "start", "start"]}
          caption="Invoices raised against this project"
          rows={[]}
          emptyState={
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                <ReceiptText
                  aria-hidden="true"
                  className="size-5 text-muted-foreground"
                />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Invoicing is not connected for this project
                </p>

                <p className="text-xs text-muted-foreground">
                  Progress claims and their payment status will appear here once
                  invoicing is set up.
                </p>
              </div>
            </div>
          }
        />
      </section>
    </div>
  );
}
