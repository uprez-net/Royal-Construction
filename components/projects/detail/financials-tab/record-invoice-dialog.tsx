"use client";

import { upload } from "@vercel/blob/client";
import { format } from "date-fns";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
} from "react";

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
  readTradieInvoiceDocumentAction,
  recordTradieInvoiceAction,
  type ProjectFinancialsResult,
} from "@/lib/data/project-financials";
import type { TradieInvoiceDocumentFields } from "@/lib/domain/tradies/invoice-document";
import {
  TRADIE_INVOICE_DOCUMENT_TYPES,
  tradieInvoiceDocumentFolder,
} from "@/lib/domain/tradies/invoice-document-files";
import type { ClientPayload } from "@/utils/validators";

import { formatCents } from "./money";
import { fileHref } from "@/lib/files/file-href";

/** An emailed invoice the dialog opens on, to check and record. */
export type RecordInvoicePrefill = {
  readonly inboxId: string;
  readonly scheduleId: string | null;
  readonly invoiceNumber: string | null;
  /** YYYY-MM-DD. */
  readonly issuedDate: string | null;
  readonly dueDate: string | null;
  readonly subTotalCents: number | null;
  readonly totalTaxCents: number | null;
  readonly document: { readonly name: string; readonly url: string };
  /** ISO: when the email arrived. */
  readonly receivedAt: string;
};

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

type DocumentState =
  | { readonly status: "none" }
  | {
      readonly status: "uploading";
      readonly name: string;
      readonly progress: number;
    }
  | { readonly status: "reading"; readonly name: string; readonly url: string }
  | {
      readonly status: "ready";
      readonly name: string;
      readonly url: string;
      /** What the read filled in, or why it could not. */
      readonly note: string;
      readonly filled: boolean;
    }
  | {
      readonly status: "failed";
      readonly name: string;
      readonly message: string;
    };

