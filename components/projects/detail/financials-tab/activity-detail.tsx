"use client";

import {
  AlertTriangle,
  Ban,
  FilePlus2,
  FileText,
  MailQuestion,
  Plus,
} from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import type {
  FinancialBooking,
  FinancialInvoice,
} from "@/lib/domain/projects/financial-report";
import {
  BILLING_STATE_LABELS,
  type BookingBillingState,
} from "@/lib/domain/tradies/billing-rules";
import { dateFormat, formatStatus } from "@/utils/formatters";

import { formatCents, Money } from "./money";

const BILLING_TONE: Record<
  BookingBillingState,
  "neutral" | "primary" | "success" | "warning" | "danger"
> = {
  INVOICED: "success",
  INVOICED_UNPRICED: "warning",
  NOT_INVOICED: "neutral",
  OVER_INVOICED: "danger",
  PART_INVOICED: "primary",
};

export function BillingPill({ state }: { state: BookingBillingState }) {
  return (
    <StatusPill tone={BILLING_TONE[state]}>
      {BILLING_STATE_LABELS[state]}
    </StatusPill>
  );
}

function day(value: string | null) {
  return value ? dateFormat.format(new Date(value)) : null;
}

/** What the tradie's quoted figure is made of, when it is not simply a quote. */
function priceNote(booking: FinancialBooking): string | null {
  if (!booking.committed)
    return "Not committed: billed without an approved booking";
  if (booking.priceBasis === "NONE") return "No price recorded yet";
  if (booking.priceBasis === "RATE") return "Estimated from the tradie's rate";
  if (!booking.gstStated) return "Quote did not state GST; read as ex GST";
  return null;
}

export type InvoiceActions = {
  readonly onRecord: (scheduleId: string) => void;
  readonly onVoid: (invoice: FinancialInvoice) => void;
  /** Email the tradie to recheck invoices over their approved quote. */
  readonly onRecheck: (scheduleId: string) => void;
  /** Raise a variation on an activity, opened on that activity. */
  readonly onVariation: (milestoneId: string) => void;
};

