"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FLUSH_TABLE_CARD_CLASS,
  FLUSH_TABLE_CONTENT_CLASS,
} from "@/components/ui/table-styles";
import {
  getPaymentScheduleTotalPct,
  type OfferPaymentScheduleRow,
} from "@/lib/offer/workspace-payment-schedule";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { cn } from "@/lib/utils";
import { CalendarClock, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import {
  formatCurrency,
  formatPercent,
  numberInputValue,
} from "./offer-workspace-format";

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

  function updateRow(rowId: string, patch: Partial<OfferPaymentScheduleRow>) {
    onRowsChange(
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }

  return (
    <Card
      className={cn(
        "border-border/70 bg-card/95 shadow-sm",
        FLUSH_TABLE_CARD_CLASS,
      )}
    >
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
      <CardContent
        className={cn("grid gap-3 md:gap-0", FLUSH_TABLE_CONTENT_CLASS)}
      >
        <ScheduleLock locked={locked}>
          <div>
            <Table className="payment-schedule-table md:min-w-[680px]">
              <TableCaption className="sr-only">
                Payment schedule percentages and amounts seeded for Tender
                review.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead className="w-28 text-right">%</TableHead>
                  <TableHead className="w-36 text-right">Amount</TableHead>
                  <TableHead>Trigger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="mb-1 block text-xs text-muted-foreground md:hidden">
                        Payment stage
                      </span>
                      <Input
                        aria-label={`${row.stageName} payment stage`}
                        value={row.stageName}
                        onChange={(event) =>
                          updateRow(row.id, { stageName: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <span className="mb-1 block text-xs text-muted-foreground md:hidden">
                        Contract percentage
                      </span>
                      <Input
                        aria-label={`${row.stageName} payment percent`}
                        className="text-right font-mono"
                        min="0"
                        placeholder="0"
                        step="0.5"
                        type="number"
                        value={numberInputValue(
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
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <span className="mb-1 block font-sans text-xs text-muted-foreground md:hidden">
                        Amount including GST
                      </span>
                      {formatCurrency(
                        customerPrice.selectedContractValueIncGst
                          * row.percentOfContract,
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="mb-1 block text-xs text-muted-foreground md:hidden">
                        Payment trigger
                      </span>
                      <Input
                        aria-label={`${row.stageName} payment trigger`}
                        value={row.trigger}
                        onChange={(event) =>
                          updateRow(row.id, { trigger: event.target.value })
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScheduleLock>
        <div
          className={`flex flex-wrap justify-between gap-3 rounded-lg border p-3 text-sm md:mx-4 md:mt-3 md:mb-4 ${
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
