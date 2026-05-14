import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/common/status-pill";
import { projectPaymentsMock } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Download, Send, Eye, Bell } from "lucide-react";

import { currency } from "./formatters";

function paymentTone(status: "Cleared" | "Pending" | "Overdue") {
  if (status === "Cleared") return "success" as const;
  if (status === "Overdue") return "danger" as const;
  return "warning" as const;
}

export function ProjectPaymentsTab() {
  const { summary, invoices } = projectPaymentsMock;

  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total Billed" value={summary.totalBilled} />
        <Metric label="Cleared" value={summary.cleared} tone="text-green-600" />
        <Metric label="Outstanding" value={summary.outstanding} tone="text-red-600" />
        <Metric label="Remaining Contract" value={summary.remainingContract} />
      </div>

      <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Invoice History</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" className="h-9 rounded-lg bg-teal-600 px-[14px] text-[12.5px] font-semibold text-white hover:bg-teal-700">
                <Send className="mr-1 size-4" />
                Send Invoice
              </Button>
              <Button size="sm" variant="outline" className="h-9 rounded-lg px-[14px] text-[12.5px] font-semibold">
                <Download className="mr-1 size-4" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground bg-slate-50">
                  <th className="py-2.5 px-[14px] whitespace-nowrap">Invoice</th>
                  <th className="py-2.5 px-[14px] whitespace-nowrap">Milestone</th>
                  <th className="py-2.5 px-[14px] whitespace-nowrap">Amount</th>
                  <th className="py-2.5 px-[14px] whitespace-nowrap">GST</th>
                  <th className="py-2.5 px-[14px] whitespace-nowrap">Total</th>
                  <th className="py-2.5 px-[14px] whitespace-nowrap">Date Sent</th>
                  <th className="py-2.5 px-[14px] whitespace-nowrap">Date Paid</th>
                  <th className="py-2.5 px-[14px] whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-[14px] whitespace-nowrap text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-slate-100 align-middle transition-colors hover:bg-slate-50/80 cursor-pointer">
                    <td className="py-3 px-[14px] font-semibold text-slate-900">{invoice.invoiceNumber}</td>
                    <td className="py-3 px-[14px]">{invoice.milestone}</td>
                    <td className="py-3 px-[14px]">{currency.format(invoice.amount)}</td>
                    <td className="py-3 px-[14px]">{currency.format(invoice.gst)}</td>
                    <td className="py-3 px-[14px] font-medium text-slate-900">{currency.format(invoice.amount + invoice.gst)}</td>
                    <td className="py-3 px-[14px]">{invoice.sentOn}</td>
                    <td className="py-3 px-[14px]">{invoice.paidOn ?? "-"}</td>
                    <td className="py-3 px-[14px]">
                      <StatusPill tone={paymentTone(invoice.status)}>{invoice.status}</StatusPill>
                    </td>
                    <td className="py-3 px-[14px] text-right">
                      <div className="flex justify-end gap-1.5">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
      <CardContent className="p-5 flex flex-col items-center justify-center">
        <p className="text-[11.5px] font-medium text-muted-foreground mb-1">{label}</p>
        <p className={`text-[22px] font-extrabold leading-tight tracking-tight text-slate-900 ${tone ?? ""}`}>{currency.format(value)}</p>
      </CardContent>
    </Card>
  );
}
