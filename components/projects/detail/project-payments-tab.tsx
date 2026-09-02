"use client";

import { useMemo } from "react";

import type { ProjectStage } from "@prisma/client";
import { Banknote, CircleDollarSign, FileText, ReceiptText, Wallet } from "lucide-react";

import { DataTable } from "@/components/common/data-table";
import { METRIC_TONES, type MetricTone } from "@/components/common/metric-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { countPendingInvoices, invoiceTone } from "@/lib/projects/invoice-display";
import { summarizeInvoices } from "@/lib/projects/invoice-totals";
import { contractClaimTotal, resolveStageClaims } from "@/lib/projects/stage-claim";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import { PROJECT_STAGE_LABELS, type ProjectDetail, type SafeInvoice } from "@/types/project";
import { filePreviewModal } from "@/utils/file-preview";
import { currency, dateFormat, formatStatus } from "@/utils/formatters";

interface ProjectPaymentsTabProps {
  project: ProjectDetail;
}

const CARD_SURFACE = "rounded-xl border border-border/70 bg-card p-5 shadow-sm";
const CARD_VALUE =
  "mt-2 font-heading text-3xl font-semibold leading-tight tracking-tight tabular-nums text-foreground";
const CARD_LABEL = "mt-1 text-xs text-muted-foreground";
const ICON_CONTAINER =
  "flex size-11 items-center justify-center rounded-2xl text-white";

/**
 * Money that may legitimately be unknown.
 *
 * `Number(null)` and `Number("")` are both 0, so a missing figure would
 * otherwise render as "$0" — a number this project does not actually hold.
 */
function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? currency.format(parsed) : null;
}

/**
 * The mono slot is reserved for real values (DESIGN.md Mono Precision Rule), so
 * a missing one renders as a plain dash carrying a spoken label — a bare "—" in
 * a mono cell announces as nothing at all.
 */
const NoValueCell = ({ label }: { label: string }) => (
  <span className="text-muted-foreground">
    <span aria-hidden="true">&mdash;</span>
    <span className="sr-only">{label}</span>
  </span>
);

const MoneyCell = ({
  value,
  label,
  className,
}: {
  value: string | number | null | undefined;
  label: string;
  className?: string;
}) => {
  const formatted = money(value);

  return formatted ? (
    <span className={className ?? "font-mono tabular-nums text-foreground"}>
      {formatted}
    </span>
  ) : (
    <NoValueCell label={label} />
  );
};

const StatCard = ({
  label,
  value,
  caption,
  Icon,
  tone,
}: {
  label: string;
  value: string | null;
  caption: string;
  Icon: typeof ReceiptText;
  tone: MetricTone;
}) => (
  <div className={CARD_SURFACE}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={CARD_VALUE}>{value ?? <span aria-hidden="true">&mdash;</span>}</p>
        <p className={CARD_LABEL}>{value ? caption : "Not recorded"}</p>
      </div>
      <span className={cn(ICON_CONTAINER, METRIC_TONES[tone])}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
    </div>
  </div>
);

