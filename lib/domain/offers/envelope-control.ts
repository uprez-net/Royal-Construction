import { EnvelopeStatus } from "@prisma/client";

import type { DomainDb } from "../db";
import type { EnvelopeControlPort } from "../ports/envelope-control";
import {
  LIVE_ENVELOPE_STATUSES,
  readRefusedVoid,
} from "@/lib/docusign/envelope-status";
import {
  envelopeScopeFilter,
  type EnvelopeVoidOutcome,
  type OfferEnvelopeScope,
  type UnsettledEnvelope,
} from "@/lib/offer/offer-recall";

async function writeEnvelopeEnded(
  db: DomainDb,
  id: string,
  status: EnvelopeStatus,
): Promise<void> {
  await db.envelope.updateMany({
    data: {
      status,
      ...(status === EnvelopeStatus.VOIDED ? { voidedAt: new Date() } : {}),
    },
    where: { id, status: { in: LIVE_ENVELOPE_STATUSES } },
  });
}

async function recordEnvelopeEnded(
  db: DomainDb,
  envelope: { readonly id: string; readonly docusignId: string },
  status: EnvelopeStatus,
): Promise<boolean> {
  try {
    await writeEnvelopeEnded(db, envelope.id, status);
    return true;
  } catch (error) {
    console.error(
      `[offer] DocuSign has envelope ${envelope.docusignId} ${status}, but recording it failed:`,
      error,
    );
    return false;
  }
}

async function settleLiveEnvelope(
  db: DomainDb,
  port: EnvelopeControlPort,
  envelope: { readonly id: string; readonly docusignId: string },
  reason: string,
): Promise<
  | { readonly kind: "voided" }
  | { readonly kind: "ended" }
  | { readonly kind: "unsettled"; readonly reason: UnsettledEnvelope["reason"] }
> {
  try {
    await port.void(envelope.docusignId, reason);
  } catch (voidError) {
    let reading = readRefusedVoid(null);
    try {
      reading = readRefusedVoid(await port.getStatus(envelope.docusignId));
    } catch (readError) {
      console.error(
        `[offer] could not read envelope ${envelope.docusignId} back from DocuSign:`,
        readError,
      );
    }
    if (reading.kind !== "ended") {
      console.error(
        `[offer] DocuSign did not void envelope ${envelope.docusignId}:`,
        voidError,
      );
      return { kind: "unsettled", reason: reading.kind };
    }
    return (await recordEnvelopeEnded(db, envelope, reading.status))
      ? { kind: "ended" }
      : { kind: "unsettled", reason: "unrecorded" };
  }

  return (await recordEnvelopeEnded(db, envelope, EnvelopeStatus.VOIDED))
    ? { kind: "voided" }
    : { kind: "unsettled", reason: "unrecorded" };
}

/**
 * Void every still-signable envelope in a scope, recording each irreversible
 * provider result immediately. A later failure must not make a dead DocuSign
 * envelope look live in our database.
 */
export async function voidLiveOfferEnvelopes(
  db: DomainDb,
  port: EnvelopeControlPort,
  input: {
    readonly offerId: string;
    readonly reason: string;
    readonly scope: OfferEnvelopeScope;
  },
): Promise<EnvelopeVoidOutcome> {
  const liveEnvelopes = await db.envelope.findMany({
    select: { docusignId: true, id: true, sentAt: true },
    where: {
      OR: envelopeScopeFilter(input.offerId, input.scope),
      status: { in: LIVE_ENVELOPE_STATUSES },
    },
  });
  const liveIds = liveEnvelopes.map((envelope) => envelope.id);
  const voidedIds: string[] = [];
  const endedIds: string[] = [];
  const unsettled: UnsettledEnvelope[] = [];

  const providerEnvelopes: { id: string; docusignId: string }[] = [];
  for (const envelope of liveEnvelopes) {
    if (envelope.docusignId === null && envelope.sentAt !== null) {
      unsettled.push({
        docusignId: null,
        id: envelope.id,
        reason: "unconfirmed-send",
      });
    } else if (envelope.docusignId === null) {
      try {
        await writeEnvelopeEnded(db, envelope.id, EnvelopeStatus.VOIDED);
        voidedIds.push(envelope.id);
      } catch (error) {
        console.error(
          `[offer] envelope ${envelope.id} never reached DocuSign, but recording it voided failed:`,
          error,
        );
      }
    } else {
      providerEnvelopes.push({
        docusignId: envelope.docusignId,
        id: envelope.id,
      });
    }
  }

  for (const envelope of providerEnvelopes) {
    const settled = await settleLiveEnvelope(db, port, envelope, input.reason);
    if (settled.kind === "voided") voidedIds.push(envelope.id);
    else if (settled.kind === "ended") endedIds.push(envelope.id);
    else unsettled.push({ ...envelope, reason: settled.reason });
  }

  return { endedIds, liveIds, unsettled, voidedIds };
}
