import { CallFlowStep, CallStatus } from "@prisma/client";

import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { CommsProviderName, VoicePort } from "../../ports/comms";
import type { DomainPrincipal } from "../../principal";
import { providerName } from "../shared";
import {
  callStatusAdvances,
  callStatusOf,
  CALL_TIME_LIMIT_SECONDS,
  RINGING_STALE_MS,
} from "./state";

// Calls whose final callback never arrived (file 06 §6.3).
//
// Reconciliation does not depend on webhooks: any call still live after it
// could possibly be, is asked about at the provider that owns it. A provider
// that only says "no longer alive" (Telnyx) is recorded as COMPLETED with no
// duration rather than an invented one; a call the provider has never heard
// of is FAILED and flagged for a person.

const LIVE: CallStatus[] = [
  CallStatus.QUEUED,
  CallStatus.INITIATED,
  CallStatus.RINGING,
  CallStatus.IN_PROGRESS,
];

export type ReconcileSummary = {
  readonly checked: number;
  readonly settled: number;
  readonly notFound: number;
  readonly unavailable: number;
};

export async function reconcileStaleCalls(
  principal: DomainPrincipal,
  db: DomainDb,
  ports: {
    readonly voiceFor: (provider: CommsProviderName) => VoicePort | null;
  },
  now: Date = new Date(),
): Promise<ReconcileSummary> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError("Reconciling calls is a scheduled job.");
  }
  const stale = await db.call.findMany({
    select: {
      id: true,
      provider: true,
      providerCallId: true,
      startedAt: true,
      status: true,
    },
    take: 200,
    where: {
      OR: [
        {
          startedAt: { lt: new Date(now.getTime() - RINGING_STALE_MS) },
          status: { in: LIVE.slice(0, 3) },
        },
        {
          startedAt: {
            lt: new Date(now.getTime() - CALL_TIME_LIMIT_SECONDS * 1000),
          },
          status: CallStatus.IN_PROGRESS,
        },
      ],
    },
  });

  let settled = 0;
  let notFound = 0;
  let unavailable = 0;
  for (const call of stale) {
    const voice = ports.voiceFor(providerName(call.provider));
    if (!call.providerCallId) {
      // Never reached the provider: the placing request died before it was
      // sent or before the answer was stored. A person checks.
      await db.call.update({
        data: {
          endedAt: now,
          flowStep: CallFlowStep.ENDED,
          needsReconciliation: true,
          providerErrorTitle:
            "The call never got a provider id. Check the provider's call log.",
          status: CallStatus.FAILED,
        },
        where: { id: call.id },
      });
      notFound += 1;
      continue;
    }
    if (!voice) {
      unavailable += 1;
      continue;
    }
    let lookup;
    try {
      lookup = await voice.lookupCall(call.providerCallId);
    } catch {
      unavailable += 1;
      continue;
    }
    if (!lookup.found) {
      await db.call.update({
        data: {
          endedAt: now,
          flowStep: CallFlowStep.ENDED,
          needsReconciliation: true,
          providerErrorTitle:
            "The provider has no record of this call. Check its call log.",
          status: CallStatus.FAILED,
        },
        where: { id: call.id },
      });
      notFound += 1;
      continue;
    }
    if (lookup.alive) continue;
    const next = lookup.state
      ? callStatusOf(lookup.state)
      : CallStatus.COMPLETED;
    if (!callStatusAdvances(call.status, next)) continue;
    await db.call.updateMany({
      data: {
        durationSeconds: lookup.durationSeconds,
        endedAt: now,
        flowStep: CallFlowStep.ENDED,
        hangupCause: lookup.state ? null : "ended_unknown",
        status: next,
      },
      where: { id: call.id, status: call.status },
    });
    settled += 1;
  }
  return { checked: stale.length, notFound, settled, unavailable };
}

/** Processed carrier events are only kept long enough to catch a retry. */
export const WEBHOOK_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Drop processed event-dedupe rows past their retention. Returns how many. */
export async function pruneCommsWebhookEvents(
  principal: DomainPrincipal,
  db: DomainDb,
  now: Date = new Date(),
): Promise<number> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Pruning carrier events is a scheduled job.",
    );
  }
  const result = await db.commsWebhookEvent.deleteMany({
    where: {
      processedAt: { not: null },
      receivedAt: { lt: new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_MS) },
    },
  });
  return result.count;
}
