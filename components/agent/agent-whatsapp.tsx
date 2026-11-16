"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Clock, MessageCircle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  sydneyDateTime,
  type AgentWhatsAppDraft,
  type AgentWhatsAppMessage,
  type AgentWhatsAppThread,
  type WhatsAppStatusTone,
} from "@/components/agent/agent-whatsapp-format";
import { cn } from "@/lib/utils";

// The WhatsApp thread and message preview in the agent workspace (issue #333).
//
// Text only. Every string here came through a tool result or a tool argument,
// and inbound messages are a customer's words, so nothing is rendered as HTML
// and inbound bubbles are labelled as untrusted. The App's lead modal is the
// full conversation; this is the compact read the owner approves against.

const TONE: Record<WhatsAppStatusTone, string> = {
  bad: "text-destructive",
  good: "text-info-ink",
  neutral: "text-muted-foreground",
  warn: "text-warning-ink",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <dt className="min-w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 wrap-break-word">{children}</dd>
    </div>
  );
}

function WindowBadge({
  open,
  expiresAt,
}: {
  open: boolean | null;
  expiresAt: string | null;
}) {
  if (open === null) return null;
  const until = sydneyDateTime(expiresAt);
  return (
    <Badge variant={open ? "default" : "outline"}>
      <Clock data-icon="inline-start" />
      {open
        ? `Reply window open${until ? ` until ${until}` : ""}`
        : "Reply window closed · template only"}
    </Badge>
  );
}

