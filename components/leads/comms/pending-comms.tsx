"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Loader2,
  MessageSquareText,
  PhoneIncoming,
  Voicemail,
} from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { LeadChooser } from "@/components/leads/lead-chooser";
import { Button } from "@/components/ui/button";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  fetchPendingComms,
  fetchPendingCommsCount,
  filePendingCall,
  fileUnmatchedSms,
  markPendingCommsRead,
} from "@/lib/leads/comms-service";
import type {
  CallDto,
  PendingCommsDto,
  SmsMessageDto,
} from "@/lib/leads/comms-types";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";
import { cn } from "@/lib/utils";

import { CallRecordings } from "./call-recordings";

// "Pending Calls/Messages" on the leads page: calls Mili or the voicemail took
// and texts that arrived, from numbers no single lead owns. Each waits here for
// a person to file it onto the right lead or dismiss it; nothing is attached
// by guessing from the number. The badge is what has not been looked at yet,
// and opening the window marks exactly what it showed as read.

type PendingItem =
  | { kind: "call"; id: string; at: string; call: CallDto }
  | { kind: "sms"; id: string; at: string; sms: SmsMessageDto };

type FileBody = { action: "attach"; leadId: number } | { action: "dismiss" };

function fromNumber(e164: string): string {
  return e164 === "withheld" ? "Withheld number" : formatE164ForDisplay(e164);
}

function whyUnmatched(candidateLeadIds: number[]): string {
  return candidateLeadIds.length > 1
    ? "More than one lead has this number"
    : "No lead has this number";
}

