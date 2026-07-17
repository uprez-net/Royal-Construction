"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getPaymentScheduleTotalPct,
  type OfferPaymentScheduleRow,
} from "@/lib/offer/workspace-payment-schedule";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { CalendarClock, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency, formatPercent } from "./offer-workspace-format";

type PaymentSchedulePanelProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly rows: readonly OfferPaymentScheduleRow[];
  readonly onRowsChange: (rows: readonly OfferPaymentScheduleRow[]) => void;
  // Frozen once the Tender envelope is out for signature (tender_sent onward):
  // the schedule is baked into the sent Tender, so the inputs lock while the
  // Tender action buttons (Recall, Mark signed) stay live.
  readonly locked?: boolean;
};

export function PaymentSchedulePanel({
  customerPrice,
  rows,
  onRowsChange,
  locked = false,
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Seed the Tender payment schedule from the selected Offer price; actual payments remain a handoff/Project concern."
            icon={<CalendarClock className="size-4" aria-hidden="true" />}
            singleLineDescription
            title="Tender payment schedule seed"
          />
          {locked ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <Lock className="size-3" aria-hidden="true" />
              Locked
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        <ScheduleLock locked={locked}>
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
        </ScheduleLock>
        <div
          className={`flex flex-wrap justify-between gap-3 rounded-lg border p-3 text-sm ${
            totalPct === 1
              ? "border-border bg-background/70"
              : "border-destructive/50 bg-destructive-light"
          }`}
        >
          <span
            className={
              totalPct === 1
                ? "text-muted-foreground"
                : "font-medium text-destructive"
            }
          >
            Schedule total {formatPercent(totalPct)}
            {totalPct === 1 ? "" : " — must total 100%"}
          </span>
          <span className="font-mono font-semibold">
            {formatCurrency(customerPrice.selectedContractValueIncGst)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Content-level lock: wraps the schedule table (not the whole panel) in a
// disabled fieldset so its inputs freeze while the Tender action buttons around
// it stay live. Fieldset can't be nested inside a table, so it wraps the
// container div. Values stay legible — this is a record to read, not a
// temporarily-unavailable form.
function ScheduleLock({
  locked,
  children,
}: {
  readonly locked: boolean;
  readonly children: ReactNode;
}) {
  if (!locked) {
    return <>{children}</>;
  }
  return (
    <fieldset
      disabled
      className="m-0 min-w-0 border-0 p-0 [&_:disabled]:cursor-default [&_input:disabled]:opacity-100"
    >
      {children}
    </fieldset>
  );
}
