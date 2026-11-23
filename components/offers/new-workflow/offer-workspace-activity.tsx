"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GROUP_HEADING_CLASS } from "./offer-workspace-fields";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  MailOpen,
  MessageSquarePlus,
  Paperclip,
  Reply,
  Send,
} from "lucide-react";
import {
  loadOfferActivity,
  logOfferChangeRequest,
} from "@/lib/data/offer-activity";
import {
  CHANGE_REQUEST_PREFIX,
  type OfferActivityEvent,
  type OfferActivityReply,
  type OfferActivityReplyAttachment,
  type OfferActivitySend,
} from "@/lib/data/offer-activity-types";
import {
  formatActivityNote,
  formatActivityWhen,
} from "@/lib/offer/activity-format";
import {
  OFFER_STATUS_LABEL,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import { fileHref } from "@/lib/files/file-href";

// Negotiation activity for the active offer, on the Send & negotiate step. The
// offer document is negotiated over email (in the builder's mailbox), so nothing
// of that back-and-forth was ever visible in-app. This surfaces the telemetry we
// already capture — each send with its open/reply timestamps — plus the lifecycle
// events (incl. the DocuSign acceptance) and a place to log the customer's
// requested changes off the email thread (ADR 0004).
export function OfferWorkspaceActivity({
  leadId,
  status,
}: {
  readonly leadId: number | undefined;
  // Refetch whenever the offer status changes (a send, agree, signing event, or
  // new revision), so the timeline stays current without a page refresh.
  readonly status: OfferWorkspaceStatus;
}) {
  const [sends, setSends] = useState<readonly OfferActivitySend[]>([]);
  const [events, setEvents] = useState<readonly OfferActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What "this year" means for the timestamps. Restamped on each load rather
  // than read during render, which must stay pure.
  const [now, setNow] = useState<Date>(() => new Date());

  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof loadOfferActivity>>) => {
      if (result.ok) {
        setSends(result.sends);
        setEvents(result.events);
        setNow(new Date());
        setError(null);
      } else {
        setError(result.error);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (leadId === undefined) {
      return;
    }
    setLoading(true);
    try {
      applyResult(await loadOfferActivity({ leadId }));
    } catch (loadError) {
      setError(`Couldn't load activity: ${(loadError as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [leadId, applyResult]);

  // Load on mount and whenever the offer status changes. State is only set AFTER
  // the await, so nothing renders synchronously inside the effect.
  useEffect(() => {
    if (leadId === undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadOfferActivity({ leadId });
        if (!cancelled) {
          applyResult(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(`Couldn't load activity: ${(loadError as Error).message}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, status, applyResult]);

  const submitNote = useCallback(() => {
    if (leadId === undefined || note.trim().length === 0) {
      return;
    }
    setLogging(true);
    void (async () => {
      try {
        const result = await logOfferChangeRequest({ leadId, note });
        if (result.ok) {
          setNote("");
          await refresh();
        } else {
          setError(result.error);
        }
      } catch (logError) {
        setError(
          `Couldn't log the change request: ${(logError as Error).message}`,
        );
      } finally {
        setLogging(false);
      }
    })();
  }, [leadId, note, refresh]);

  // In-memory demo (no lead) has no persisted activity to show.
  if (leadId === undefined) {
    return null;
  }

  const items = mergeTimeline(sends, events, now);

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-card/95 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className={GROUP_HEADING_CLASS}>Negotiation activity</p>
        <Button
          disabled={loading}
          onClick={() => void refresh()}
          size="sm"
          type="button"
          variant="ghost"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No activity yet — sends, opens, replies, and status changes will
          appear here.
        </p>
      ) : (
        <ol className="grid gap-2">
          {items.map((item) =>
            item.detail ? (
              <Collapsible asChild key={item.key}>
                <li className="rounded-md border border-border/60 bg-muted/20 text-xs">
                  <CollapsibleTrigger className="group flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40">
                    <TimelineRow item={item} now={now} />
                    <ChevronDown
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                      aria-hidden="true"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t border-border/60 px-2.5 py-2">
                    {item.detail}
                  </CollapsibleContent>
                </li>
              </Collapsible>
            ) : (
              <li
                key={item.key}
                className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs"
              >
                <TimelineRow item={item} now={now} />
              </li>
            ),
          )}
        </ol>
      )}

      <div className="grid gap-1.5 border-t border-border/60 pt-2">
        <label
          className="text-[11px] font-medium text-muted-foreground"
          htmlFor="offer-change-request"
        >
          Log a change request from the customer&apos;s reply
        </label>
        <textarea
          className="min-h-15 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
          id="offer-change-request"
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Client asked to drop the pool from exclusions and upgrade the stone benchtop."
          value={note}
        />
        <div>
          <Button
            disabled={logging || note.trim().length === 0}
            onClick={submitNote}
            size="sm"
            type="button"
            variant="outline"
          >
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            {logging ? "Logging…" : "Log change request"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type TimelineItem = {
  readonly key: string;
  readonly at: string;
  readonly icon: React.ReactNode;
  readonly label: React.ReactNode;
  // Set when the row opens to show more — a send the client replied to.
  readonly detail?: React.ReactNode;
};

function TimelineRow({
  item,
  now,
}: {
  readonly item: TimelineItem;
  readonly now: Date;
}) {
  return (
    <>
      <span className="mt-0.5 shrink-0 text-muted-foreground">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {formatActivityWhen(item.at, now)}
      </span>
    </>
  );
}

// Merge sends and events into one time-descending list. ISO strings sort
// lexicographically in chronological order, so a string compare is enough.
function mergeTimeline(
  sends: readonly OfferActivitySend[],
  events: readonly OfferActivityEvent[],
  now: Date,
): TimelineItem[] {
  const sendItems: TimelineItem[] = sends.map((send, index) => {
    const repliedWhen = send.repliedAt
      ? formatActivityWhen(send.repliedAt, now)
      : null;
    // repliedAt is stamped on the first reply and lastReplyAt on the latest, so
    // the second only adds anything once the client has written back again.
    // Decided on the instants, never on the labels: formatActivityWhen renders
    // to the minute, so a second reply arriving seconds after the first formats
    // identically and the timeline would hide it.
    const hasLaterReply =
      send.lastReplyAt !== null
      && send.lastReplyAt !== undefined
      && send.lastReplyAt !== send.repliedAt;
    const lastReplyWhen = hasLaterReply
      ? formatActivityWhen(send.lastReplyAt as string, now)
      : null;

    return {
      key: `send-${index}-${send.sentAt}`,
      at: send.sentAt,
      icon: <Send className="size-3.5" aria-hidden="true" />,
      label: (
        <span>
          <span className="font-medium text-foreground">
            Offer v{send.offerFileVersion}
          </span>{" "}
          sent to <span className="font-mono">{send.recipientEmail}</span>
          {send.openedAt ? (
            <span className="ml-1 inline-flex items-center gap-1 text-muted-foreground">
              <MailOpen className="size-3" aria-hidden="true" /> opened{" "}
              {formatActivityWhen(send.openedAt, now)}
            </span>
          ) : null}
          {repliedWhen ? (
            <span className="ml-1 inline-flex items-center gap-1 text-success">
              <Reply className="size-3" aria-hidden="true" /> replied{" "}
              {repliedWhen}
              {lastReplyWhen ? ` · last reply ${lastReplyWhen}` : null}
            </span>
          ) : null}
        </span>
      ),
      detail:
        send.replies.length > 0 || send.repliedAt ? (
          <ReplyThread replies={send.replies} now={now} />
        ) : undefined,
    };
  });

  const eventItems: TimelineItem[] = events.map((event, index) => ({
    key: `event-${index}-${event.at}`,
    at: event.at,
    icon: event.note?.startsWith(CHANGE_REQUEST_PREFIX) ? (
      <MessageSquarePlus className="size-3.5" aria-hidden="true" />
    ) : event.toStatus.endsWith("SIGNED") ? (
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
    ) : (
      <Clock className="size-3.5" aria-hidden="true" />
    ),
    label: describeEvent(event),
  }));

  return [...sendItems, ...eventItems].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );
}

// The client's replies to one send, oldest first, as they were received.
function ReplyThread({
  replies,
  now,
}: {
  readonly replies: readonly OfferActivityReply[];
  readonly now: Date;
}) {
  if (replies.length === 0) {
    // repliedAt without a stored message: a reply recorded before the message
    // itself was kept. Said plainly rather than showing an empty panel.
    return (
      <p className="text-muted-foreground">
        This reply arrived before replies were saved here — open it in Outlook
        to read it.
      </p>
    );
  }
  return (
    <ol className="grid gap-3">
      {replies.map((reply, index) => (
        <li key={`${index}-${reply.receivedAt}`} className="grid gap-1.5">
          <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
            <Reply className="size-3 text-success" aria-hidden="true" />
            <span className="font-mono text-foreground">{reply.fromEmail}</span>
            <span>· {formatActivityWhen(reply.receivedAt, now)}</span>
          </p>
          {reply.subject ? (
            <p className="font-medium text-foreground">{reply.subject}</p>
          ) : null}
          <p className="max-h-72 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md border border-border/60 bg-card px-2.5 py-2 leading-relaxed text-foreground">
            {reply.text || (
              <span className="text-muted-foreground">(No message text)</span>
            )}
          </p>
          {reply.fullText ? (
            <details>
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground marker:text-royal-gold-ink-text">
                Show the full email, with the quoted thread
              </summary>
              <p className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-card px-2.5 py-2 leading-relaxed text-muted-foreground">
                {reply.fullText}
              </p>
            </details>
          ) : null}
          {reply.attachments.length > 0 ? (
            <ul className="grid gap-1">
              {reply.attachments.map((attachment, attachmentIndex) => (
                <ReplyAttachment
                  attachment={attachment}
                  key={`${attachmentIndex}-${attachment.name}`}
                />
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ReplyAttachment({
  attachment,
}: {
  readonly attachment: OfferActivityReplyAttachment;
}) {
  return (
    <li className="flex items-start gap-1.5">
      <Paperclip
        className="mt-0.5 size-3 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 break-words">
        {attachment.url ? (
          <a
            className="font-medium text-royal-gold-ink-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
            href={fileHref(attachment.url)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {attachment.name}
          </a>
        ) : (
          <span className="font-medium text-foreground">{attachment.name}</span>
        )}
        {attachment.size > 0 ? (
          <span className="text-muted-foreground">
            {" · "}
            {formatFileSize(attachment.size)}
          </span>
        ) : null}
        {attachment.note ? (
          <span className="block text-muted-foreground">{attachment.note}</span>
        ) : null}
      </span>
    </li>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeEvent(event: OfferActivityEvent): React.ReactNode {
  if (event.note?.startsWith(CHANGE_REQUEST_PREFIX)) {
    return (
      <span>
        <span className="font-medium text-foreground">Change request</span> —{" "}
        {event.note.slice(CHANGE_REQUEST_PREFIX.length).trim()}
      </span>
    );
  }
  const to = statusLabel(event.toStatus);
  // A note with fromStatus == toStatus is a plain audit note, not a transition.
  if (event.fromStatus === null || event.fromStatus === event.toStatus) {
    return (
      <span>
        <span className="font-medium text-foreground">{to}</span>
        <ActivityNote note={event.note} />
      </span>
    );
  }
  return (
    <span>
      <span className="text-muted-foreground">
        {statusLabel(event.fromStatus)}
      </span>{" "}
      → <span className="font-medium text-foreground">{to}</span>
      <ActivityNote note={event.note} />
    </span>
  );
}

// Webhook notes print as sentences; the envelope id stays as secondary text so a
// signed or declined envelope can still be looked up in DocuSign.
function ActivityNote({ note }: { readonly note: string | null }) {
  if (!note) {
    return null;
  }
  const { text, envelopeId } = formatActivityNote(note);
  return (
    <>
      {` — ${text}`}
      {envelopeId ? (
        <span className="text-muted-foreground">
          {" · envelope "}
          <span className="font-mono">{envelopeId}</span>
        </span>
      ) : null}
    </>
  );
}

// Map an uppercase OfferStatus enum value to its human label via the shared
// workspace-status labels (keyed lowercase). Falls back to the raw value.
function statusLabel(status: string): string {
  const key = status.toLowerCase() as OfferWorkspaceStatus;
  return OFFER_STATUS_LABEL[key] ?? status;
}
