"use client";

import { cn } from "@/lib/utils";
import { formatRelativeShort, formatSydneyStamp } from "@/lib/leads/whatsapp-format";
import type { WhatsAppSummaryDto } from "@/lib/leads/whatsapp-types";

/**
 * What the lead list says about a conversation without loading it: unread
 * count, whether the reply window is open, and when the last message was.
 * The same text goes into the action's tooltip via `whatsappSummaryTitle`.
 */
export function whatsappSummaryTitle(
  summary: WhatsAppSummaryDto | undefined,
): string | null {
  if (!summary?.lastMessageAt) return null;
  const parts = [
    `Last WhatsApp ${summary.lastDirection === "INBOUND" ? "received" : "sent"} ${formatSydneyStamp(summary.lastMessageAt)}`,
  ];
  if (summary.unreadCount > 0) parts.push(`${summary.unreadCount} unread`);
  parts.push(
    summary.windowOpen && summary.windowExpiresAt
      ? `reply window open until ${formatSydneyStamp(summary.windowExpiresAt)}`
      : "reply window closed",
  );
  return parts.join(" · ");
}

/** A dot for an open window and a count for unread, over the action icon. */
export function WhatsAppBadge({
  summary,
}: {
  summary: WhatsAppSummaryDto | undefined;
}) {
  if (!summary) return null;
  if (summary.unreadCount > 0) {
    return (
      <span
        className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold leading-4 text-white"
        aria-label={`${summary.unreadCount} unread WhatsApp message${summary.unreadCount === 1 ? "" : "s"}`}
      >
        {summary.unreadCount > 9 ? "9+" : summary.unreadCount}
      </span>
    );
  }
  if (summary.windowOpen) {
    return (
      <span
        className="absolute -right-0.5 -top-0.5 inline-block size-2 rounded-full bg-emerald-500 ring-2 ring-background"
        aria-label="WhatsApp reply window open"
      />
    );
  }
  return null;
}

/** "3h ago", in the mobile card beside the WhatsApp action. */
export function WhatsAppLastSeen({
  summary,
  className,
}: {
  summary: WhatsAppSummaryDto | undefined;
  className?: string;
}) {
  if (!summary?.lastMessageAt) return null;
  return (
    <span className={cn("text-[11px] text-muted-foreground", className)}>
      {formatRelativeShort(summary.lastMessageAt)}
    </span>
  );
}
