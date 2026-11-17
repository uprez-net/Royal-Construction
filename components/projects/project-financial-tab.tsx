import type { ProjectStage } from "@prisma/client";
import { ArrowRight, ReceiptText } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { PROJECT_STAGE_LABELS, ProjectWithStats } from "@/types/project";
import {
  compactCurrency,
  currency,
  dateFormat,
  formatStatus,
} from "@/utils/formatters";
import { invoiceTone } from "@/lib/projects/invoice-display";
import { getBudgetStatus } from "@/lib/utils/project-budget-status";
import { DataTable } from "../common/data-table";
import { StatusPill } from "../common/status-pill";
import { Button } from "../ui/button";
import { TableCard } from "../common/list-toolbar";
import { projectDetailHref } from "./projects-list-url";

interface FinancialTabProps {
  project: ProjectWithStats;
  /** Closes the quick view, so the link does not leave it open behind. */
  onClose?: () => void;
}

/** The project page's Financials tab, keeping the list the user came from. */
function ProfitLossLink({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose?: () => void;
}) {
  const searchParams = useSearchParams();
  const fromList = usePathname() === "/projects";
  const base = projectDetailHref(
    projectId,
    fromList ? searchParams.toString() : "",
  );
  const href = `${base}${base.includes("?") ? "&" : "?"}activeTab=financials`;
  return (
    <Button asChild variant="outline" size="sm" onClick={onClose}>
      <Link href={href}>
        View profit/loss
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
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
    <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/4">
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

export function FinancialTab({ project, onClose }: FinancialTabProps) {
  // One reference date for the whole render, so two claims falling either side
  // of the same instant cannot disagree about what "overdue" means.
  const today = new Date();
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          The contract&apos;s money in and out. Activity-by-activity profit and
          loss is on the project&apos;s Financials tab.
        </p>
        <ProfitLossLink projectId={project.id} onClose={onClose} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MoneyTile label="Total budget" value={budget} />
        <MoneyTile label="Actual spend" value={spent} />
        <MoneyTile label="Approved variations" value={variation} />
        {/* Money in, as opposed to the three figures beside it, which are all
            money out or committed. */}
        <MoneyTile
          label="Cleared"
          value={Number(project.invoiceTotals.paid)}
          tone="success"
        />
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
          className="h-1.5 overflow-hidden rounded-full bg-muted"
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
        <TableCard
          header={
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">
                Invoices
              </h3>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">
                  {currency.format(Number(project.invoiceTotals.outstanding))}
                </span>{" "}
                outstanding
              </p>
            </div>
          }
        >
          <div className="p-4 md:p-0">
            {/*
          A read-only summary. This tab renders inside the quick-view modal and
          the modal manager holds one modal at a time, so opening a claim's PDF
          from here would replace the project it belongs to. The Payments tab on
          the project page is where a claim opens.
        */}
            <DataTable
              flush
              mobileLayout="cards"
              mobileColumns={1}
              headers={["Invoice", "Stage", "Amount", "Paid", "Due", "Status"]}
              align={["start", "start", "end", "end", "start", "start"]}
              caption="Progress claims raised against this project"
              rows={project.invoices.map((invoice) => [
                <span
                  key="number"
                  className="font-mono font-medium tabular-nums text-foreground"
                >
                  {invoice.invoiceNumber ?? "—"}
                </span>,
                PROJECT_STAGE_LABELS[invoice.projectStage as ProjectStage]
                  ?? invoice.projectStage,
                <span
                  key="total"
                  className="font-mono tabular-nums text-foreground"
                >
                  {currency.format(Number(invoice.total))}
                </span>,
                <span
                  key="paid"
                  className="font-mono tabular-nums text-success-ink"
                >
                  {currency.format(Number(invoice.amountPaid))}
                </span>,
                dateFormat.format(new Date(invoice.dueDate)),
                <StatusPill key="status" tone={invoiceTone(invoice, today)}>
                  {formatStatus(invoice.status)}
                </StatusPill>,
              ])}
              emptyState={
                <div className="flex flex-col items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
                    <ReceiptText
                      aria-hidden="true"
                      className="size-5 text-muted-foreground"
                    />
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      No progress claims have been raised yet
                    </p>

                    <p className="text-xs text-muted-foreground">
                      A claim is raised once every milestone in a contract stage
                      is finished.
                    </p>
                  </div>
                </div>
              }
            />
          </div>
        </TableCard>
      </section>
    </div>
  );
}
