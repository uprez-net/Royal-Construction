import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  Prisma,
  SignerRole,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import { attributionUserId, type DomainPrincipal } from "../principal";

// Sending an offer, a tender or a contract out for signature.
//
// Three copies of one very careful discipline: claim the status atomically so
// two callers cannot both create an envelope, create the envelope, then
// persist it in a transaction that re-checks the claim — and, if the envelope
// reached the client but the write failed, never release the claim, because
// releasing it lets a retry send the customer a second copy of a binding
// document.
//
// Keeping three copies of that in step by hand was always going to fail, and
// it had. The contract path learned to store an unknown DocuSign recipient id
// as NULL; the offer-acceptance and tender paths still stored the empty string
// they were handed. The completion webhook matches on
// `docusignRecipientId !== null && docusignRecipientId === signer.recipientId`
// and only falls back to email when that finds nothing — so a batch of
// recipients whose ids came back empty all matched the FIRST empty-string row,
// and every owner's signature landed on one person's record. On a document the
// client has executed, that is the audit trail being wrong about who signed.
// One implementation, with the fix.

export type EnvelopeRecipientRecord = {
  readonly role: string;
  readonly name: string;
  readonly email: string;
  readonly routingOrder: number;
  readonly recipientId: string;
  readonly capacity?: string | null;
  readonly entityName?: string | null;
  readonly entityAbn?: string | null;
};

/**
 * The signature rows for one envelope.
 *
 * `recipientId || null` is the whole point: an empty id means the composite
 * readback did not tell us who this recipient is, and the webhook's email
 * fallback can only run when the id is null. Storing "" makes every unknown
 * recipient collide on the first row.
 */
export function envelopeSignatureRows(
  recipients: readonly EnvelopeRecipientRecord[],
) {
  return recipients.map((recipient) => ({
    recipientRole:
      recipient.role === "BUILDER" ? SignerRole.BUILDER : SignerRole.CUSTOMER,
    name: recipient.name,
    email: recipient.email,
    routingOrder: recipient.routingOrder,
    docusignRecipientId: recipient.recipientId || null,
    capacity: recipient.capacity ?? null,
    entityName: recipient.entityName ?? null,
    entityAbn: recipient.entityAbn ?? null,
  }));
}

export type EnvelopeSendClaim =
  | { readonly kind: "claimed"; readonly previousStatus: OfferStatus }
  | { readonly kind: "refused"; readonly currentStatus: OfferStatus | null };

/**
 * Take the send, atomically.
 *
 * Only the caller that moves the offer off one of `fromStatuses` proceeds. A
 * refusal re-reads rather than assuming why: a concurrent send is one reason,
 * but another tab may have forked a revision, marked the offer agreed, or
 * taken it further down the lifecycle, and naming the wrong one tells the
 * estimator to do something that cannot work.
 */
export async function claimEnvelopeSend(
  db: DomainDb,
  input: {
    readonly offerId: string;
    readonly fromStatuses: readonly OfferStatus[];
    readonly toStatus: OfferStatus;
    readonly previousStatus: OfferStatus;
  },
): Promise<EnvelopeSendClaim> {
  const claim = await db.offer.updateMany({
    data: { offerStatus: input.toStatus },
    where: {
      id: input.offerId,
      offerStatus: { in: [...input.fromStatuses] },
    },
  });
  if (claim.count > 0) {
    return { kind: "claimed", previousStatus: input.previousStatus };
  }

  const current = await db.offer.findUnique({
    select: { offerStatus: true },
    where: { id: input.offerId },
  });
  return { currentStatus: current?.offerStatus ?? null, kind: "refused" };
}

/**
 * Put the status back after the provider refused the envelope.
 *
 * Conditional on the status this send claimed, so a recall or a revision that
 * landed in between is not overwritten. Only ever called when the envelope is
 * known NOT to have reached the client.
 */
export async function releaseEnvelopeSendClaim(
  db: DomainDb,
  input: {
    readonly offerId: string;
    readonly claimedStatus: OfferStatus;
    readonly previousStatus: OfferStatus;
  },
): Promise<void> {
  await db.offer.updateMany({
    data: { offerStatus: input.previousStatus },
    where: { id: input.offerId, offerStatus: input.claimedStatus },
  });
}

/**
 * Record what happened to a send attempt on the offer's own event trail.
 *
 * Never throws: it is an audit line beside a decision that has already been
 * made, and losing it must not turn a completed send into a failure.
 */
export async function recordEnvelopeSendEvent(
  principal: DomainPrincipal,
  db: DomainDb,
  input: {
    readonly offerId: string;
    readonly fromStatus: OfferStatus;
    readonly toStatus: OfferStatus;
    readonly note: string;
  },
): Promise<void> {
  try {
    await db.offerStatusEvent.create({
      data: {
        actorId: attributionUserId(principal),
        fromStatus: input.fromStatus,
        note: input.note,
        offerId: input.offerId,
        toStatus: input.toStatus,
      },
    });
  } catch (error) {
    console.error(
      `[offer] recording a send event for ${input.offerId} failed:`,
      error,
    );
  }
}

export type PersistedEnvelope =
  /** The claim held: the send owns the offer and the document is live. */
  | { readonly kind: "recorded" }
  /**
   * A recall or a revision took the offer while DocuSign was working. The
   * envelope row is still written so the raced envelope stays on the audit
   * trail and can be voided, but it owns nothing.
   */
  | { readonly kind: "raced" }
  /**
   * The envelope IS with the client and could not be recorded. The caller must
   * never release the claim — a retry would send a second binding document.
   */
  | { readonly kind: "unrecorded"; readonly reason: string };

