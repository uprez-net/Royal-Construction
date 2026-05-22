import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/common/status-pill";
import { projectPaymentsMock } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Download, Send, Eye, Bell, ReceiptText } from "lucide-react";
import { currency } from "@/utils/formatters";
import { DataTable } from "@/components/common/data-table";
import { ProjectDetail } from "@/types/project";

function paymentTone(status: "Cleared" | "Pending" | "Overdue") {
  if (status === "Cleared") return "success" as const;
  if (status === "Overdue") return "danger" as const;
  return "warning" as const;
}

interface ProjectPaymentsTabProps {
  project: ProjectDetail;
}

export function ProjectPaymentsTab({ project }: ProjectPaymentsTabProps) {
  const newProject = project.milestones.length === 0;
  const summary = newProject ? {
    totalBilled: 0,
    cleared: 0,
    outstanding: 0,
    remainingContract: 0,
  } : projectPaymentsMock.summary;
  const invoices = newProject ? [] : projectPaymentsMock.invoices;

  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total Billed" value={summary.totalBilled} />
        <Metric label="Cleared" value={summary.cleared} tone="text-green-600" />
        <Metric
          label="Outstanding"
          value={summary.outstanding}
          tone="text-red-600"
        />
        <Metric label="Remaining Contract" value={summary.remainingContract} />
      </div>

      <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Invoice History
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-9 rounded-lg bg-teal-600 px-[14px] text-[12.5px] font-semibold text-white hover:bg-teal-700"
              >
                <Send className="mr-1 size-4" />
                Send Invoice
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-lg px-[14px] text-[12.5px] font-semibold"
              >
                <Download className="mr-1 size-4" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0 pb-0">
          <div className="overflow-x-auto">
            <DataTable
              headers={[
                "Invoice",
                "Milestone",
                "Amount",
                "GST",
                "Total",
                "Date Sent",
                "Date Paid",
                "Status",
                <div key="action" className="text-right">
                  Action
                </div>,
              ]}
              rows={invoices.map((invoice) => [
                <span
                  key={`${invoice.id}-invoice`}
                  className="font-semibold text-slate-900"
                >
                  {invoice.invoiceNumber}
                </span>,

                <span key={`${invoice.id}-milestone`}>
                  {invoice.milestone}
                </span>,

                <span key={`${invoice.id}-amount`}>
                  {currency.format(invoice.amount)}
                </span>,

                <span key={`${invoice.id}-gst`}>
                  {currency.format(invoice.gst)}
                </span>,

                <span
                  key={`${invoice.id}-total`}
                  className="font-medium text-slate-900"
                >
                  {currency.format(invoice.amount + invoice.gst)}
                </span>,

                <span key={`${invoice.id}-sent`}>{invoice.sentOn}</span>,

                <span key={`${invoice.id}-paid`}>{invoice.paidOn ?? "-"}</span>,

                <StatusPill
                  key={`${invoice.id}-status`}
                  tone={paymentTone(invoice.status)}
                >
                  {invoice.status}
                </StatusPill>,

                <div
                  key={`${invoice.id}-actions`}
                  className="flex justify-end gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {invoice.status !== "Cleared" && (
                    <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-[#D97706] hover:bg-amber-50 hover:text-[#D97706]">
                      <Bell className="size-3.5" />
                    </button>
                  )}

                  <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                    <Eye className="size-3.5" />
                  </button>

                  <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                    <Download className="size-3.5" />
                  </button>
                </div>,
              ])}
              onRowClick={(rowIndex) => {
                const invoice = invoices[rowIndex];

                // handle row click
                console.log(invoice);
              }}
              emptyState={
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="flex size-12 items-center justify-center">
                    <ReceiptText className="size-5 text-muted-foreground" />
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      No Invoices available yet.
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Your Invoice details will appear here.
                    </p>
                  </div>
                </div>
              }
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
      <CardContent className="p-5 flex flex-col items-center justify-center">
        <p className="text-[11.5px] font-medium text-muted-foreground mb-1">
          {label}
        </p>
        <p
          className={`text-[22px] font-extrabold leading-tight tracking-tight text-slate-900 ${tone ?? ""}`}
        >
          {currency.format(value)}
        </p>
      </CardContent>
    </Card>
  );
}
