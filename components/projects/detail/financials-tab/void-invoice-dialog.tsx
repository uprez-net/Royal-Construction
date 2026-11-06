"use client";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  voidTradieInvoiceAction,
  type ProjectFinancialsResult,
} from "@/lib/data/project-financials";
import type { FinancialInvoice } from "@/lib/domain/projects/financial-report";

import { formatCents } from "./money";

/** Void an invoice the office recorded by hand. Xero bills are voided in Xero. */
export function VoidInvoiceDialog({
  invoice,
  projectId,
  onOpenChange,
  onVoided,
}: {
  invoice: FinancialInvoice | null;
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onVoided: (result: Extract<ProjectFinancialsResult, { ok: true }>) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [shownId, setShownId] = useState<string | null>(null);
  if ((invoice?.id ?? null) !== shownId) {
    setShownId(invoice?.id ?? null);
    setReason("");
    setError(null);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await voidTradieInvoiceAction({
        invoiceId: invoice.id,
        projectId,
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onVoided(result);
      onOpenChange(false);
    } catch {
      setError("The invoice could not be voided. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={invoice !== null}
      onOpenChange={(next) => !busy && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              Void invoice {invoice?.invoiceNumber ?? ""}
            </DialogTitle>
            <DialogDescription>
              {invoice
                ? `${invoice.tradieName}, ${formatCents(invoice.subTotalCents)} ex GST. It stops counting towards what this activity cost, and stays on record as voided.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-invoice-reason">Why</Label>
            <Textarea
              id="void-invoice-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Entered twice, wrong tradie, withdrawn by the tradie…"
              rows={2}
              aria-describedby={error ? "void-invoice-error" : undefined}
            />
          </div>
          {error ? (
            <p
              id="void-invoice-error"
              role="alert"
              className="text-sm font-medium text-destructive-ink"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Keep it
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Void invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