export type EnvelopeDocumentWrite = (
  tx: DomainDb,
  context: { readonly claimed: boolean },
) => Promise<Pick<Prisma.EnvelopeCreateInput, "tender" | "contract" | "offer">>;

/**
 * Write the envelope, its recipients and the document it carries.
 *
 * The claim is re-checked FIRST, inside the transaction, and the answer is
 * handed to the document write. Returning from a transaction callback commits
 * it — only a throw rolls back — so a recall that ran during envelope creation
 * used to have these writes land anyway: the stored document was replaced and
 * `executedPdfUrl` cleared on a document that may already have been executed,
 * even though the raced envelope is voided straight afterwards.
 */
export async function persistSentEnvelope(
  principal: DomainPrincipal,
  db: TransactionalDomainDb,
  input: {
    readonly offerId: string;
    readonly claimedStatus: OfferStatus;
    readonly previousStatus: OfferStatus;
    readonly docType: EnvelopeDocType;
    readonly documentVersion: number;
    readonly envelopeId: string;
    readonly recipients: readonly EnvelopeRecipientRecord[];
    readonly note: string;
    /** OFFER envelopes clear the offer's own executed PDF as they claim. */
    readonly clearOfferExecutedPdf?: boolean;
    readonly writeDocument: EnvelopeDocumentWrite;
  },
): Promise<PersistedEnvelope> {
  try {
    return await db.$transaction(async (tx) => {
      const stillClaimed = await tx.offer.updateMany({
        data: {
          offerStatus: input.claimedStatus,
          ...(input.clearOfferExecutedPdf ? { executedPdfUrl: null } : {}),
        },
        where: {
          id: input.offerId,
          isActive: true,
          offerStatus: input.claimedStatus,
        },
      });
      const claimed = stillClaimed.count > 0;

      const parent = await input.writeDocument(tx, { claimed });

      await tx.envelope.create({
        data: {
          ...parent,
          docType: input.docType,
          docusignId: input.envelopeId,
          documentVersion: input.documentVersion,
          sentAt: new Date(),
          signatures: { create: envelopeSignatureRows(input.recipients) },
          status: EnvelopeStatus.SENT,
        },
      });

      if (!claimed) return { kind: "raced" as const };

      await tx.offerStatusEvent.create({
        data: {
          actorId: attributionUserId(principal),
          fromStatus: input.previousStatus,
          note: input.note,
          offerId: input.offerId,
          toStatus: input.claimedStatus,
        },
      });
      return { kind: "recorded" as const };
    });
  } catch (error) {
    console.error(
      `[offer] envelope ${input.envelopeId} sent but persisting it failed:`,
      error,
    );
    return { kind: "unrecorded", reason: (error as Error).message };
  }
}

/** The offer fields every send reads before it decides anything. */
export async function readOfferForSend(db: DomainDb, offerId: string) {
  const offer = await db.offer.findUnique({
    select: {
      baseReference: true,
      id: true,
      lead: true,
      offerStatus: true,
      revisionNumber: true,
      workspaceState: true,
    },
    where: { id: offerId },
  });
  if (!offer) throw new DomainNotFoundError("Offer not found.");
  return offer;
}

export async function readContractOfferForSend(db: DomainDb, offerId: string) {
  const offer = await db.offer.findUnique({
    select: {
      agreedSnapshot: true,
      baseReference: true,
      id: true,
      lead: { select: { email: true } },
      offerStatus: true,
      revisionNumber: true,
      tender: { select: { documentData: true } },
      workspaceState: true,
    },
    where: { id: offerId },
  });
  if (!offer) throw new DomainNotFoundError("Offer not found.");
  return offer;
}

export async function readContractParticularsForSend(
  db: DomainDb,
  offerId: string,
) {
  return db.contract.findUnique({
    select: { particulars: true },
    where: { offerId },
  });
}

export async function writeTenderEnvelopeDocument(
  tx: DomainDb,
  input: {
    readonly claimed: boolean;
    readonly documentData: Prisma.InputJsonValue;
    readonly offerId: string;
    readonly version: number;
  },
): ReturnType<EnvelopeDocumentWrite> {
  const tender = await tx.tender.upsert({
    create: {
      documentData: input.documentData,
      offerId: input.offerId,
      version: input.version,
    },
    update: input.claimed
      ? {
          documentData: input.documentData,
          executedPdfUrl: null,
          version: input.version,
        }
      : {},
    where: { offerId: input.offerId },
  });
  return { tender: { connect: { id: tender.id } } };
}

export async function writeContractEnvelopeDocument(
  tx: DomainDb,
  input: {
    readonly claimed: boolean;
    readonly documentData: Prisma.InputJsonValue;
    readonly offerId: string;
    readonly version: number;
  },
): ReturnType<EnvelopeDocumentWrite> {
  const contract = await tx.contract.upsert({
    create: {
      documentData: input.documentData,
      offerId: input.offerId,
      version: input.version,
    },
    update: input.claimed
      ? {
          documentData: input.documentData,
          executedPdfUrl: null,
          version: input.version,
        }
      : {},
    where: { offerId: input.offerId },
  });
  return { contract: { connect: { id: contract.id } } };
}
