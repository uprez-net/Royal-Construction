import { DataTable } from "@/components/common/data-table";
import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import { financialRows } from "@/lib/mock-data";
import { ReceiptText } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <SectionCard
        title="Financial dashboard"
        description="KPI cards, cash flow, and invoice tables all use the same data layer."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["Revenue", "$2.4M", "up"],
            ["Profit", "$186K", "up"],
            ["Costs", "$2.2M", "down"],
            ["Margin", "7.8%", "up"],
          ].map(([label, value, trend]) => (
            <MetricCard
              key={label}
              label={label}
              value={value}
              note="Quarter to date"
              tone={trend === "down" ? "danger" : "success"}
            />
          ))}
        </div>
      </SectionCard>
      <SectionCard
        title="Project P&L"
        description="Financial rows are composable and ready for chart or table rendering."
      >
        <DataTable
          headers={["Project", "Revenue", "Cost", "Margin", "Status"]}
          rows={financialRows.map((row) => [
            row.project,
            row.revenue,
            row.cost,
            row.margin,
            row.status,
          ])}
          emptyState={
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="flex size-12 items-center justify-center">
                <ReceiptText className="size-5 text-muted-foreground" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  No financial data available
                </p>

                <p className="text-xs text-muted-foreground">
                  Your Financial details will appear here.
                </p>
              </div>
            </div>
          }
        />
      </SectionCard>
    </div>
  );
}