/** The one booking whose tradie the invoice is from, if exactly one matches. */
function bookingForSupplier(
  bookings: readonly BookingOption[],
  supplier: string | null,
): string | null {
  const name = supplier?.trim().toLowerCase();
  if (!name) return null;
  const matches = bookings.filter((booking) => {
    // Labels read "Tradie name — Stage › Activity".
    const tradie = booking.label.split(" — ")[0]?.trim().toLowerCase() ?? "";
    return tradie !== "" && (name.includes(tradie) || tradie.includes(name));
  });
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Record an invoice a tradie sent by email or on paper, against the booking
 * it bills. A bill the bookkeeper enters in Xero arrives on its own; if it is
 * also typed in here, the Xero copy is matched to this one by its number
 * rather than counted twice.
 *
 * The tradie's invoice document can be uploaded with it: it is kept against
 * the invoice, and read to fill in the form, which the office then checks.
 */
export function RecordInvoiceDialog({
  open,
  onOpenChange,
  projectId,
  bookings,
  initialScheduleId,
  prefill = null,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  bookings: readonly BookingOption[];
  initialScheduleId: string | null;
  /** Opened from an emailed invoice: its fields, its document, its entry. */
  prefill?: RecordInvoicePrefill | null;
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
  const [document, setDocument] = useState<DocumentState>({ status: "none" });
  const fileInput = useRef<HTMLInputElement>(null);
  // Bumped on every new file, removal, opening and closing, so a slow read of
  // a file already replaced — or from before the dialog was closed — cannot
  // fill the form with the wrong invoice or attach it.
  const documentRun = useRef(0);
  // The read during which the person last picked a booking themselves. The
  // supplier match below must not replace a booking chosen while it ran.
  const bookingPickedInRun = useRef<number | null>(null);
  function chooseBooking(value: string) {
    bookingPickedInRun.current = documentRun.current;
    setScheduleId(value);
  }
  useEffect(() => {
    documentRun.current += 1;
  }, [open]);

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
      setDocument({ status: "none" });
      if (prefill) {
        setScheduleId(prefill.scheduleId ?? initialScheduleId ?? "");
        setInvoiceNumber(prefill.invoiceNumber ?? "");
        if (prefill.issuedDate) setIssuedDate(prefill.issuedDate);
        setDueDate(prefill.dueDate ?? "");
        setSubTotal(
          prefill.subTotalCents === null
            ? ""
            : (prefill.subTotalCents / 100).toFixed(2),
        );
        if (prefill.totalTaxCents !== null) {
          setGst((prefill.totalTaxCents / 100).toFixed(2));
          setGstTouched(true);
        }
        setDocument({
          filled: true,
          name: prefill.document.name,
          note: `Read from the email of ${format(new Date(prefill.receivedAt), "d MMM yyyy")}. Check every field against the document before recording.`,
          status: "ready",
          url: prefill.document.url,
        });
      }
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

  /** Fill in what the document gave; answers the names of what it filled. */
  function applyFields(
    fields: TradieInvoiceDocumentFields,
    run: number,
  ): string[] {
    const filled: string[] = [];
    if (fields.invoiceNumber) {
      setInvoiceNumber(fields.invoiceNumber);
      filled.push("invoice number");
    }
    if (fields.issuedDate) {
      setIssuedDate(fields.issuedDate);
      filled.push("date");
    }
    if (fields.dueDate) {
      setDueDate(fields.dueDate);
      filled.push("due date");
    }
    if (fields.subTotal !== null) {
      setSubTotal(fields.subTotal.toFixed(2));
      filled.push("amount");
    }
    if (fields.totalTax !== null) {
      setGst(fields.totalTax.toFixed(2));
      setGstTouched(true);
      filled.push("GST");
    }
    // `scheduleId` is as it was when the file was chosen; a booking picked
    // since is caught by the run check.
    if (!scheduleId && bookingPickedInRun.current !== run) {
      const match = bookingForSupplier(bookings, fields.supplierName);
      if (match) {
        setScheduleId(match);
        filled.push("booking");
      }
    }
    return filled;
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    documentRun.current += 1;
    const run = documentRun.current;
    const current = () => run === documentRun.current;

    if (
      !(TRADIE_INVOICE_DOCUMENT_TYPES as readonly string[]).includes(file.type)
    ) {
      setDocument({
        message: "Upload a PDF or a photo (JPG, PNG or WebP).",
        name: file.name,
        status: "failed",
      });
      return;
    }

    setDocument({ name: file.name, progress: 0, status: "uploading" });
    let url: string;
    try {
      const blob = await upload(
        `${tradieInvoiceDocumentFolder(projectId)}${file.name}`,
        file,
        {
          access: "private",
          clientPayload: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            isOfferFile: false,
            projectId,
            uploadType: "project-file",
          } satisfies ClientPayload),
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ percentage }) => {
            if (!current()) return;
            setDocument({
              name: file.name,
              progress: percentage,
              status: "uploading",
            });
          },
        },
      );
      url = blob.url;
    } catch {
      if (!current()) return;
      setDocument({
        message: "The file could not be uploaded. Try again.",
        name: file.name,
        status: "failed",
      });
      return;
    }
    if (!current()) return;
    setDocument({ name: file.name, status: "reading", url });

    let note =
      "The document is attached, but could not be read. Fill in the details by hand.";
    let filled: string[] = [];
    try {
      const result = await readTradieInvoiceDocumentAction({
        contentType: file.type,
        name: file.name,
        projectId,
        url,
      });
      if (!current()) return;
      if (result.ok) {
        filled = applyFields(result.fields, run);
        note = filled.length
          ? `Filled in the ${filled.join(", ")} from the document. Check them before saving.`
          : "Nothing could be read from the document. It is still attached; fill in the details by hand.";
      } else {
        note = result.error;
      }
    } catch {
      if (!current()) return;
    }
    setDocument({
      filled: filled.length > 0,
      name: file.name,
      note,
      status: "ready",
      url,
    });
  }

  function removeDocument() {
    documentRun.current += 1;
    setDocument({ status: "none" });
  }

  const attached =
    document.status === "ready" || document.status === "reading"
      ? { name: document.name, url: document.url }
      : undefined;
  const documentBusy =
    document.status === "uploading" || document.status === "reading";

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || documentBusy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await recordTradieInvoiceAction({
        document: attached,
        inboxId: prefill?.inboxId,
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              {prefill
                ? "Confirm an emailed invoice"
                : "Record a tradie invoice"}
            </DialogTitle>
            <DialogDescription>
              {prefill
                ? "Read off the tradie's email. It counts once you record it."
                : "For an invoice that came by email or on paper. Bills entered in Xero come through on their own."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">
              Invoice document{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </span>
            <input
              ref={fileInput}
              type="file"
              accept={TRADIE_INVOICE_DOCUMENT_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void chooseFile(event)}
            />
            {document.status === "none" || document.status === "failed" ? (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Upload
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>
                  <span className="block font-medium text-foreground">
                    Upload the tradie&apos;s invoice
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    PDF or photo. It is saved with the invoice and read to fill
                    in the details below.
                  </span>
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <FileText
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {document.name}
                  </span>
                  <span
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    role="status"
                  >
                    {document.status === "uploading" ? (
                      <>
                        <Loader2
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                        Uploading… {Math.round(document.progress)}%
                      </>
                    ) : document.status === "reading" ? (
                      <>
                        <Sparkles
                          className="size-3.5 animate-pulse"
                          aria-hidden="true"
                        />
                        Reading the invoice…
                      </>
                    ) : (
                      <span
                        className={
                          document.filled ? "text-success-ink" : undefined
                        }
                      >
                        {document.note}
                      </span>
                    )}
                  </span>
                </span>
                {document.status === "ready" ? (
                  <a
                    href={fileHref(document.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Open
                  </a>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={removeDocument}
                  aria-label="Remove the invoice document"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            )}
            {document.status === "failed" ? (
              <p role="alert" className="text-xs text-destructive-ink">
                {document.name}: {document.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="record-invoice-booking">Booking</Label>
            <Select value={scheduleId} onValueChange={chooseBooking}>
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

          <div className="grid gap-4 sm:grid-cols-3">
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
              <Label htmlFor="record-invoice-due">Due date (optional)</Label>
              <Input
                id="record-invoice-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                aria-describedby={fieldError("dueDate")}
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
            <div className="flex flex-col justify-start gap-1.5 text-sm">
              <span className="font-medium text-foreground">Total inc GST</span>
              <span className="flex h-9 items-center font-mono text-lg tabular-nums text-foreground">
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
            <Button type="submit" disabled={busy || documentBusy}>
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
