import { DataTable } from "@/components/common/data-table";
import { SectionCard } from "@/components/common/section-card";
import { quoteRows } from "@/lib/mock-data";
import { ReceiptText } from "lucide-react";

export default function QuotationsPage() {
  return (
    <SectionCard
      title="Quotation management"
      description="Reusable row components support tables, previews, and approval workflows."
    >
      <DataTable
        headers={["Quote", "Client", "Value", "Status", "Expiry"]}
        rows={quoteRows.map((row) => [
          row.quote,
          row.client,
          row.value,
          row.status,
          row.expiry,
        ])}
        emptyState={
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="flex size-12 items-center justify-center">
              <ReceiptText className="size-5 text-muted-foreground" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                No quotations available
              </p>

              <p className="text-xs text-muted-foreground">
                Your Quotations will appear here.
              </p>
            </div>
          </div>
        }
      />
    </SectionCard>
  );
}
