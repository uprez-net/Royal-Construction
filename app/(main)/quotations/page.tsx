import { DataTable } from "@/components/common/data-table";
import { SectionCard } from "@/components/common/section-card";
import { quoteRows } from "@/lib/mock-data";

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
      />
    </SectionCard>
  );
}
