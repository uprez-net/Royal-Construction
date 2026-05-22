import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Eye, Send, Download, Receipt } from "lucide-react";
import { StatusPill } from "@/components/common/status-pill";
import { quoteRequestsMock } from "@/lib/mock-data";

import { currency } from "@/utils/formatters";
import { ProjectDetail } from "@/types/project";
import { DataTable } from "@/components/common/data-table";

function getQuoteTypeTone(type: string) {
  if (type === "Initial") return "purple" as const;
  if (type === "Variation") return "primary" as const;
  return "neutral" as const;
}

interface ProjectQuotesTabProps {
  project: ProjectDetail;
}

export function ProjectQuotesTab({ project }: ProjectQuotesTabProps) {
  const newProject = project.milestones.length === 0;
  const quoteRequests = newProject ? [] : quoteRequestsMock;

  return (
    <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Project Quotations
          </CardTitle>
          <Button
            size="sm"
            className="h-9 rounded-lg bg-teal-600 px-[14px] text-[12.5px] font-semibold text-white hover:bg-teal-700"
          >
            <Plus className="mr-1 size-4" />
            Create Quote
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-0 pb-0">
        <div className="overflow-x-auto">
          <DataTable
            headers={[
              "Quote #",
              "Type",
              "Date",
              "Description",
              "Amount",
              "GST",
              "Total",
              "Sent",
              "Approved",
              "Status",
              <div key="action" className="text-right">
                Action
              </div>,
            ]}
            rows={quoteRequests.map((quote) => [
              <span
                key={`${quote.id}-number`}
                className="font-semibold text-slate-900"
              >
                {quote.quoteNumber}
              </span>,

              <StatusPill
                key={`${quote.id}-type`}
                tone={getQuoteTypeTone(quote.type)}
              >
                {quote.type}
              </StatusPill>,

              <span key={`${quote.id}-date`}>{quote.createdOn}</span>,

              <span key={`${quote.id}-description`} className="text-slate-700">
                {quote.description}
              </span>,

              <span key={`${quote.id}-amount`}>
                {currency.format(quote.amount)}
              </span>,

              <span key={`${quote.id}-gst`}>{currency.format(quote.gst)}</span>,

              <span
                key={`${quote.id}-total`}
                className="font-medium text-slate-900"
              >
                {currency.format(quote.amount + quote.gst)}
              </span>,

              <span key={`${quote.id}-sent`}>{quote.sentOn}</span>,

              <span key={`${quote.id}-approved`}>
                {quote.approvedOn ?? "-"}
              </span>,

              <StatusPill
                key={`${quote.id}-status`}
                tone={quote.status === "Approved" ? "success" : "warning"}
              >
                {quote.status}
              </StatusPill>,

              <div
                key={`${quote.id}-actions`}
                className="flex justify-end gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                  <Eye className="size-3.5" />
                </button>

                <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                  <Send className="size-3.5" />
                </button>

                <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                  <Download className="size-3.5" />
                </button>
              </div>,
            ])}
            onRowClick={(rowIndex) => {
              const quote = quoteRequests[rowIndex];

              // handle quote click
              console.log(quote);
            }}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <Receipt className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No Quote Data available yet.
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your Quote details will appear here.
                  </p>
                </div>
              </div>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