export function PendingCommsButton() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<number | null>(null);

  const loadCount = useCallback((signal?: AbortSignal) => {
    fetchPendingCommsCount(signal)
      .then((result) => setUnread(result.unread))
      .catch(() => {
        if (!signal?.aborted) setUnread(null);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadCount(controller.signal);
    // Back on the tab after a while: Mili may have taken calls meanwhile.
    const onFocus = () => loadCount();
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [loadCount]);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PhoneIncoming className="mr-2 size-4" aria-hidden="true" />
        <span className="sm:hidden">Pending</span>
        <span className="hidden sm:inline">Pending Calls/Messages</span>
        {unread ? (
          <span
            className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
            aria-label={`${unread} unread`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Button>
      {open ? (
        <PendingCommsModal
          onRead={loadCount}
          onClose={() => {
            setOpen(false);
            loadCount();
          }}
        />
      ) : null}
    </>
  );
}

function PendingCommsModal({
  onClose,
  onRead,
}: {
  onClose: () => void;
  onRead: () => void;
}) {
  const [list, setList] = useState<PendingCommsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  // What was unread when this window first showed it. Kept for the whole time
  // the window is open, so "New" stays on what was new on arrival even though
  // it has been marked read on the server.
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());
  const marked = useRef(new Set<string>());

  const show = useCallback(
    (next: PendingCommsDto) => {
      setList(next);
      setError(null);
      const callIds = next.calls
        .filter((call) => call.unread && !marked.current.has(call.id))
        .map((call) => call.id);
      const smsIds = next.sms
        .filter((sms) => sms.readAt === null && !marked.current.has(sms.id))
        .map((sms) => sms.id);
      if (callIds.length + smsIds.length === 0) return;
      for (const id of [...callIds, ...smsIds]) marked.current.add(id);
      setNewIds((current) => new Set([...current, ...callIds, ...smsIds]));
      markPendingCommsRead({ callIds, smsIds }).then(
        () => onRead(),
        () => {
          // Left unread on the server: the badge says so next time.
          for (const id of [...callIds, ...smsIds]) marked.current.delete(id);
        },
      );
    },
    [onRead],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        show(await fetchPendingComms(signal));
      } catch (loadError) {
        if (signal?.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load pending calls and messages.",
        );
      }
    },
    [show],
  );

  useEffect(() => {
    const controller = new AbortController();
    // Deferred a tick: never setState in the effect body.
    const first = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(first);
      controller.abort();
    };
  }, [load]);

  const items = useMemo<PendingItem[]>(() => {
    if (!list) return [];
    return [
      ...list.calls.map((call) => ({
        at: call.startedAt,
        call,
        id: call.id,
        kind: "call" as const,
      })),
      ...list.sms.map((sms) => ({
        at: sms.occurredAt,
        id: sms.id,
        kind: "sms" as const,
        sms,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }, [list]);

  async function file(item: PendingItem, body: FileBody, label: string) {
    setBusyId(item.id);
    try {
      if (item.kind === "call") await filePendingCall(item.id, body);
      else await fileUnmatchedSms(item.id, body);
      toast.success(label);
      setAttachingId(null);
      await load();
    } catch (fileError) {
      toast.error(
        fileError instanceof Error
          ? fileError.message
          : item.kind === "call"
            ? "Could not file the call."
            : "Could not file the text.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Pending calls & messages"
      subtitle="Calls Mili or the voicemail took, and texts, from numbers that match no lead (or more than one). File each onto the right lead, or dismiss it."
      maxWidthClass="max-w-[760px]"
    >
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-md bg-destructive-light px-3 py-2 text-sm text-destructive-ink"
        >
          {error}
        </p>
      ) : null}
      {!list && !error ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />{" "}
          Loading…
        </div>
      ) : null}
      {list && items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing pending. Calls and texts from new numbers show up here.
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const candidates =
            item.kind === "call"
              ? item.call.candidateLeadIds
              : item.sms.candidateLeadIds;
          const busy = busyId === item.id;
          return (
            <li
              key={`${item.kind}:${item.id}`}
              className={cn(
                "rounded-lg border border-border p-3.5 text-sm",
                newIds.has(item.id) && "border-primary/40 bg-primary/5",
              )}
            >
              <PendingHeader item={item} isNew={newIds.has(item.id)} />
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.kind === "sms"
                && item.sms.unmatchedReason === "UNKNOWN_BUSINESS_NUMBER"
                  ? "Sent to a number this app isn't configured for"
                  : whyUnmatched(candidates)}
              </p>

              {item.kind === "call" ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  <CallRecordings call={item.call} openTranscripts />
                  {!item.call.agentTranscript
                  && item.call.recordings.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No recording or transcript was kept for this call.
                    </p>
                  ) : null}
                </div>
              ) : (
                // Typed by a member of the public: plain text only.
                <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2">
                  {item.sms.body}
                  {item.sms.mediaCount > 0 ? (
                    <span className="mt-1 block text-xs italic text-muted-foreground">
                      {item.sms.mediaCount} attachment
                      {item.sms.mediaCount === 1 ? "" : "s"} not shown.
                    </span>
                  ) : null}
                </p>
              )}

              {candidates.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">
                    Leads with this number:
                  </span>
                  {candidates.map((leadId) => (
                    <Button
                      key={leadId}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void file(
                          item,
                          { action: "attach", leadId },
                          `Filed on lead #${leadId}.`,
                        )
                      }
                    >
                      File on lead #{leadId}
                    </Button>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void file(item, { action: "dismiss" }, "Dismissed.")
                  }
                >
                  Dismiss
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setAttachingId(attachingId === item.id ? null : item.id)
                  }
                >
                  File onto a lead…
                </Button>
              </div>

              {attachingId === item.id ? (
                <LeadChooser
                  busy={busy}
                  onChoose={(lead) =>
                    void file(
                      item,
                      { action: "attach", leadId: lead.id },
                      `Filed on ${lead.name}.`,
                    )
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </ModalShell>
  );
}

function PendingHeader({ item, isNew }: { item: PendingItem; isNew: boolean }) {
  const number =
    item.kind === "call" ? item.call.customerNumber : item.sms.customerNumber;
  const Icon =
    item.kind === "sms"
      ? MessageSquareText
      : item.call.answeredBy === "VOICEMAIL"
        ? Voicemail
        : Bot;
  const what =
    item.kind === "sms"
      ? "Text"
      : item.call.answeredBy === "VOICEMAIL"
        ? "Voicemail"
        : "Call taken by Mili";
  const seconds = item.kind === "call" ? item.call.durationSeconds : null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="flex items-center gap-2 font-medium">
        <Icon
          className="size-4 shrink-0 self-center text-muted-foreground"
          aria-hidden="true"
        />
        <span className="font-mono tabular-nums">{fromNumber(number)}</span>
        <span className="font-normal text-muted-foreground">· {what}</span>
        {seconds !== null ? (
          <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
        ) : null}
        {isNew ? (
          <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            New
          </span>
        ) : null}
      </p>
      <time className="text-xs text-muted-foreground" dateTime={item.at}>
        {formatSydneyStamp(item.at)}
      </time>
    </div>
  );
}
