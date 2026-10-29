"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmailPreviewFrame } from "@/components/common/email-preview-frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIdempotencyKeys } from "@/hooks/use-idempotency-key";
import {
  previewInvoiceRecheckAction,
  sendInvoiceRecheckAction,
} from "@/lib/data/project-financials";

/**
 * Ask a tradie to recheck invoices that come to more than their approved
 * quote. Shows the email exactly as the server will send it — the preview and
 * the send are one render — and says plainly whether it went.
 */
export function RecheckInvoiceDialog({
  projectId,
  scheduleId,
  onOpenChange,
}: {
  projectId: string;
  /** The booking to recheck; null when closed. */
  scheduleId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  // One key per booking, held until its send succeeds: a double click or a
  // retry after a timeout is the same email, a later recheck a new one.
  const keys = useIdempotencyKeys();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [shownFor, setShownFor] = useState<string | null>(null);
  if (scheduleId !== shownFor) {
    setShownFor(scheduleId);
    setError(null);
  }

  const preview = useQuery({
    enabled: scheduleId !== null,
    queryKey: ["invoice-recheck-preview", projectId, scheduleId],
    // The figures it quotes move with every invoice; never show an old one.
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      const result = await previewInvoiceRecheckAction({
        projectId,
        scheduleId: scheduleId!,
      });
      if (!result.ok) throw new Error(result.error);
      return result.recheck;
    },
  });

  async function send() {
    if (!scheduleId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendInvoiceRecheckAction({
        attemptKey: keys.current(scheduleId),
        projectId,
        scheduleId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      keys.rotate(scheduleId);
      toast.success(
        result.alreadySent
          ? `This recheck already went to ${result.to} today; nothing was sent again.`
          : `Recheck sent to ${result.to}.`,
      );
      onOpenChange(false);
    } catch {
      // The key is kept: the email may have gone even though no answer came
      // back, and a retry on the same key cannot send it twice.
      setError("The email could not be confirmed as sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const recheck = preview.data;

  return (
    <Dialog
      open={scheduleId !== null}
      onOpenChange={(next) => !busy && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Request recheck</DialogTitle>
          <DialogDescription>
            Emails the tradie their approved quote and the invoices against it,
            and asks them to confirm the amount, explain the extra work, or send
            a corrected invoice. The booking itself is not changed.
          </DialogDescription>
        </DialogHeader>

        {preview.isPending ? (
          <p
            role="status"
            className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Preparing the email…
          </p>
        ) : preview.isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Nothing to send</AlertTitle>
            <AlertDescription>{preview.error.message}</AlertDescription>
          </Alert>
        ) : recheck ? (
          <div className="space-y-3">
            <dl className="grid gap-1 text-sm sm:grid-cols-[6rem_1fr]">
              <dt className="text-muted-foreground">To</dt>
              <dd className="font-mono">{recheck.to}</dd>
              <dt className="text-muted-foreground">Subject</dt>
              <dd className="font-medium">{recheck.subject}</dd>
            </dl>
            <EmailPreviewFrame
              html={recheck.html}
              title="Recheck email preview"
              editable={false}
              maxHeight={440}
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive-ink">
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
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void send()}
            disabled={busy || !recheck}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Send to tradie
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