export function ProjectPaymentsTab({ project }: ProjectPaymentsTabProps) {
  const dispatch = useAppDispatch();

  // The same resolver the Milestones tab and the invoice generator use, so the
  // contract total here can never disagree with the stage claims shown there.
  const contractTotal = useMemo(
    () =>
      contractClaimTotal(
        resolveStageClaims(
          project.requirements?.commercialsAndClaims?.paymentStages,
          Number(project.totalBudget),
        ),
      ),
    [project.requirements, project.totalBudget],
  );

  const totals = useMemo(
    () => summarizeInvoices(project.invoices),
    [project.invoices],
  );

  // One reference date for the whole render — see `invoice-display`.
  const today = new Date();
  const { pending: pendingCount } = countPendingInvoices(project.invoices, today);

  const openInvoice = (invoice: SafeInvoice) => {
    if (!invoice.pdfUrl) {
      return;
    }

    // Routed through the shared chooser so the PDF opens in our own viewer.
    // Nothing here ever navigates the browser to a raw blob URL.
    const action = filePreviewModal(
      [
        {
          url: invoice.pdfUrl,
          name: `${invoice.invoiceNumber ?? "Invoice"}.pdf`,
          fileType: "application/pdf",
        },
      ],
      0,
    );
    if (action) {
      dispatch(openModal(action));
    }
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Contract total"
          value={money(contractTotal)}
          caption="Whole claim schedule"
          Icon={CircleDollarSign}
          tone="primary"
        />
        <StatCard
          label="Invoiced"
          value={money(totals.invoiced)}
          caption={`${project.invoices.length} claims raised`}
          Icon={ReceiptText}
          tone="accent"
        />
        <StatCard
          label="Cleared"
          value={money(totals.paid)}
          caption="Received from the owner"
          Icon={Banknote}
          tone="success"
        />
        <StatCard
          label="Outstanding"
          value={money(totals.outstanding)}
          caption={
            pendingCount === 1 ? "1 claim unpaid" : `${pendingCount} claims unpaid`
          }
          Icon={Wallet}
          tone="warning"
        />
      </div>

      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle as="h2" className="text-base font-semibold text-foreground">
            Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <DataTable
            caption={`Progress claims raised for ${project.name}`}
            headers={[
              "Invoice",
              "Stage",
              "Issued",
              "Due",
              "Total",
              "Paid",
              "Outstanding",
              "Status",
              <span key="actions" className="sr-only">
                Actions
              </span>,
            ]}
            align={[
              "start",
              "start",
              "start",
              "start",
              "end",
              "end",
              "end",
              "start",
              "end",
            ]}
            rows={project.invoices.map((invoice) => [
              <span
                key="number"
                className="font-mono font-medium tabular-nums text-foreground"
              >
                {invoice.invoiceNumber ?? (
                  <NoValueCell label="Invoice number not yet assigned" />
                )}
              </span>,
              PROJECT_STAGE_LABELS[invoice.projectStage as ProjectStage] ??
                invoice.projectStage,
              dateFormat.format(new Date(invoice.issuedDate)),
              dateFormat.format(new Date(invoice.dueDate)),
              <MoneyCell key="total" value={invoice.total} label="No total recorded" />,
              <MoneyCell
                key="paid"
                value={invoice.amountPaid}
                label="Nothing paid yet"
                className="font-mono tabular-nums text-success-ink"
              />,
              <MoneyCell
                key="due"
                value={invoice.amountDue}
                label="Nothing outstanding"
              />,
              <StatusPill key="status" tone={invoiceTone(invoice, today)}>
                {formatStatus(invoice.status)}
              </StatusPill>,
              // A per-row control rather than a clickable row: `DataTable`'s
              // row click is all-or-nothing, and a claim whose PDF has not been
              // archived yet has nothing to open. A dead row that still looks
              // clickable is worse than a button that is simply absent.
              invoice.pdfUrl ? (
                <Button
                  key="view"
                  size="sm"
                  variant="outline"
                  onClick={() => openInvoice(invoice)}
                >
                  <FileText className="size-4" aria-hidden="true" />
                  View
                  <span className="sr-only">
                    {` invoice ${invoice.invoiceNumber ?? ""}`}
                  </span>
                </Button>
              ) : (
                <NoValueCell key="view" label="No PDF archived yet" />
              ),
            ])}
            emptyState={
              <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-8 text-center">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
                  <ReceiptText
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>

                <p className="text-base font-semibold text-foreground">
                  No progress claims have been raised yet
                </p>

                <p className="text-sm text-muted-foreground">
                  A claim is raised in Xero automatically once every milestone in
                  a contract stage is finished. The claim schedule is on the
                  Milestones tab.
                </p>
              </div>
            }
          />
        </CardContent>
      </Card>
    </section>
  );
}
