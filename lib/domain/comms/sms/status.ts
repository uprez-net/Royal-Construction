import { SmsStatus } from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { CommsProviderName } from "../../ports/comms";
import type { DomainPrincipal } from "../../principal";
import { isUniqueViolation, providerColumn } from "../shared";

// SMS delivery callbacks. Statuses arrive out of order and more than once, so
// a message only moves forward: QUEUED < SENT < DELIVERED, FAILED terminal
// (file 01 §8). A callback that arrives before the send stored its provider
// id waits in SmsStatusEvent and the send applies it.

const RANK: Record<SmsStatus, number> = {
  [SmsStatus.QUEUED]: 0,
  [SmsStatus.SENT]: 1,
  [SmsStatus.DELIVERED]: 2,
  [SmsStatus.FAILED]: 9,
  [SmsStatus.RECEIVED]: 9,
};

/** True when `next` may replace `current`. A terminal status never moves. */
export function smsStatusAdvances(current: SmsStatus, next: SmsStatus): boolean {
  if (RANK[current] === 9) return false;
  return RANK[next] > RANK[current];
}

export type SmsStatusUpdate = {
  readonly provider: CommsProviderName;
  readonly providerMessageId: string;
  readonly status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED";
  readonly errorCode: string | null;
  readonly occurredAt: Date;
};

export type SmsStatusOutcome =
  | "applied"
  | "stale"
  | "duplicate"
  | "awaiting_message";

export async function recordSmsDeliveryStatus(
  principal: DomainPrincipal,
  update: SmsStatusUpdate,
  db: TransactionalDomainDb,
): Promise<SmsStatusOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only a verified provider callback may record a delivery status.",
    );
  }
  const provider = providerColumn(update.provider);
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.smsStatusEvent.findUnique({
        select: { id: true },
        where: {
          provider_providerMessageId_status: {
            provider,
            providerMessageId: update.providerMessageId,
            status: update.status,
          },
        },
      });
      if (existing) return "duplicate" as const;
      await tx.smsStatusEvent.create({
        data: {
          errorCode: update.errorCode,
          occurredAt: update.occurredAt,
          provider,
          providerMessageId: update.providerMessageId,
          status: update.status,
        },
      });
      const applied = await applyPendingSmsStatuses(
        update.provider,
        update.providerMessageId,
        tx,
      );
      return applied.matched
        ? applied.changed
          ? ("applied" as const)
          : ("stale" as const)
        : ("awaiting_message" as const);
    });
  } catch (error) {
    // Two deliveries of the same callback raced; the other one recorded it.
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}

/**
 * Apply every recorded, unapplied status for one message, in rank order.
 * Called by the callback and by the send once it knows the provider id.
 */
export async function applyPendingSmsStatuses(
  providerNameValue: CommsProviderName,
  providerMessageId: string,
  db: DomainDb,
): Promise<{ matched: boolean; changed: boolean }> {
  const provider = providerColumn(providerNameValue);
  const message = await db.smsMessage.findUnique({
    select: { id: true, status: true },
    where: { provider_providerMessageId: { provider, providerMessageId } },
  });
  if (!message) return { changed: false, matched: false };
  const pending = await db.smsStatusEvent.findMany({
    orderBy: { occurredAt: "asc" },
    where: { appliedAt: null, provider, providerMessageId },
  });
  let status = message.status;
  let changed = false;
  const data: {
    status?: SmsStatus;
    statusAt?: Date;
    deliveredAt?: Date;
    failedAt?: Date;
    providerErrorCode?: string | null;
    needsReconciliation?: boolean;
  } = {};
  for (const event of [...pending].sort(
    (a, b) => RANK[a.status] - RANK[b.status],
  )) {
    if (!smsStatusAdvances(status, event.status)) continue;
    status = event.status;
    changed = true;
    data.status = event.status;
    data.statusAt = event.occurredAt;
    // A carrier report settles an unconfirmed send: it did go.
    data.needsReconciliation = false;
    if (event.status === SmsStatus.DELIVERED) data.deliveredAt = event.occurredAt;
    if (event.status === SmsStatus.FAILED) {
      data.failedAt = event.occurredAt;
      data.providerErrorCode = event.errorCode;
    }
  }
  if (changed) {
    await db.smsMessage.update({ data, where: { id: message.id } });
  }
  if (pending.length > 0) {
    await db.smsStatusEvent.updateMany({
      data: { appliedAt: new Date() },
      where: { id: { in: pending.map((event) => event.id) } },
    });
  }
  return { changed, matched: true };
}
