import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  isDomainError,
} from "../errors";
import type { DomainPrincipal } from "../principal";
import { authorizeLead } from "./leads";

// Who may read or write an offer.
//
// An offerId in an argument is NOT authorization: every offer surface is
// reachable by a caller who chose the id, so the rule is "may this caller
// access the lead behind this offer", checked here rather than assumed.
//
// This replaces two spellings of the same rule. lib/data/offer-access.ts
// resolved Clerk identity itself and returned `{ ok: false, error }`;
// agent/lib/offer-operations.ts resolved the Eve actor and threw a generic
// authorization error, and enforced the superseded-revision guard somewhere
// else entirely (inside the update, not at the gate). Both now call this.

export type OfferAccess = {
  readonly offerId: string;
  readonly leadId: number;
  readonly isActive: boolean;
};

/**
 * A revision that exists and is readable, but is history.
 *
 * Its own type rather than a message an adapter has to sniff: the App adapter
 * shows this one verbatim ("superseded and read-only" is a useful thing for an
 * operator to be told) while flattening every other refusal into one answer.
 */
export class OfferSupersededError extends DomainAuthorizationError {
  constructor() {
    super("This offer revision has been superseded and is read-only.");
  }
}

export type AuthorizeOfferOptions = {
  /**
   * Opt into superseded revisions. Only read paths may set it: every write
   * must land on the lead's one live revision, or an edit would rewrite
   * history.
   */
  readonly allowInactive?: boolean;
};

/**
 * Assert this caller may act on this offer revision, and return its lead.
 *
 * The `isActive` gate is keyed on `isActive` rather than
 * `offerStatus === SUPERSEDED` because `isActive` is what the
 * one-active-per-lead partial unique index enforces; the status is a label set
 * alongside it. Revision ids reach the client through the revision list, so
 * this is the boundary that stops one being replayed into a mutation.
 */
export async function authorizeOffer(
  principal: DomainPrincipal,
  offerId: string,
  db: DomainDb,
  options: AuthorizeOfferOptions = {},
): Promise<OfferAccess> {
  const offer = await db.offer.findUnique({
    select: { isActive: true, leadId: true },
    where: { id: offerId },
  });

  if (!offer) throw new DomainNotFoundError("Offer not found");

  // Deliberately not distinguishing "no such offer" from "a lead you may not
  // read": an offer id is guessable in a way a lead list is not, so the answer
  // must not confirm that someone else's offer exists.
  try {
    await authorizeLead(principal, offer.leadId, db);
  } catch (error) {
    // Only a refusal is flattened. The app's previous `catch {}` swallowed a
    // database failure into "you do not have access" as well, which is both
    // wrong and undiagnosable from the screen.
    if (!isDomainError(error)) throw error;
    throw new DomainAuthorizationError("You do not have access to this offer");
  }

  if (!offer.isActive && options.allowInactive !== true) {
    throw new OfferSupersededError();
  }

  return { isActive: offer.isActive, leadId: offer.leadId, offerId };
}
