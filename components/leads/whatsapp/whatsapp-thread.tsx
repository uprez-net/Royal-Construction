"use client";

import { AlertTriangle, Check, CheckCheck, Clock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatSydneyStamp,
  whatsappStatusLabel,
  whatsappStatusTone,
} from "@/lib/leads/whatsapp-format";
import type { WhatsAppMessageDto } from "@/lib/leads/whatsapp-types";

const TONE_CLASS = {
  danger: "text-destructive-ink",
  neutral: "text-muted-foreground",
  success: "text-success-ink",
  warning: "text-warning-ink",
} as const;

function StatusIcon({ message }: { message: WhatsAppMessageDto }) {
  if (message.needsReconciliation || message.status === "FAILED") {
    return <AlertTriangle className="size-3" aria-hidden="true" />;
  }
  if (message.status === "QUEUED") {
    return <Clock className="size-3" aria-hidden="true" />;
  }
  if (message.status === "SENT") {
    return <Check className="size-3" aria-hidden="true" />;
  }
  if (message.status === "DELIVERED" || message.status === "READ") {
    return <CheckCheck className="size-3" aria-hidden="true" />;
  }
  return null;
}

/**
 * The conversation, oldest at the top.
 *
 * Every body is rendered as plain text. An inbound message is whatever a
 * member of the public typed, so it never reaches the DOM as HTML.
 */
export function WhatsAppThread({
  messages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onReconcile,
  reconcilingId,
  showSender,
}: {
  messages: WhatsAppMessageDto[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onReconcile: (message: WhatsAppMessageDto, outcome: "sent" | "not_sent") => void;
  reconcilingId: string | null;
  /** Name the Royal number on each bubble when more than one is configured. */
  showSender: boolean;
}) {
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {hasOlder ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLoadOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            Load older messages
          </Button>
        </div>
      ) : null}

      {messages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No WhatsApp messages with this lead yet.
        </p>
      ) : null}

      <ol className="flex flex-col gap-2.5">
        {messages.map((message) => {
          const outbound = message.direction === "OUTBOUND";
          const tone = whatsappStatusTone(message);
          return (
            <li
              key={message.id}
              className={cn("flex", outbound ? "justify-end" : "justify-start")}
            >
              <article
                aria-label={`${outbound ? "Sent" : "Received"} ${formatSydneyStamp(message.occurredAt)}`}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs sm:max-w-[75%]",
                  outbound
                    ? "rounded-br-sm bg-emerald-50 text-foreground ring-1 ring-emerald-200"
                    : "rounded-bl-sm bg-muted text-foreground ring-1 ring-border",
                  message.status === "FAILED" && "ring-destructive/40",
                  message.needsReconciliation && "ring-amber-300",
                )}
              >
                {message.kind === "TEMPLATE" ? (
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Template · {message.templateName}
                  </p>
                ) : null}
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    message.kind === "UNSUPPORTED" && "italic text-muted-foreground",
                  )}
                >
                  {message.body}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <time dateTime={message.occurredAt}>
                    {formatSydneyStamp(message.occurredAt)}
                  </time>
                  {outbound && message.authorName ? (
                    <span>· {message.authorName}</span>
                  ) : null}
                  {showSender ? (
                    <span>
                      · {outbound ? "from" : "to"} {message.businessDisplayNumber}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      TONE_CLASS[tone],
                    )}
                  >
                    <StatusIcon message={message} />
                    {whatsappStatusLabel(message)}
                  </span>
                </p>
                {message.providerErrorTitle
                && (message.status === "FAILED" || message.needsReconciliation) ? (
                  <p className="mt-1 text-xs text-destructive-ink">
                    {message.providerErrorTitle}
                  </p>
                ) : null}
                {message.needsReconciliation ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={reconcilingId === message.id}
                      onClick={() => onReconcile(message, "sent")}
                    >
                      Mark sent
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={reconcilingId === message.id}
                      onClick={() => onReconcile(message, "not_sent")}
                    >
                      Mark not sent
                    </Button>
                  </div>
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
