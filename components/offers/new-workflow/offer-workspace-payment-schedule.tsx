"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getPaymentScheduleTotalPct,
  type OfferPaymentScheduleRow,
} from "@/lib/offer/workspace-payment-schedule";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { CalendarClock } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency, formatPercent } from "./offer-workspace-format";

type PaymentSchedulePanelProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly rows: readonly OfferPaymentScheduleRow[];
  readonly onRowsChange: (rows: readonly OfferPaymentScheduleRow[]) => void;
};

export function PaymentSchedulePanel({
  customerPrice,
  rows,
  onRowsChange,
}: PaymentSchedulePanelProps) {
  const totalPct = getPaymentScheduleTotalPct(rows);

  function updateRow(
    rowId: string,
    patch: Partial<OfferPaymentScheduleRow>,
  ) {
    onRowsChange(
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Seed the Tender payment schedule from the selected Offer price; actual payments remain a handoff/Project concern."
          icon={<CalendarClock className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Tender payment schedule seed"
        />
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[680px] text-sm">
            <caption className="sr-only">
              Payment schedule percentages and amounts seeded for Tender
              review.
            </caption>
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Stage</th>
                <th className="w-28 px-3 py-2 text-right font-medium">%</th>
                <th className="w-36 px-3 py-2 text-right font-medium">
                  Amount
                </th>
                <th className="px-3 py-2 text-left font-medium">Trigger</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`${row.stageName} payment stage`}
                      value={row.stageName}
                      onChange={(event) =>
                        updateRow(row.id, { stageName: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`${row.stageName} payment percent`}
                      className="text-right font-mono"
                      min="0"
                      step="0.5"
                      type="number"
                      value={String(
                        Math.round(row.percentOfContract * 1000) / 10,
                      )}
                      onChange={(event) => {
                        const parsed = parseNonNegativeNumberInput(
                          event.target.value,
                        );
                        if (parsed !== null) {
                          updateRow(row.id, {
                            percentOfContract: parsed / 100,
                          });
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatCurrency(
                      customerPrice.selectedContractValueIncGst *
                        row.percentOfContract,
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`${row.stageName} payment trigger`}
                      value={row.trigger}
                      onChange={(event) =>
                        updateRow(row.id, { trigger: event.target.value })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-between gap-3 rounded-lg border border-border bg-background/70 p-3 text-sm">
          <span className="text-muted-foreground">
            Schedule total {formatPercent(totalPct)}
          </span>
          <span className="font-mono font-semibold">
            {formatCurrency(customerPrice.selectedContractValueIncGst)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