export function InvoiceList({
  invoices,
  onVoid,
}: {
  invoices: readonly FinancialInvoice[];
  onVoid?: (invoice: FinancialInvoice) => void;
}) {
  if (invoices.length === 0) {
    return <p className="text-sm text-muted-foreground">No invoices yet.</p>;
  }
  return (
    <ul className="divide-y divide-border/70 rounded-lg border border-border/70 bg-card">
      {invoices.map((invoice) => (
        <li
          key={invoice.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">
            <span className="font-mono font-medium text-foreground">
              {invoice.invoiceNumber ?? "No number"}
            </span>
            <span className="ml-2 text-muted-foreground">
              {invoice.tradieName} · issued{" "}
              <span className="font-mono tabular-nums">
                {day(invoice.issuedDate)}
              </span>
              {invoice.dueDate ? (
                <>
                  {" "}
                  · due{" "}
                  <span className="font-mono tabular-nums">
                    {day(invoice.dueDate)}
                  </span>
                </>
              ) : null}
            </span>
          </span>
          {invoice.documentUrl ? (
            <a
              href={invoice.documentUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
              title={invoice.documentName ?? undefined}
            >
              <FileText className="size-3.5" aria-hidden="true" />
              Invoice document
            </a>
          ) : null}
          <StatusPill tone={invoice.source === "XERO" ? "purple" : "neutral"}>
            {invoice.source === "XERO" ? "Xero" : "Recorded by hand"}
          </StatusPill>
          {invoice.counted ? (
            invoice.status === "PAID" ? (
              <StatusPill tone="success">Paid</StatusPill>
            ) : invoice.status === "DRAFT" ? (
              <StatusPill tone="warning">Draft in Xero</StatusPill>
            ) : null
          ) : (
            <StatusPill tone="neutral">
              {formatStatus(invoice.status)}
            </StatusPill>
          )}
          <span className="text-right">
            <Money
              cents={invoice.subTotalCents}
              muted={!invoice.counted}
              className={invoice.counted ? undefined : "line-through"}
            />
            <span className="ml-1 text-xs text-muted-foreground">
              ex GST · {formatCents(invoice.totalCents)} inc
            </span>
          </span>
          {onVoid && invoice.counted && invoice.source === "MANUAL" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onVoid(invoice)}
              aria-label={`Void invoice ${invoice.invoiceNumber ?? ""}`}
            >
              <Ban className="size-4" aria-hidden="true" />
              Void
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One activity's bookings and the invoices against each: what the row's
 * figures are made of, and where an invoice is recorded.
 */
export function ActivityDetail({
  bookings,
  actions,
  hasChildren,
}: {
  bookings: readonly FinancialBooking[];
  actions: InvoiceActions;
  hasChildren: boolean;
}) {
  if (bookings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {hasChildren
          ? "No tradie is booked on this activity itself; its figures are its sub-activities', listed below."
          : "No tradie is booked on this activity yet. Its quoted and invoiced amounts follow once one is approved on the Tradies tab."}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {hasChildren ? (
        <p className="text-xs text-muted-foreground">
          Booked on this activity itself. Its sub-activities are listed below.
        </p>
      ) : null}
      {bookings.map((booking) => {
        const note = priceNote(booking);
        return (
          <section
            key={booking.id}
            aria-label={`${booking.tradieName} booking`}
            className="space-y-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">
                {booking.tradieName}
              </h4>
              {booking.trade ? (
                <span className="text-sm text-muted-foreground">
                  {booking.trade}
                </span>
              ) : null}
              <StatusPill tone="neutral">
                {formatStatus(booking.status)}
              </StatusPill>
              <BillingPill state={booking.billing} />
              <span className="ml-auto flex flex-wrap items-center gap-3 text-sm">
                <span>
                  <span className="text-muted-foreground">Quoted </span>
                  <Money cents={booking.agreedCents} />
                </span>
                <span>
                  <span className="text-muted-foreground">Invoiced </span>
                  <Money cents={booking.invoicedCents} />
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => actions.onRecord(booking.id)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Record invoice
                </Button>
              </span>
            </div>
            {booking.billing === "OVER_INVOICED" ? (
              <div
                role="note"
                className="space-y-2 rounded-md bg-destructive-light px-3 py-2 text-sm text-destructive-ink"
              >
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle
                    className="size-4 shrink-0"
                    aria-hidden="true"
                  />
                  Invoiced exceeds quoted by{" "}
                  <span className="font-mono tabular-nums">
                    {formatCents(booking.invoicedCents - booking.agreedCents)}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-card"
                    onClick={() => actions.onRecheck(booking.id)}
                    // A rate estimate is our number, not one the tradie gave.
                    disabled={booking.priceBasis !== "QUOTE"}
                  >
                    <MailQuestion className="size-4" aria-hidden="true" />
                    Request recheck
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-card"
                    // A booking on no activity has no price to vary.
                    disabled={!booking.milestoneId}
                    onClick={() => {
                      if (booking.milestoneId) {
                        actions.onVariation(booking.milestoneId);
                      }
                    }}
                  >
                    <FilePlus2 className="size-4" aria-hidden="true" />
                    Raise variation
                  </Button>
                  {booking.priceBasis !== "QUOTE" || !booking.milestoneId ? (
                    <span className="text-xs text-muted-foreground">
                      {booking.priceBasis !== "QUOTE"
                        ? "Record the agreed price to request a recheck. "
                        : ""}
                      {!booking.milestoneId
                        ? "Book it against an activity to raise a variation."
                        : ""}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {note ? (
              <p className="text-xs text-muted-foreground">{note}</p>
            ) : null}
            <InvoiceList invoices={booking.invoices} onVoid={actions.onVoid} />
          </section>
        );
      })}
    </div>
  );
}
