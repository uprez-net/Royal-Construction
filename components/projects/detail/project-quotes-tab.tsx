import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Eye, Send, Download } from "lucide-react";
import { StatusPill } from "@/components/common/status-pill";
import { quoteRequestsMock } from "@/lib/mock-data";

import { currency } from "./formatters";

function getQuoteTypeTone(type: string) {
  if (type === "Initial") return "purple" as any;
  if (type === "Variation") return "primary" as any;
  return "neutral" as any;
}

export function ProjectQuotesTab() {
  return (
    <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Project Quotations</CardTitle>
          <Button size="sm" className="h-9 rounded-lg bg-teal-600 px-[14px] text-[12.5px] font-semibold text-white hover:bg-teal-700">
            <Plus className="mr-1 size-4" />
            Create Quote
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground bg-slate-50">
                <th className="py-2.5 px-[14px] whitespace-nowrap">Quote #</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Type</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Date</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Description</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Amount</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">GST</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Total</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Sent</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Approved</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Status</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {quoteRequestsMock.map((quote) => (
                <tr key={quote.id} className="border-b border-slate-100 align-middle transition-colors hover:bg-slate-50/80 cursor-pointer">
                  <td className="py-3 px-[14px] font-semibold text-slate-900">{quote.quoteNumber}</td>
                  <td className="py-3 px-[14px]">
                    <StatusPill tone={getQuoteTypeTone(quote.type)}>{quote.type}</StatusPill>
                  </td>
                  <td className="py-3 px-[14px]">{quote.createdOn}</td>
                  <td className="py-3 px-[14px] text-slate-700">{quote.description}</td>
                  <td className="py-3 px-[14px]">{currency.format(quote.amount)}</td>
                  <td className="py-3 px-[14px]">{currency.format(quote.gst)}</td>
                  <td className="py-3 px-[14px] font-medium text-slate-900">{currency.format(quote.amount + quote.gst)}</td>
                  <td className="py-3 px-[14px]">{quote.sentOn}</td>
                  <td className="py-3 px-[14px]">{quote.approvedOn ?? "-"}</td>
                  <td className="py-3 px-[14px]">
                    <StatusPill tone={quote.status === "Approved" ? "success" : "warning"}>{quote.status}</StatusPill>
                  </td>
                  <td className="py-3 px-[14px] text-right">
                    <div className="flex justify-end gap-1.5">
                      <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                        <Eye className="size-3.5" />
                      </button>
                      <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600">
                        <Send className="size-3.5" />
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
  );
}
