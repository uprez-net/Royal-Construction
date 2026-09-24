import { SYDNEY_TZ, sydneyTimeZoneAbbreviation } from "@/lib/dates/sydney";

import type { WhatsAppMessageDto } from "./whatsapp-types";

// Display rules for the WhatsApp thread (issue #333). Pure, so the labels an
// operator reads can be tested without rendering React.

type Status = WhatsAppMessageDto["status"];

const STATUS_LABELS: Record<Status, string> = {
  DELIVERED: "Delivered",
  FAILED: "Failed",
  QUEUED: "Queued",
  READ: "Read",
  RECEIVED: "Received",
  SENT: "Sent",
};

/**
 * The status chip under a bubble. A send WhatsApp never confirmed says so in
 * words — "Queued" would read as "still going", which it is not.
 */
export function whatsappStatusLabel(
  message: Pick<WhatsAppMessageDto, "status" | "needsReconciliation">,
): string {
  if (message.needsReconciliation) return "Unconfirmed — needs checking";
  return STATUS_LABELS[message.status];
}

export type WhatsAppStatusTone = "neutral" | "success" | "danger" | "warning";

export function whatsappStatusTone(
  message: Pick<WhatsAppMessageDto, "status" | "needsReconciliation">,
): WhatsAppStatusTone {
  if (message.needsReconciliation) return "warning";
  if (message.status === "FAILED") return "danger";
  if (message.status === "READ" || message.status === "DELIVERED") {
    return "success";
  }
  return "neutral";
}

const SYDNEY_STAMP = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  hour: "numeric",
  hour12: true,
  minute: "2-digit",
  month: "short",
  timeZone: SYDNEY_TZ,
  weekday: "short",
});

/** "Tue 22 Sept, 2:05 pm AEST" — always Sydney, whatever the browser's zone. */
export function formatSydneyStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${SYDNEY_STAMP.format(date)} ${sydneyTimeZoneAbbreviation(date)}`;
}

/** "3m ago" / "2h ago" / "4d ago", for the compact list indicator. */
export function formatRelativeShort(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Oldest first, one row per id — later copies (fresher status) win. */
export function mergeWhatsAppMessages(
  ...lists: readonly (readonly WhatsAppMessageDto[])[]
): WhatsAppMessageDto[] {
  const byId = new Map<string, WhatsAppMessageDto>();
  for (const list of lists) {
    for (const message of list) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) =>
    a.occurredAt === b.occurredAt
      ? a.id.localeCompare(b.id)
      : a.occurredAt.localeCompare(b.occurredAt),
  );
}
