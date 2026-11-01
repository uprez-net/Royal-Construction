"use client";

import { CheckCircle2, FileText, Mail, XCircle } from "lucide-react";
import { useState } from "react";

import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { EmailedTradieInvoice } from "@/lib/domain/tradies/invoice-inbox";
import { dateFormat } from "@/utils/formatters";

import { formatCents } from "./money";
import type { BookingOption } from "./record-invoice-dialog";

/**
 * Tradie invoices that arrived by email, read off the attachment and matched
 * to this project, waiting for the office. None of them counts in Total
 * invoiced until it is confirmed through the Record invoice dialog, where
 * every field the reader filled can be checked against the document.
 */
export function EmailedInvoices({
  invoices,
  bookings,
  onConfirm,
  onDismiss,
}: {
  invoices: readonly EmailedTradieInvoice[];
  bookings: readonly BookingOption[];
  onConfirm: (invoice: EmailedTradieInvoice) => void;
  onDismiss: (invoice: EmailedTradieInvoice) => void;
}) {
  const [dismissing, setDismissing] = useState<EmailedTradieInvoice | null>(
    null,
  );
  const bookingLabel = (scheduleId: string | null) =>
    bookings.find((booking) => booking.id === scheduleId)?.label ?? null;

  return (
    <SectionCard
      title="Invoices received by email"
      description="Read off tradies' emails and matched to this project. They count in no figure until you check and record them."
      titleAs="h3"
    >
      <ul className="divide-y divide-border/70 rounded-lg border border-border/70 bg-card">
        {invoices.map((invoice) => {
          const booking = bookingLabel(invoice.scheduleId);
          return (
            <li
              key={invoice.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm"
            >
              <Mail
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block">
                  <span className="font-medium text-foreground">
                    {invoice.tradieName}
                  </span>{" "}
                  <span className="font-mono text-foreground">
                    {invoice.invoiceNumber ?? "No number read"}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  Received{" "}
                  <span className="font-mono tabular-nums">
                    {dateFormat.format(new Date(invoice.receivedAt))}
                  </span>{" "}
                  ·{" "}
                  {booking ?? "No booking matched — choose one when recording"}
                </span>
              </span>
              <StatusPill tone="warning">To confirm</StatusPill>
              <span className="text-right">
                <span className="font-mono tabular-nums text-foreground">
                  {invoice.subTotalCents === null
                    ? "Amount not read"
                    : formatCents(invoice.subTotalCents)}
                </span>
                {invoice.subTotalCents !== null ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ex GST
                  </span>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={invoice.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={invoice.documentName}
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    Document
                  </a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onConfirm(invoice)}
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Check and record
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDismissing(invoice)}
                  aria-label={`Set aside ${invoice.tradieName}'s emailed invoice ${invoice.invoiceNumber ?? ""}`}
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  Set aside
                </Button>
              </span>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={dismissing !== null}
        onOpenChange={(open) => {
          if (!open) setDismissing(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set this emailed invoice aside?</AlertDialogTitle>
            <AlertDialogDescription>
              {dismissing?.tradieName}&apos;s invoice{" "}
              {dismissing?.invoiceNumber ?? ""} will not be recorded on this
              project — for a duplicate, or one that is not this job&apos;s. The
              email stays in Outlook.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (dismissing) onDismiss(dismissing);
                setDismissing(null);
              }}
            >
              Set aside
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
