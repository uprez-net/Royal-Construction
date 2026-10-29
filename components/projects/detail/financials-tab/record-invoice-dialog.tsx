"use client";

import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  recordTradieInvoiceAction,
  type ProjectFinancialsResult,
} from "@/lib/data/project-financials";

import { formatCents } from "./money";

export type BookingOption = {
  readonly id: string;
  readonly label: string;
  readonly tradieId: string;
};

/** Dollars typed into a field, as whole cents; null when it is not a number. */
function cents(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/**
 * Record an invoice a tradie sent by email or on paper, against the booking
 * it bills. A bill the bookkeeper enters in Xero arrives on its own; if it is
 * also typed in here, the Xero copy is matched to this one by its number
 * rather than counted twice.
 */
export function RecordInvoiceDialog({
  open,
  onOpenChange,
  projectId,
  bookings,
  initialScheduleId,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  bookings: readonly BookingOption[];
  initialScheduleId: string | null;
  onRecorded: (result: Extract<ProjectFinancialsResult, { ok: true }>) => void;
}) {
  const [scheduleId, setScheduleId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [subTotal, setSubTotal] = useState("");
  const [gst, setGst] = useState("");
  // GST follows the amount at 10% until someone types their own.
  const [gstTouched, setGstTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<{
    message: string;
    field?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Each opening starts clean, on the booking it was opened from. Adjusted
  // while rendering, on the change of `open`, rather than in an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setScheduleId(initialScheduleId ?? "");
      setInvoiceNumber("");
      setIssuedDate(format(new Date(), "yyyy-MM-dd"));
      setDueDate("");
      setSubTotal("");
      setGst("");
      setGstTouched(false);
      setNotes("");
      setError(null);
    }
  }

  const subTotalCents = cents(subTotal);
  const gstCents = gstTouched
    ? cents(gst)
    : subTotalCents === null
      ? null
      : Math.round(subTotalCents / 10);
  const totalCents =
    subTotalCents !== null && gstCents !== null
      ? subTotalCents + gstCents
      : null;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await recordTradieInvoiceAction({
        dueDate: dueDate || undefined,
        invoiceNumber,
        issuedDate,
        notes: notes || undefined,
        projectId,
        scheduleId,
        subTotal: subTotalCents === null ? "" : subTotalCents / 100,
        totalTax: gstCents === null ? "" : gstCents / 100,
      });
      if (!result.ok) {
        setError({ field: result.field, message: result.error });
        return;
      }
      onRecorded(result);
      onOpenChange(false);
    } catch {
      setError({ message: "The invoice could not be recorded. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (field: string) =>
    error?.field === field ? `record-invoice-error` : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Record a tradie invoice</DialogTitle>
            <DialogDescription>
              For an invoice that came by email or on paper. Bills entered in
              Xero come through on their own.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="record-invoice-booking">Booking</Label>
            <Select value={scheduleId} onValueChange={setScheduleId}>
              <SelectTrigger
                id="record-invoice-booking"
                className="w-full"
                aria-describedby={fieldError("scheduleId")}
              >
                <SelectValue placeholder="Choose the booking it bills" />
              </SelectTrigger>
              <SelectContent>
                {bookings.map((booking) => (
                  <SelectItem key={booking.id} value={booking.id}>
                    {booking.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="record-invoice-number">Invoice number</Label>
              <Input
                id="record-invoice-number"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                autoComplete="off"
                aria-describedby={fieldError("invoiceNumber")}
                aria-invalid={error?.field === "invoiceNumber" || undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="record-invoice-date">Invoice date</Label>
              <Input
                id="record-invoice-date"
                type="date"
                value={issuedDate}
                onChange={(event) => setIssuedDate(event.target.value)}
                aria-describedby={fieldError("issuedDate")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="record-invoice-amount">Amount ex GST</Label>
              <Input
                id="record-invoice-amount"
                inputMode="decimal"
                value={subTotal}
                onChange={(event) => setSubTotal(event.target.value)}
                placeholder="0.00"
                aria-describedby={fieldError("subTotal")}
                aria-invalid={error?.field === "subTotal" || undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="record-invoice-gst">GST</Label>
              <Input
                id="record-invoice-gst"
                inputMode="decimal"
                value={
                  gstTouched
                    ? gst
                    : gstCents === null
                      ? ""
                      : (gstCents / 100).toFixed(2)
                }
                onChange={(event) => {
                  setGstTouched(true);
                  setGst(event.target.value);
                }}
                placeholder="0.00"
                aria-describedby="record-invoice-gst-hint"
                aria-invalid={error?.field === "totalTax" || undefined}
              />
              <p
                id="record-invoice-gst-hint"
                className="text-xs text-muted-foreground"
              >
                10% unless you change it. 0 if the tradie is not registered.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="record-invoice-due">Due date (optional)</Label>
              <Input
                id="record-invoice-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                aria-describedby={fieldError("dueDate")}
              />
            </div>
            <div className="flex flex-col justify-end text-sm">
              <span className="text-muted-foreground">Total inc GST</span>
              <span className="font-mono text-lg tabular-nums text-foreground">
                {totalCents === null ? "—" : formatCents(totalCents)}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="record-invoice-notes">Notes (optional)</Label>
            <Textarea
              id="record-invoice-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
            />
          </div>

          {error ? (
            <p
              id="record-invoice-error"
              role="alert"
              className="text-sm font-medium text-destructive-ink"
            >
              {error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Record invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
