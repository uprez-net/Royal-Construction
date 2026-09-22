import {
  OutboxEventKind,
  OutboxEventStatus,
  type Prisma,
} from "@prisma/client";

import type { DomainDb } from "./db";
import { DomainNotFoundError, DomainTransitionError } from "./errors";

export type OutboxIntent = {
  readonly key: string;
  readonly kind: OutboxEventKind;
  readonly payload: Prisma.InputJsonValue;
  readonly availableAt?: Date;
};

export type ClaimedOutboxEvent = {
  readonly id: string;
  readonly key: string;
  readonly kind: OutboxEventKind;
  readonly payload: Prisma.JsonValue;
  readonly attempts: number;
  readonly lockedAt: Date;
};

export type OutboxEffectResult = {
  readonly id: string;
  readonly key: string;
  readonly status: OutboxEventStatus;
  readonly result: Prisma.JsonValue | null;
};

/**
 * Persist one provider-neutral effect intent. Existing keys are returned as
 * they are, which makes retries and duplicate post-commit hooks harmless.
 */
export async function enqueueOutboxEvent(
  db: DomainDb,
  intent: OutboxIntent,
): Promise<OutboxEffectResult> {
  if (!intent.key.trim() || !intent.kind.trim()) {
    throw new DomainTransitionError("An outbox key and kind are required.");
  }
  return db.outboxEvent.upsert({
    create: {
      availableAt: intent.availableAt ?? new Date(),
      key: intent.key,
      kind: intent.kind,
      payload: intent.payload,
    },
    update: {},
    where: { key: intent.key },
    select: { id: true, key: true, result: true, status: true },
  });
}

/** Claim one known key, without taking ownership of unrelated work. */
export async function claimOutboxEvent(
  db: DomainDb,
  key: string,
): Promise<ClaimedOutboxEvent | null> {
  const candidate = await db.outboxEvent.findUnique({ where: { key } });
  if (!candidate || candidate.status !== OutboxEventStatus.PENDING) return null;
  const lockedAt = new Date();
  const updated = await db.outboxEvent.updateMany({
    data: {
      attempts: { increment: 1 },
      lockedAt,
      status: OutboxEventStatus.RUNNING,
    },
    where: { id: candidate.id, status: OutboxEventStatus.PENDING },
  });
  if (updated.count !== 1) return null;
  return {
    attempts: candidate.attempts + 1,
    id: candidate.id,
    key: candidate.key,
    kind: candidate.kind,
    lockedAt,
    payload: candidate.payload,
  };
}

/**
 * Execute a provider call only after its durable intent is claimed. A
 * succeeded result is replayed; RUNNING or FAILED means the previous attempt
 * needs reconciliation and is never blindly repeated.
 *
 * `replayed` is part of the answer, not an implementation detail: a caller
 * that reports "sent" for a replay is telling the office an email went out
 * when none did. Every caller has to decide what to say about that.
 *
 * `repeatable` says the effect may be run again after an ambiguous failure
 * without costing anything — archiving a PDF to a fixed path overwrites the
 * same object, so a second attempt is the same end state. Leave it off for
 * anything a customer or a tradie sees, or anything that moves money: there a
 * duplicate is the expensive outcome and a human should look first. The
 * default is off, because "can this safely happen twice?" is a question the
 * caller has to answer deliberately.
 */
export async function runOutboxEffectWithOutcome<
  T extends Prisma.InputJsonValue,
