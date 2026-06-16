import { ProjectWithStats } from "@/types/project";
import { compactCurrency, currency, dateFormat } from "@/utils/formatters";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangleIcon,
  CheckSquareIcon,
  Clock3Icon,
  Eye,
  LucideIcon,
  Receipt,
  ReceiptText,
} from "lucide-react";
import { DataTable } from "../common/data-table";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";

interface FinancialTabProps {
  project: ProjectWithStats;
}

interface Invoice {
  id: string;
  description: string;
  amount: number;
  date: string;
  status: "Paid" | "Pending" | "Overdue";
}

interface BadgeConfig {
  label: string;
  colour: string;
  icon: LucideIcon;
}

const INVOICE_STATUS_CONFIG: Record<Invoice["status"], BadgeConfig> = {
  Paid: {
    label: "Paid",
    colour: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: CheckSquareIcon,
  },

  Pending: {
    label: "Pending",
    colour: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    icon: Clock3Icon,
  },

  Overdue: {
    label: "Overdue",
    colour: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
    icon: AlertTriangleIcon,
  },
};

const MOCK_INVOICES: Invoice[] = [
  {
    id: "INV-001",
    description: "Initial deposit for project kickoff",
    amount: 25000,
    date: "2024-05-01",
    status: "Paid",
  },
  {
    id: "INV-002",
    description: "Payment for design phase",
    amount: 15000,
    date: "2024-06-01",
    status: "Pending",
  },
  {
    id: "INV-003",
    description: "Payment for development phase",
    amount: 30000,
    date: "2024-07-01",
    status: "Overdue",
  },
];

export function FinancialTab({ project }: FinancialTabProps) {
  const spent = Number(project.spent);
  const budget = Number(project.totalBudget);
  const variation = Number(project.approvedVariationSpend);
  const estProfit = budget - spent;
  const PAID_MOCK = 50_000;
  const PENDING_MOCK = 20_000;
  const OVERDUE_MOCK = 10_000;

  const invoiceRows = MOCK_INVOICES.map((invoice) => {
    const Icon = INVOICE_STATUS_CONFIG[invoice.status].icon;
    return [
      <span key={`${invoice.id}-id`} className="font-medium text-foreground">
        {invoice.id}
      </span>,
      <span key={`${invoice.id}-desc`} className="text-muted-foreground">
        {invoice.description}
      </span>,
      <span
        key={`${invoice.id}-amount`}
        className="font-semibold text-foreground"
      >
        {currency.format(invoice.amount)}
      </span>,
      <span key={`${invoice.id}-date`} className="text-muted-foreground">
        {dateFormat.format(new Date(invoice.date))}
      </span>,
      <Badge
        key={`${invoice.id}-status`}
        variant="secondary"
        className={cn(
          "gap-1 rounded-full border",
          INVOICE_STATUS_CONFIG[invoice.status].colour,
          "px-3 text-sm font-medium",
        )}
      >
        <Icon className="h-3 w-3" />
        {INVOICE_STATUS_CONFIG[invoice.status].label}
      </Badge>,
      <Button
        key={`${invoice.id}-action`}
        variant="ghost"
        size="icon"
        className="h-8"
        onClick={() => {
          toast.info(`Viewing Invoice ${invoice.id}...`);
        }}
      >
        <Eye className="mr-2 h-4 w-4" />
      </Button>,
    ];
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Total Budget */}
        <div className="rounded-lg bg-emerald-50 p-4 border border-emerald-200">
          <p className="text-xs text-emerald-700 font-medium">Total Budget</p>
          <p className="text-lg font-bold text-emerald-900 mt-1">
            {compactCurrency.format(budget)}
          </p>
        </div>
        {/* Actual Spend */}
        <div className="rounded-lg bg-amber-50 p-4 border border-amber-200">
          <p className="text-xs text-amber-700 font-medium">Actual Spend</p>
          <p className="text-lg font-bold text-amber-900 mt-1">
            {compactCurrency.format(spent)}
          </p>
        </div>

        {/* Project Variation */}
        <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
          <p className="text-xs text-blue-700 font-medium">Project Variation</p>
          <p className="text-lg font-bold text-blue-900 mt-1">
            {compactCurrency.format(variation)}
          </p>
        </div>

        {/* Est Profits */}
        <div className="rounded-lg bg-green-50 p-4 border border-green-200">
          <p className="text-xs text-green-700 font-medium">Estimated Profit</p>
          <p className="text-lg font-bold text-green-900 mt-1">
            {compactCurrency.format(estProfit)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Paid Off Costs */}
        <div className="rounded-lg bg-emerald-50 p-4 border border-emerald-200">
          <p className="text-xs text-emerald-700 font-medium">Paid</p>
          <p className="text-lg font-bold text-emerald-900 mt-1">
            {compactCurrency.format(PAID_MOCK)}
          </p>
        </div>
        {/* Pending Costs */}
        <div className="rounded-lg bg-amber-50 p-4 border border-amber-200">
          <p className="text-xs text-amber-700 font-medium">Pending</p>
          <p className="text-lg font-bold text-amber-900 mt-1">
            {compactCurrency.format(PENDING_MOCK)}
          </p>
        </div>
        {/* Overdue Cost */}
        <div className="rounded-lg bg-red-50 p-4 border border-red-200">
          <p className="text-xs text-red-700 font-medium">Overdue</p>
          <p className="text-lg font-bold text-red-900 mt-1">
            {compactCurrency.format(OVERDUE_MOCK)}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {MOCK_INVOICES.length > 0 ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="overflow-x-auto no-scrollbar">
              <DataTable
                headers={[
                  "Invoice",
                  "Description",
                  "Amount",
                  "Date",
                  "Status",
                  "Action",
                ]}
                rows={invoiceRows}
                onRowClick={(rowIndex) => {
                  const invoice = MOCK_INVOICES[rowIndex];

                  toast.info(`Viewing ${invoice.id}...`);
                }}
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
            </div>
          </div>
        ) : (
          <Card className="rounded-lg border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-14 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-muted">
                <Receipt className="h-7 w-7 text-muted-foreground" />
              </div>

              <h3 className="text-sm font-semibold text-foreground">
                No invoices yet
              </h3>

              <p className="mt-1 text-xs text-muted-foreground">
                Project is currently in{" "}
                {project.milestones.find((m) => m.status === "ACTIVE")?.name}.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
