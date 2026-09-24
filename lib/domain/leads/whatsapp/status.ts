import { WhatsAppMessageStatus } from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { DomainPrincipal } from "../../principal";
import { isUniqueViolation } from "./records";

// Delivery-status callbacks: sent, delivered, read, failed.
//
// Meta delivers them at least once, in no guaranteed order, sometimes before
// the send that caused them has finished writing. So:
//
//   - every callback is stored once (WhatsAppStatusEvent is unique on
//     wamid + status), which makes a replayed webhook a no-op;
//   - a status only ever moves a message forward, so "delivered" arriving
//     after "read" cannot un-read it, and nothing leaves FAILED or READ;
//   - a callback for a wamid nothing has claimed yet waits, and the send
//     applies it when it stores the wamid.

const RANK: Record<WhatsAppMessageStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
  RECEIVED: -1,
};

/**
 * The status a message should hold after `incoming`, or null to leave it.
 *
 * READ and FAILED are terminal. FAILED is reachable from anything short of
 * READ — Meta reports an undeliverable message after first reporting it sent.
 * RECEIVED is an inbound state and never the target of a callback.
 */
export function nextWhatsAppStatus(
  current: WhatsAppMessageStatus,
  incoming: WhatsAppMessageStatus,
): WhatsAppMessageStatus | null {
  if (incoming === WhatsAppMessageStatus.RECEIVED) return null;
  if (current === WhatsAppMessageStatus.RECEIVED) return null;
  if (
    current === WhatsAppMessageStatus.READ
    || current === WhatsAppMessageStatus.FAILED
  ) {
    return null;
  }
  if (incoming === WhatsAppMessageStatus.FAILED) return incoming;
  return RANK[incoming] > RANK[current] ? incoming : null;
}

export type WhatsAppStatusUpdate = {
  readonly providerMessageId: string;
  readonly status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  readonly occurredAt: Date;
  readonly errorCode?: string | null;
  readonly errorTitle?: string | null;
};

export type WhatsAppStatusOutcome =
  | "applied"
  | "stale"
  | "duplicate"
  | "awaiting_message";

/**
 * Store one status callback and apply it if its message is known.
 *
 * System principal only: the webhook adapter verified Meta's signature and is
 * the only channel that may assert what the provider said. An operator or an
 * agent claiming "it was delivered" is not a delivery receipt.
 */
export async function recordWhatsAppDeliveryStatus(
  principal: DomainPrincipal,
  input: WhatsAppStatusUpdate,
  db: TransactionalDomainDb,
): Promise<{ outcome: WhatsAppStatusOutcome }> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the verified WhatsApp webhook may record a delivery status.",
    );
  }

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.whatsAppStatusEvent.findUnique({
        select: { id: true },
        where: {
          providerMessageId_status: {
            providerMessageId: input.providerMessageId,
            status: input.status,
          },
        },
      });
      if (existing) return { outcome: "duplicate" as const };

      const event = await tx.whatsAppStatusEvent.create({
        data: {
          errorCode: input.errorCode ?? null,
          errorTitle: input.errorTitle ?? null,
          occurredAt: input.occurredAt,
          providerMessageId: input.providerMessageId,
          status: input.status,
        },
        select: { id: true },
      });

      const outcome = await applyStatus(tx, input);
      if (outcome === "awaiting_message") return { outcome };
      await tx.whatsAppStatusEvent.update({
        data: { appliedAt: new Date() },
        where: { id: event.id },
      });
      return { outcome };
    });
  } catch (error) {
    // The same callback delivered twice at once: the second insert loses the
    // unique race. That is the duplicate case, not a failure to report.
    if (isUniqueViolation(error)) return { outcome: "duplicate" };
    throw error;
  }
}

/**
 * Apply callbacks that arrived before their message had a wamid.
 *
 * Called by the send, inside the transaction that stores the wamid.
 */
export async function applyPendingWhatsAppStatuses(
  providerMessageId: string,
  db: DomainDb,
): Promise<void> {
  const pending = await db.whatsAppStatusEvent.findMany({
    orderBy: { occurredAt: "asc" },
    where: { appliedAt: null, providerMessageId },
  });
  for (const event of pending) {
    if (event.status === WhatsAppMessageStatus.RECEIVED) continue;
    await applyStatus(db, {
      errorCode: event.errorCode,
      errorTitle: event.errorTitle,
      occurredAt: event.occurredAt,
      providerMessageId,
      status: event.status as WhatsAppStatusUpdate["status"],
    });
    await db.whatsAppStatusEvent.update({
      data: { appliedAt: new Date() },
      where: { id: event.id },
    });
  }
}

async function applyStatus(
  db: DomainDb,
  input: WhatsAppStatusUpdate,
): Promise<Exclude<WhatsAppStatusOutcome, "duplicate">> {
  const message = await db.leadWhatsAppMessage.findUnique({
    select: {
      deliveredAt: true,
      id: true,
      readAt: true,
      status: true,
    },
    where: { providerMessageId: input.providerMessageId },
  });
  if (!message) return "awaiting_message";

  const next = nextWhatsAppStatus(message.status, input.status);
  // A late "delivered" after "read" does not move the status, but the time it
  // was delivered is still a fact worth keeping.
  const fillDelivered =
    input.status === WhatsAppMessageStatus.DELIVERED && !message.deliveredAt;
  const fillRead =
    input.status === WhatsAppMessageStatus.READ && !message.readAt;

  if (!next && !fillDelivered && !fillRead) return "stale";

  // Guarded on the status just read, so two callbacks applied concurrently
  // cannot both move it: the loser matches no row and changes nothing.
  await db.leadWhatsAppMessage.updateMany({
    data: {
      ...(next
        ? {
            status: next,
            statusAt: input.occurredAt,
            ...(next === WhatsAppMessageStatus.FAILED
              ? {
                  failedAt: input.occurredAt,
                  providerErrorCode: input.errorCode ?? null,
                  providerErrorTitle: input.errorTitle ?? null,
                }
              : {}),
          }
        : {}),
      ...(fillDelivered ? { deliveredAt: input.occurredAt } : {}),
      ...(fillRead ? { readAt: input.occurredAt } : {}),
    },
    where: { id: message.id, status: message.status },
  });
  return next ? "applied" : "stale";
}