>(
  db: DomainDb,
  intent: OutboxIntent,
  execute: () => Promise<T>,
  options: { readonly repeatable?: boolean } = {},
): Promise<{ result: T; replayed: boolean }> {
  const existing = await enqueueOutboxEvent(db, intent);
  if (
    existing.status === OutboxEventStatus.SUCCEEDED
    && existing.result !== null
  ) {
    return { replayed: true, result: existing.result as T };
  }
  // Name the key. Refusing to retry is the right call when a provider may
  // already have accepted the request, but "needs reconciliation" with nothing
  // to look up is a dead end for an office of three with no on-call: the key is
  // what identifies the OutboxEvent row somebody has to check.
  if (
    existing.status !== OutboxEventStatus.PENDING
    && !(options.repeatable && existing.status === OutboxEventStatus.FAILED)
  ) {
    throw new DomainTransitionError(
      `This external effect was already attempted and needs reconciliation before retrying (outbox key ${intent.key}).`,
    );
  }
  if (options.repeatable && existing.status === OutboxEventStatus.FAILED) {
    // Reopen it so the claim below can take it. Safe only because the caller
    // has said a second run costs nothing.
    await db.outboxEvent.updateMany({
      data: { availableAt: new Date(), status: OutboxEventStatus.PENDING },
      where: { id: existing.id, status: OutboxEventStatus.FAILED },
    });
  }
  const claimed = await claimOutboxEvent(db, intent.key);
  if (!claimed) {
    throw new DomainTransitionError(
      `This external effect is already being processed; inspect its outcome before retrying (outbox key ${intent.key}).`,
    );
  }
  try {
    const result = await execute();
    await completeOutboxEvent(db, claimed.id, result);
    return { replayed: false, result };
  } catch (error) {
    await failOutboxEvent(db, claimed.id, {
      message: options.repeatable
        ? "The external effect failed; it is safe to repeat and will be retried."
        : "The external effect failed or its outcome was ambiguous.",
      retryable: options.repeatable === true,
    });
    throw error;
  }
}

/** The same guard for callers that do not distinguish a replay. */
export async function runOutboxEffect<T extends Prisma.InputJsonValue>(
  db: DomainDb,
  intent: OutboxIntent,
  execute: () => Promise<T>,
  options: { readonly repeatable?: boolean } = {},
): Promise<T> {
  const { result } = await runOutboxEffectWithOutcome(
    db,
    intent,
    execute,
    options,
  );
  return result;
}

/**
 * Claim pending work with a conditional update. Two workers may observe the
 * same candidate, but only one can move it from PENDING to RUNNING.
 */
export async function claimOutboxEvents(
  db: DomainDb,
  options: {
    readonly kind?: OutboxEventKind;
    readonly limit?: number;
    readonly now?: Date;
  } = {},
): Promise<ClaimedOutboxEvent[]> {
  const now = options.now ?? new Date();
  const candidates = await db.outboxEvent.findMany({
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(options.limit ?? 10, 100)),
    where: {
      availableAt: { lte: now },
      ...(options.kind ? { kind: options.kind } : {}),
      status: OutboxEventStatus.PENDING,
    },
  });
  const claimed: ClaimedOutboxEvent[] = [];
  for (const candidate of candidates) {
    const lockedAt = new Date();
    const result = await db.outboxEvent.updateMany({
      data: {
        attempts: { increment: 1 },
        lockedAt,
        status: OutboxEventStatus.RUNNING,
      },
      where: { id: candidate.id, status: OutboxEventStatus.PENDING },
    });
    if (result.count !== 1) continue;
    claimed.push({
      attempts: candidate.attempts + 1,
      id: candidate.id,
      key: candidate.key,
      kind: candidate.kind,
      lockedAt,
      payload: candidate.payload,
    });
  }
  return claimed;
}

/** Mark a claimed effect successful and retain a small provider result. */
export async function completeOutboxEvent(
  db: DomainDb,
  eventId: string,
  result?: Prisma.InputJsonValue,
): Promise<void> {
  const updated = await db.outboxEvent.updateMany({
    data: {
      completedAt: new Date(),
      lastError: null,
      lockedAt: null,
      result,
      status: OutboxEventStatus.SUCCEEDED,
    },
    where: { id: eventId, status: OutboxEventStatus.RUNNING },
  });
  if (updated.count !== 1) {
    throw new DomainTransitionError(
      "This outbox effect is no longer owned by the worker.",
    );
  }
}

/**
 * Requeue failures known to have happened before provider acceptance. An
 * ambiguous provider timeout is terminal until a human reconciles it; blindly
 * retrying a customer email or invoice can create the expensive duplicate.
 */
export async function failOutboxEvent(
  db: DomainDb,
  eventId: string,
  input: {
    readonly message: string;
    readonly retryable: boolean;
    readonly retryAt?: Date;
  },
): Promise<void> {
  const updated = await db.outboxEvent.updateMany({
    data: {
      availableAt: input.retryAt ?? new Date(),
      completedAt: input.retryable ? null : new Date(),
      lastError: input.message,
      lockedAt: null,
      status: input.retryable
        ? OutboxEventStatus.PENDING
        : OutboxEventStatus.FAILED,
    },
    where: { id: eventId, status: OutboxEventStatus.RUNNING },
  });
  if (updated.count !== 1) {
    throw new DomainNotFoundError(
      "Outbox effect not found or already settled.",
    );
  }
}
