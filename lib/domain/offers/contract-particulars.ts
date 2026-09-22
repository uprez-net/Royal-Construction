import { OfferStatus, Prisma } from "@prisma/client";

import type { TransactionalDomainDb } from "../db";
import type { DomainPrincipal } from "../principal";
import { OfferSupersededError, authorizeOffer } from "../access/offers";
import {
  CONTRACT_PARTICULAR_FIELDS,
  CONTRACT_PARTICULAR_MAX_LENGTH,
  CONTRACT_PARTICULAR_TOTAL_MAX_LENGTH,
  normalizeContractParticulars,
  serializeContractParticulars,
  type ContractParticularKey,
  type ContractParticulars,
} from "@/lib/offer/contract-particulars";

// The estimator's BC4 contract particulars (issue #98).
//
// These print on the Contract the customer signs, so the window in which they
// may change is narrow on purpose: only while the contract is a draft. Once
// the envelope is sent they are frozen into it as locked tabs, and changing
// them afterwards would leave our record saying something different from the
// document in the customer's hands.
//
// Two implementations existed, and the difference was a race the app's
// comments had already identified and closed:
//
//   The app takes a row lock, then lands a single conditional update whose
//   predicate the database evaluates atomically. Eve read "is it a draft?" and
//   then upserted — so a send flipping the offer to CONTRACT_SENT, or a
//   revision fork deactivating the row, could slip in between and the write
//   would land anyway. That is particulars written after the envelope went out.
//
// Eve also skipped the length limits entirely, so an agent could write a field
// far longer than the DocuSign tab can render.

export type SaveParticularsResult = { ok: true } | { ok: false; error: string };

const NOT_A_DRAFT =
  "Contract particulars can only be edited while the contract is a draft.";

/**
 * Persist the particulars, atomically, only while the offer is an ACTIVE
 * CONTRACT_DRAFT.
 *
 * Takes a client that can open a transaction rather than a caller's: the whole
 * point is the lock-and-conditional-write, and composing into someone else's
 * transaction would let them commit around it.
 */
export async function saveContractParticulars(
  principal: DomainPrincipal,
  input: {
    offerId: string;
    particulars: ContractParticulars;
    manualOverrides: readonly ContractParticularKey[];
  },
  db: TransactionalDomainDb,
): Promise<SaveParticularsResult> {
  try {
    await authorizeOffer(principal, input.offerId, db);
  } catch (error) {
    if (error instanceof OfferSupersededError) {
      return { error: error.message, ok: false };
    }
    throw error;
  }

  const normalized = normalizeContractParticulars(input.particulars);
  const totalLength = CONTRACT_PARTICULAR_FIELDS.reduce(
    (total, field) => total + normalized[field.key].length,
    0,
  );
  if (
    CONTRACT_PARTICULAR_FIELDS.some(
      (field) => normalized[field.key].length > CONTRACT_PARTICULAR_MAX_LENGTH,
    )
    || totalLength > CONTRACT_PARTICULAR_TOTAL_MAX_LENGTH
  ) {
    return {
      error: "Contract particulars exceed the permitted field or total length.",
      ok: false,
    };
  }

  const particulars = serializeContractParticulars(
    normalized,
    input.manualOverrides,
  ) as unknown as Prisma.InputJsonValue;

  // Validate and persist atomically. A separate "is it a draft?" read followed
  // by an upsert would let a concurrent send (which flips the offer to
  // CONTRACT_SENT) or a revision fork (which deactivates this row) slip in
  // between — writing particulars after the envelope is sent, or onto
  // superseded history.
  return db.$transaction(async (tx) => {
    const lockedOffer = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "Offer" WHERE "id" = ${input.offerId} FOR UPDATE`,
    );
    if (lockedOffer.length === 0) {
      return { error: "Offer not found.", ok: false as const };
    }

    // Common case — the contract row already exists: one conditional update
    // whose predicate the database evaluates atomically.
    const updated = await tx.contract.updateMany({
      data: { particulars },
      where: {
        offer: { isActive: true, offerStatus: OfferStatus.CONTRACT_DRAFT },
        offerId: input.offerId,
      },
    });
    if (updated.count > 0) return { ok: true as const };

    // Nothing updated: either the contract row does not exist yet (first save)
    // or the offer is no longer an active draft. Re-check inside the
    // transaction and create the row only when it is genuinely a draft with no
    // contract yet.
    const current = await tx.offer.findUnique({
      select: {
        contract: { select: { id: true } },
        isActive: true,
        offerStatus: true,
        revisionNumber: true,
      },
      where: { id: input.offerId },
    });
    if (
      !current
      || !current.isActive
      || current.offerStatus !== OfferStatus.CONTRACT_DRAFT
      || current.contract
    ) {
      return { error: NOT_A_DRAFT, ok: false as const };
    }

    // documentData is required on the model; it is (re)built from the frozen
    // snapshot at send time, so seed an empty object until then.
    await tx.contract.create({
      data: {
        documentData: {},
        offerId: input.offerId,
        particulars,
        version: current.revisionNumber,
      },
    });
    return { ok: true as const };
  });
}
