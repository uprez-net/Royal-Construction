"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { smsSegments } from "@/lib/domain/comms/sms/policy";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  fetchSmsThread,
  markSmsRead,
  reconcileSms,
  sendSms,
} from "@/lib/leads/comms-service";
import type { SmsMessageDto, SmsThreadDto } from "@/lib/leads/comms-types";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";
import { cn } from "@/lib/utils";

// A lead's SMS conversation. Everything it shows — the thread, whether a text
// may be sent and why not — comes from the server; the rules live in
// lib/domain/comms/sms.

const POLL_MS = 12_000;

const STATUS_LABEL: Record<SmsMessageDto["status"], string> = {
  DELIVERED: "Delivered",
  FAILED: "Not delivered",
  QUEUED: "Sending",
  RECEIVED: "",
  SENT: "Sent",
};

function Bubble({
  message,
  onReconcile,
  reconciling,
}: {
  message: SmsMessageDto;
  onReconcile: (outcome: "sent" | "not_sent") => void;
  reconciling: boolean;
}) {
  const outbound = message.direction === "OUTBOUND";
  // A text that never reached the lead must not look like one that did.
  const failed = outbound && message.status === "FAILED";
  return (
    <li className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
          failed
            ? "rounded-br-sm border border-destructive/40 bg-destructive/5 text-foreground"
            : outbound
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm bg-muted text-foreground",
        )}
      >
        {message.body}
        <div
          className={cn(
            "mt-1 flex flex-wrap items-center gap-x-1 text-[11px]",
            failed
              ? "text-muted-foreground"
              : outbound
                ? "text-primary-foreground/80"
                : "text-muted-foreground",
          )}
        >
          <span>{formatSydneyStamp(message.occurredAt)}</span>
          {outbound && message.authorName ? (
            <span>· {message.authorName}</span>
          ) : null}
          {outbound && !message.needsReconciliation ? (
            <span
              className={cn(
                failed
                  && "inline-flex items-center gap-1 font-medium text-destructive",
              )}
            >
              ·{" "}
              {failed ? (
                <AlertCircle className="size-3" aria-hidden="true" />
              ) : null}
              {STATUS_LABEL[message.status]}
            </span>
          ) : null}
        </div>
        {failed && message.providerErrorTitle ? (
          <p className="mt-1.5 border-t border-destructive/20 pt-1.5 text-xs text-destructive">
            {message.providerErrorTitle}
          </p>
        ) : null}
        {message.needsReconciliation ? (
          <div className="mt-2 rounded-md bg-background/95 p-2 text-[11px] text-foreground">
            <p>
              The provider never confirmed this text. Check its message log,
              then say what happened:
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={reconciling}
                onClick={() => onReconcile("sent")}
              >
                It was sent
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={reconciling}
                onClick={() => onReconcile("not_sent")}
              >
                It wasn&apos;t sent
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function LeadSmsThread({
  lead,
}: {
  lead: { id: number; name: string };
}) {
  const [thread, setThread] = useState<SmsThreadDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const sendKey = useIdempotencyKey();
  const listRef = useRef<HTMLUListElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await fetchSmsThread(lead.id, signal);
        setThread(next);
        setError(null);
        if (
          next.messages.some(
            (message) => message.direction === "INBOUND" && !message.readAt,
          )
        ) {
          // Retried by the next load while anything is still unread.
          void markSmsRead(lead.id).catch((markError: unknown) => {
            if (signal?.aborted) return;
            setError(
              markError instanceof Error && markError.message
                ? markError.message
                : "Couldn't mark these messages as read, so the unread count may stay. It will try again on the next refresh.",
            );
          });
        }
      } catch (loadError) {
        if (signal?.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the SMS conversation.",
        );
      }
    },
    [lead.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    // Deferred a tick, like the WhatsApp thread: never setState in the effect body.
    const first = window.setTimeout(() => void load(controller.signal), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [count]);

  async function send() {
    if (sending || !draft.trim()) return;
    setSending(true);
    try {
      const result = await sendSms(lead.id, draft, sendKey.current());
      sendKey.rotate();
      setDraft("");
      if (result.alreadySent)
        toast.info("That text had already been sent — it was not sent again.");
      void load();
    } catch (sendError) {
      toast.error(
        sendError instanceof Error
          ? sendError.message
          : "The text could not be sent.",
      );
      void load();
    } finally {
      setSending(false);
    }
  }

  async function reconcile(
    message: SmsMessageDto,
    outcome: "sent" | "not_sent",
  ) {
    setReconcilingId(message.id);
    try {
      await reconcileSms(lead.id, message.id, outcome);
      sendKey.rotate();
      void load();
    } catch (reconcileError) {
      toast.error(
        reconcileError instanceof Error
          ? reconcileError.message
          : "Could not settle the text.",
      );
    } finally {
      setReconcilingId(null);
    }
  }

  const eligibility = thread?.eligibility;
  const segments = draft ? smsSegments(draft) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {eligibility?.to ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
          <span>To</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatE164ForDisplay(eligibility.to)}
          </span>
          {eligibility.from ? (
            <>
              <span>from {eligibility.fromLabel}</span>
              <span className="font-mono tabular-nums">
                {formatE164ForDisplay(eligibility.from)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul
        ref={listRef}
        className="flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-background p-3"
      >
        {!thread && !error ? (
          <li className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />{" "}
            Loading…
          </li>
        ) : null}
        {thread && thread.messages.length === 0 ? (
          <li className="m-auto max-w-xs text-center text-sm text-muted-foreground">
            No texts with {lead.name} yet. Their replies show here.
          </li>
        ) : null}
        {thread?.messages.map((message) => (
          <Bubble
            key={message.id}
            message={message}
            reconciling={reconcilingId === message.id}
            onReconcile={(outcome) => void reconcile(message, outcome)}
          />
        ))}
      </ul>
      {eligibility && !eligibility.allowed ? (
        <p className="flex items-start gap-2 rounded-md bg-warning-light px-3 py-2 text-sm text-warning-ink">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          {eligibility.reason}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Text ${lead.name}…`}
          rows={3}
          maxLength={1530}
          disabled={!eligibility?.allowed || sending}
          aria-label="Message"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-xs text-muted-foreground">
            {segments
              ? `${draft.length} characters · ${segments.segments} SMS${segments.segments === 1 ? "" : " segments"}${
                  segments.encoding === "UCS-2"
                    ? " (emoji or special characters use more)"
                    : ""
                }`
              : "Replies arrive here. Customers can text STOP to opt out."}
          </span>
          <Button
            type="submit"
            className="shrink-0"
            disabled={!eligibility?.allowed || sending || !draft.trim()}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Send text
          </Button>
        </div>
      </form>
    </div>
  );
}