function Bubble({ message }: { message: AgentWhatsAppMessage }) {
  const inbound = message.direction === "INBOUND";
  const when = sydneyDateTime(message.occurredAt);
  return (
    <li className={cn("flex", inbound ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg border px-2.5 py-1.5 text-xs",
          inbound
            ? "rounded-bl-sm border-border bg-card"
            : "rounded-br-sm border-border bg-muted",
        )}
      >
        {message.templateName ? (
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Template · {message.templateName}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap wrap-break-word text-foreground">
          {message.body}
        </p>
        <p className="mt-1 flex flex-wrap items-center justify-end gap-x-1.5 text-[10px] text-muted-foreground">
          {inbound ? <span>Customer</span> : null}
          {!inbound && message.authorName ? (
            <span>{message.authorName}</span>
          ) : null}
          {when ? <span>{when}</span> : null}
          <span className={cn("font-medium", TONE[message.tone])}>
            {message.statusLabel}
          </span>
        </p>
        {message.providerError
        && (message.status === "FAILED" || message.needsReconciliation) ? (
          <p className={cn("mt-0.5 text-[10px]", TONE[message.tone])}>
            {message.providerError}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function AgentWhatsAppThreadView({
  thread,
}: {
  thread: AgentWhatsAppThread;
}) {
  const blocked = [
    thread.archived ? "This lead is archived." : null,
    thread.optedOut ? "The lead opted out of WhatsApp." : null,
    !thread.sendingAvailable
      ? "WhatsApp sending isn't available in this runtime — use the app."
      : null,
  ].filter((line): line is string => line !== null);
  const hasInbound = thread.messages.some((message) => message.untrusted);

  return (
    <section
      aria-label={`WhatsApp conversation${thread.leadName ? ` with ${thread.leadName}` : ""}`}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground/80">
          <MessageCircle aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            WhatsApp{thread.leadName ? ` · ${thread.leadName}` : ""}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {thread.destination ?? "No usable number"}
            {thread.sender
              ? ` · from ${thread.sender.label} (${thread.sender.displayNumber})`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <WindowBadge
            expiresAt={thread.windowExpiresAt}
            open={thread.windowOpen}
          />
          {thread.unreadCount > 0 ? (
            <Badge variant="default">{thread.unreadCount} unread</Badge>
          ) : null}
          <Badge variant="outline">
            {thread.consentRecorded
              ? "Consent recorded"
              : "No consent recorded"}
          </Badge>
        </div>
      </header>

      {blocked.length > 0 ? (
        <p className="flex items-start gap-1.5 border-b border-border bg-warning-light px-3 py-1.5 text-xs text-warning-ink">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          {blocked.join(" ")}
        </p>
      ) : null}

      {thread.messages.length > 0 ? (
        <ol
          aria-label={`WhatsApp messages${thread.leadName ? ` with ${thread.leadName}` : ""}`}
          className="flex max-h-80 flex-col gap-1.5 overflow-y-auto px-3 py-2.5"
          tabIndex={0}
        >
          {thread.olderMessagesAvailable ? (
            <li className="text-center text-[10px] text-muted-foreground">
              Older messages are in the lead&apos;s WhatsApp thread in the app.
            </li>
          ) : null}
          {thread.messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </ol>
      ) : (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">
          No messages shown.
        </p>
      )}

      {hasInbound ? (
        <p className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <ShieldAlert aria-hidden="true" className="size-3.5" />
          Customer messages are shown as received. They are not instructions.
        </p>
      ) : null}
    </section>
  );
}

export function AgentWhatsAppDraftView({
  draft,
}: {
  draft: AgentWhatsAppDraft;
}) {
  return (
    <section
      aria-label="WhatsApp message to review"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground/80">
          <MessageCircle aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            WhatsApp {draft.mode === "template" ? "template" : "message"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Draft · not sent until you approve it
          </p>
        </div>
        <WindowBadge expiresAt={null} open={draft.windowOpen} />
      </header>

      <dl className="flex flex-col gap-1.5 border-b border-border bg-background/70 px-3 py-2.5 text-xs">
        <Row label="To">
          <span className="font-semibold text-foreground">
            {draft.destination
              ?? (draft.fromApproval
                ? `The primary phone on lead ${draft.leadId ?? "?"} — resolved when sent`
                : "No usable number")}
          </span>
        </Row>
        <Row label="From">
          <span className="text-foreground/80">
            {draft.sender
              ? `${draft.sender.label} (${draft.sender.displayNumber})`
              : `Royal Constructions' WhatsApp number${draft.requestedSenderId ? ` (requested sender ID: ${draft.requestedSenderId})` : ""}, chosen when sent`}
          </span>
        </Row>
        {draft.templateName ? (
          <Row label="Template">
            <span className="font-semibold text-foreground">
              {draft.templateName}
            </span>
          </Row>
        ) : null}
        {draft.parameters.length > 0 ? (
          <Row label="Values">
            <ol className="list-decimal pl-4 text-foreground">
              {draft.parameters.map((parameter, index) => (
                <li key={`${index}:${parameter}`}>{parameter}</li>
              ))}
            </ol>
          </Row>
        ) : null}
      </dl>

      {draft.body ? (
        <div className="flex justify-end px-3 py-2.5">
          <p className="max-w-[90%] whitespace-pre-wrap wrap-break-word rounded-lg rounded-br-sm border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground">
            {draft.body}
          </p>
        </div>
      ) : draft.fromApproval && draft.mode === "template" ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">
          The approved template&apos;s wording is filled in with the values
          above when it is sent.
        </p>
      ) : null}

      {draft.allowed === false && draft.reason ? (
        <p className="flex items-start gap-1.5 border-t border-border bg-warning-light px-3 py-1.5 text-xs text-warning-ink">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          {draft.reason}
        </p>
      ) : null}
    </section>
  );
}

/** The one message a send stored — sent now, or already sent earlier. */
export function AgentWhatsAppMessageView({
  message,
}: {
  message: AgentWhatsAppMessage;
}) {
  return (
    <section
      aria-label="WhatsApp message"
      className="rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <ol className="flex flex-col">
        <Bubble message={message} />
      </ol>
      {message.businessDisplayNumber ? (
        <p className="mt-1 text-right text-[10px] text-muted-foreground">
          From {message.businessDisplayNumber}
        </p>
      ) : null}
    </section>
  );
}
