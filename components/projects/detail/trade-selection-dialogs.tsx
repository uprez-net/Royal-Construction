"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  requestTradeCancellation,
  selectTradeQuote,
} from "@/lib/store/slices/projectsSlice";
import type { TradeSelectionSummary } from "@/types/project";
import { currency } from "@/utils/formatters";

import type { TradeTradie } from "./tradie-requests";

function errorText(error: unknown, fallback: string): string {
  return typeof error === "string" ? error : fallback;
}

/**
 * Confirms a selection by saying what it does before it does it: which
 * bookings go to approval at what price, and how many of the other tradies'
 * bookings are cancelled. None of it is undone by closing a dialog.
 */
export function SelectQuoteDialog({
  projectId,
  trade,
  tradie,
  onOpenChange,
}: {
  projectId: string;
  trade: string;
  /** The tradie being selected; null keeps the dialog closed. */
  tradie: TradeTradie | null;
  onOpenChange: (open: boolean) => void;
}) {
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!tradie || busy) return;
    setBusy(true);
    try {
      const result = await dispatch(
        selectTradeQuote({ projectId, tradieId: tradie.tradieId }),
      ).unwrap();
      toast.success(
        `${result.tradieName} selected for ${result.trade}. ${result.approvals} ${result.approvals === 1 ? "booking is" : "bookings are"} waiting on admin approval.`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(errorText(error, "The quote could not be selected."));
    } finally {
      setBusy(false);
    }
  };

  const open = tradie !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Select {tradie?.name} for {trade}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Their {tradie?.quotedCount}{" "}
                {tradie?.quotedCount === 1 ? "booking goes" : "bookings go"} to
                admin approval
                {tradie?.quotedTotal != null
                  ? ` at ${currency.format(tradie.quotedTotal)} in total`
                  : ""}
                , with the amount quoted for each activity.
              </p>
              {tradie && tradie.displaces > 0 ? (
                <p>
                  {tradie.displaces}{" "}
                  {tradie.displaces === 1
                    ? "booking from another tradie"
                    : "bookings from other tradies"}{" "}
                  on the same activities will be cancelled. They are not
                  emailed.
                </p>
              ) : null}
              <p>
                To change your mind later, request a cancellation; an admin
                approves it.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep comparing</AlertDialogCancel>
          <Button onClick={confirm} disabled={busy} aria-busy={busy}>
            {busy ? (
              <Loader2
                className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            {busy ? "Selecting…" : "Select quote"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Ask the admins to release the selected tradie; nothing changes until then. */
export function CancelSelectionDialog({
  projectId,
  selection,
  openBookings,
  onOpenChange,
}: {
  projectId: string;
  selection: TradeSelectionSummary | null;
  openBookings: number;
  onOpenChange: (open: boolean) => void;
}) {
  const dispatch = useAppDispatch();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!selection || busy) return;
    if (!reason.trim()) {
      setError(
        "Say why the tradie should be cancelled; the admin decides from it.",
      );
      return;
    }
    setBusy(true);
    try {
      await dispatch(
        requestTradeCancellation({
          projectId,
          reason: reason.trim(),
          selectionId: selection.id,
        }),
      ).unwrap();
      toast.success(
        `Cancellation of ${selection.tradie.name} sent to the admins for approval.`,
      );
      setReason("");
      setError(null);
      onOpenChange(false);
    } catch (caught) {
      toast.error(
        errorText(caught, "The cancellation could not be requested."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={selection !== null} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Cancel {selection?.tradie.name} for {selection?.trade}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This asks the admins to release them. They stay selected, and their{" "}
            {openBookings} open{" "}
            {openBookings === 1 ? "booking stands" : "bookings stand"}, until an
            admin approves. Once approved, those bookings are cancelled.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="trade-cancellation-reason">Reason</Label>
          <Textarea
            id="trade-cancellation-reason"
            value={reason}
            maxLength={1000}
            rows={3}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "trade-cancellation-error" : undefined}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            placeholder="Can no longer meet the dates, price changed after selection…"
          />
          {error ? (
            <p
              id="trade-cancellation-error"
              className="text-xs font-medium text-destructive-ink"
            >
              {error}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep tradie</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <Loader2
                className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            {busy ? "Sending…" : "Send cancellation request"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
