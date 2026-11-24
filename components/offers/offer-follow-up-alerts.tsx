"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { formatSydneyDate, formatSydneyDateTime } from "@/lib/dates/sydney";
import type {
  MarkOfferFollowUpDoneResult,
  OfferFollowUpAlert,
  SendOfferFollowUpResult,
} from "@/lib/domain/offers/follow-ups";
import { idempotencyHeader } from "@/lib/idempotency/attempt-key";
import { offerFollowUpDraft } from "@/lib/offer/follow-up-template";
import { fetchJson } from "@/utils/fetch";

/**
 * Offers waiting on the client, above the offers table (issue #449).
 *
 * An offer appears a day after it went out with no reply, and again a day
 * after each follow-up. It leaves on its own when the client replies, signs,
 * declines, or the offer is revised — nothing here is stored as an alert, so
 * nothing has to be cleared.
 *
 * "Do follow-up" opens a draft and sends nothing. The email leaves when the
 * administrator presses Send on the draft, after reading and editing it.
 *
 * "Follow-up done" is the quick dismiss for a client chased some other way (a
 * call, a text): it sends nothing, takes the alert off the list, and the alert
 * comes back a day later if the client still has not answered.
 */

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

function FollowUpDialog({
  alert,
  senderName,
  onClose,
}: {
  alert: OfferFollowUpAlert;
  senderName: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  // One key per opening of the draft: a double click or a retry of this send
  // is one email, and opening the draft again tomorrow is a new one. Mounted
  // only while open, so each opening is a fresh attempt.
  const followUpKey = useIdempotencyKey();
  const [draft] = useState(() =>
    offerFollowUpDraft({
      clientName: alert.clientName,
      projectAddress: alert.projectAddress,
      sentAt: alert.sentAt,
      reference: alert.reference,
      senderName,
    }),
  );
  const [to, setTo] = useState(alert.clientEmails[0] ?? "");
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend =
    !isSending && to !== "" && subject.trim() !== "" && body.trim() !== "";

  const send = async () => {
    if (!canSend) return;
    setIsSending(true);
    setError(null);
    try {
      const response = await fetchJson<SendOfferFollowUpResult>(
        `/api/offers/${alert.offerId}/follow-ups`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...idempotencyHeader(followUpKey.current()),
          },
          body: JSON.stringify({ to, subject, body }),
        },
        "The follow-up could not be sent.",
      );
      followUpKey.rotate();
      toast.success(
        response.data.replayed
          ? `This follow-up had already gone to ${response.data.to}; it was not sent again.`
          : `Follow-up sent to ${response.data.to}.`,
      );
      onClose();
      router.refresh();
    } catch (sendError) {
      // The key is kept: a retry of this attempt must not become a second
      // email if the first one did go out.
      setError(
        sendError instanceof Error
          ? sendError.message
          : "The follow-up could not be sent.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (!open && !isSending ? onClose() : null)}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Follow up with {alert.clientName}</DialogTitle>
          <DialogDescription>
            Review and edit the email. Nothing is sent until you press Send. The
            offer&apos;s reference tag is added to the subject so the
            client&apos;s reply is filed against this offer.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="follow-up-to">To</Label>
            {alert.clientEmails.length > 1 ? (
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger id="follow-up-to">
                  <SelectValue placeholder="Choose an address" />
                </SelectTrigger>
                <SelectContent>
                  {alert.clientEmails.map((email) => (
                    <SelectItem key={email} value={email}>
                      {email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id="follow-up-to" value={to} readOnly />
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="follow-up-subject">Subject</Label>
            <Input
              id="follow-up-subject"
              value={subject}
              maxLength={300}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="follow-up-body">Message</Label>
            <Textarea
              id="follow-up-body"
              value={body}
              rows={12}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive-ink">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!canSend} onClick={() => void send()}>
            {isSending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {isSending ? "Sending…" : "Send follow-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpRow({
  alert,
  onFollowUp,
}: {
  alert: OfferFollowUpAlert;
  onFollowUp: () => void;
}) {
  const router = useRouter();
  const isDue = alert.state === "DUE";
  const hasAddress = alert.clientEmails.length > 0;
  const [isMarking, setIsMarking] = useState(false);
  // Held until the refreshed list arrives, so the row does not flash back to
  // an enabled button before it leaves.
  const [isRefreshing, startRefresh] = useTransition();
  const isBusy = isMarking || isRefreshing;

  const markDone = async () => {
    if (isBusy) return;
    setIsMarking(true);
    try {
      const response = await fetchJson<MarkOfferFollowUpDoneResult>(
        `/api/offers/${alert.offerId}/follow-ups/done`,
        { method: "POST" },
        "The follow-up could not be marked done.",
      );
      toast.success(
        `Marked done. ${alert.clientName} comes back on the list ${formatSydneyDateTime(new Date(response.data.nextDueAt))} if they have not replied.`,
      );
      startRefresh(() => router.refresh());
    } catch (markError) {
      toast.error(
        markError instanceof Error
          ? markError.message
          : "The follow-up could not be marked done.",
      );
    } finally {
      setIsMarking(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {isDue ? (
        <Clock
          className="size-4 shrink-0 text-warning-ink"
          aria-hidden="true"
        />
      ) : (
        <Mail
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-semibold text-foreground">
            {alert.clientName}
          </p>
          <StatusPill tone="neutral">{alert.reference}</StatusPill>
          {isDue ? (
            <StatusPill tone="warning">Follow-up due</StatusPill>
          ) : (
            <StatusPill tone="success">Followed up</StatusPill>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {alert.projectAddress || "No site address on the lead"}
          {" · "}Sent {formatSydneyDate(new Date(alert.sentAt))}
          {" · "}
          <span className="font-semibold text-foreground">
            {days(alert.daysPending)} pending
          </span>
          {alert.followUpCount > 0
            ? ` · Followed up ${alert.followUpCount}×, last ${formatSydneyDateTime(new Date(alert.lastFollowUpAt!))}`
            : ""}
          {isDue
            ? ""
            : ` · Due again ${formatSydneyDateTime(new Date(alert.nextDueAt))}`}
        </p>
        {!hasAddress ? (
          <p className="text-xs text-destructive-ink">
            The lead has no email address. Add one to follow up.
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => void markDone()}
          title="Chased another way, such as a call. Hides this alert for a day; nothing is sent."
        >
          {isBusy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          )}
          Follow-up done
        </Button>
        <Button
          type="button"
          size="sm"
          variant={isDue ? "default" : "outline"}
          disabled={!hasAddress || isBusy}
          onClick={onFollowUp}
        >
          <Send className="size-4" aria-hidden="true" />
          {isDue ? "Do follow-up" : "Follow up again"}
        </Button>
      </div>
    </li>
  );
}

export function OfferFollowUpAlerts({
  alerts,
  failed,
  senderName,
}: {
  alerts: OfferFollowUpAlert[];
  /**
   * The read failed. Said out loud, because an empty card would tell the
   * office nobody is due a follow-up when nobody knows.
   */
  failed: boolean;
  /** Signs the draft; the office's own name when known. */
  senderName: string | null;
}) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<OfferFollowUpAlert | null>(null);
  if (failed) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive-light/40 px-4 py-3"
      >
        <AlertTriangle
          className="size-4 shrink-0 text-destructive-ink"
          aria-hidden="true"
        />
        <p className="flex-1 text-sm text-foreground">
          Could not load follow-up alerts. Offers waiting on a client may not be
          shown.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => router.refresh()}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (alerts.length === 0) return null;

  const dueCount = alerts.filter((alert) => alert.state === "DUE").length;

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="border-b border-border/70 py-3">
        <CardTitle
          as="h2"
          className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground"
        >
          <Bell className="size-4 text-warning-ink" aria-hidden="true" />
          Alerts
          {dueCount > 0 ? (
            <StatusPill tone="warning">
              {dueCount} {dueCount === 1 ? "offer needs" : "offers need"} a
              follow-up
            </StatusPill>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul
          className="divide-y divide-border/70"
          aria-label="Offers awaiting a client response"
        >
          {alerts.map((alert) => (
            <FollowUpRow
              key={alert.offerId}
              alert={alert}
              onFollowUp={() => setOpenFor(alert)}
            />
          ))}
        </ul>
      </CardContent>
      {openFor ? (
        <FollowUpDialog
          key={openFor.offerId}
          alert={openFor}
          senderName={senderName}
          onClose={() => setOpenFor(null)}
        />
      ) : null}
    </Card>
  );
}
