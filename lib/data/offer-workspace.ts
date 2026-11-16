"use server";

import { OfferStatus, Prisma } from "@prisma/client";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import { revalidateTag, updateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { getAdminOfferContent } from "@/lib/data/admin-offer-content";
import { createDocusignEnvelopeControl } from "@/lib/docusign/envelope-control-port";
import {
  mintOfferReference,
  openOfferForLead,
} from "@/lib/domain/offers/start";
import { CACHE_PROFILES } from "@/types/cache";
import {
  authorizeLeadAccess,
  authorizeOfferAccess,
  type OfferAccess,
} from "@/lib/data/offer-access";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import {
  applyAdminPrefillToSnapshot,
  buildAdminOfferPrefill,
} from "@/lib/offer/admin-offer-prefill";
import { isOfferBuildStepEditable } from "@/lib/offer/offer-editability";
import {
  saveOfferWorkspace as saveOfferWorkspaceDomain,
  syncLeadDealValue,
} from "@/lib/domain/offers/workspace-save";
import { commitOfferStatusTransition } from "@/lib/domain/offers/status";
import { userPrincipal } from "@/lib/domain/principal";
import {
  parseContractParticularOverrides,
  parseContractParticulars,
  type ContractParticularKey,
  type ContractParticulars,
} from "@/lib/offer/contract-particulars";
import {
  contractPreviewTerms,
  type ContractPreviewTerms,
} from "@/lib/offer/contract-terms";
import { hasContractTerms } from "@/lib/offer/contract-terms-status";
import type { OfferSignerStatus } from "@/lib/offer/signing-status";
import type { OfferWorkspaceStatus } from "@/lib/offer/workspace-model";
import { classifyOfferTransition } from "@/lib/offer/offer-workflow-transitions";
import { createOfferRevision as createOfferRevisionDomain } from "@/lib/domain/offers/revisions";
import { recallOfferEnvelope as recallOfferEnvelopeDomain } from "@/lib/domain/offers/recall";
import { getOfferSigningStatus } from "@/lib/domain/offers/queries";
import {
  listOfferRevisionHistory,
  loadOfferRevisionSnapshot as loadOfferRevisionSnapshotDomain,
} from "@/lib/domain/offers/queries";

// The active offer for a lead, ready to hydrate the workspace. `snapshot` is
// null when the offer has no saved working-state yet (client uses defaults).
type LoadedOfferWorkspace = {
  offerId: string;
  reference: string;
  revisionNumber: number;
  status: OfferStatus;
  stateVersion: number;
  snapshot: OfferWorkspaceSnapshot | null;
  // Set only when the offer is in a *_DECLINED state: the decline status-event
  // note (a short "Declined via DocuSign[: <reason>]" message) so the workspace
  // can tell the operator why it was declined. Null otherwise.
  declineReason?: string | null;
  // Estimator's BC4 particulars (issue #98), hydrated into the contract-stage
  // form. Null when the offer has no contract row yet (nothing entered), in
  // which case the workspace starts from the empty set.
  contractParticulars?: ContractParticulars | null;
  contractParticularOverrides?: readonly ContractParticularKey[];
  // Per-recipient DocuSign status for the offer's latest Tender/Contract
  // envelopes (#121/#123). The Connect webhook has always written these rows;
  // nothing read them back, so the signing tracker hard-coded every customer to
  // "Awaiting signature" even after they had signed. Empty until an envelope is
  // sent.
  signerStatuses?: readonly OfferSignerStatus[];
  // Admin content moved on since this offer was built, and the offer is FROZEN
  // (agreed/sent onward) so its snapshot was deliberately left alone. Drives an
  // advisory warn blocker; never blocks.
  adminContentStale?: boolean;
  // The offer was still editable, so the current admin defaults were re-applied
  // and the returned snapshot + stateVersion are the refreshed ones.
  adminContentRefreshed?: boolean;
  // The project a handed-off (PROJECT) offer created, so Open Project links to
  // it after a reload. Null when there is none; absent below PROJECT.
  projectId?: string | null;
  // The payment schedule, deposit and exclusions the Contract step shows: until
  // the BC4 is sent, resolved from the signed Tender the way the send resolves
  // them; after, the tab values the sent BC4 carried. Null before TENDER_SIGNED
  // or when the stored state cannot be read.
  contractTerms?: ContractPreviewTerms | null;
};

type OfferRow = {
  id: string;
  baseReference: string;
  revisionNumber: number;
  offerStatus: OfferStatus;
  stateVersion: number;
  workspaceState: Prisma.JsonValue | null;
};

function toLoaded(offer: OfferRow): LoadedOfferWorkspace {
  const snapshot =
    offer.workspaceState === null
      ? null
      : deserializeWorkspace(parseWorkspaceState(offer.workspaceState));
  return {
    offerId: offer.id,
    reference: `${offer.baseReference}-R${offer.revisionNumber}`,
    revisionNumber: offer.revisionNumber,
    status: offer.offerStatus,
    stateVersion: offer.stateVersion,
    snapshot,
  };
}

// Signing state and decline reasons are one domain query, shared with the live
// poll. Keeping the workspace hydration on that query prevents the initial
// render and the next poll from interpreting the same envelope differently.
async function attachSigningStatus(
  loaded: LoadedOfferWorkspace,
  principal: ReturnType<typeof userPrincipal>,
): Promise<LoadedOfferWorkspace> {
  const status = await getOfferSigningStatus(principal, loaded.offerId, prisma);
  return {
    ...loaded,
    declineReason: status.declineReason,
    signerStatuses: status.signerStatuses,
  };
}

// Admin content versioning (see AdminOfferContent.version). Each offer stamps
// the admin version its cost lines / allowances / exclusions / draft copy came
// from. When the offer is OPENED and that stamp is behind the live admin
// version, one of two things happens:
//
//   - the offer is still editable (`pending`): the admin's current items are
//     merged in and persisted (added tasks, allowances and exclusions appear,
//     removed ones go), while what the estimator already holds is kept — see
//     applyAdminPrefillToSnapshot;
//   - the offer is agreed or sent: nothing is written. That snapshot is what the
//     client was quoted and what the legal documents render from — rewriting it
//     under them would change an issued price. The change is reported instead,
//     as a warn blocker.
//
// Editability is asked of the `cost-schedule` step rather than hard-coded, so
// this can never disagree with the freeze rule in offer-editability.ts.
async function reapplyAdminContentIfStale(
  loaded: LoadedOfferWorkspace,
): Promise<LoadedOfferWorkspace> {
  const snapshot = loaded.snapshot;
  // A brand-new offer has nothing saved yet — the workspace seeds it from the
  // live prefill the page already passed in, which is current by construction.
  if (!snapshot) {
    return loaded;
  }

  let prefill: ReturnType<typeof buildAdminOfferPrefill>;
  try {
    prefill = buildAdminOfferPrefill(await getAdminOfferContent());
  } catch (error) {
    // Opening the workspace must not fail because the admin row could not be
    // read; the offer's own saved content is still perfectly usable.
    console.error("[offer] admin content check on open failed:", error);
    return loaded;
  }
  if (prefill.adminVersion === snapshot.adminContentVersion) {
    return loaded;
  }

  const status = loaded.status.toLowerCase() as OfferWorkspaceStatus;
  if (!isOfferBuildStepEditable("cost-schedule", status)) {
    return { ...loaded, adminContentStale: true };
  }

  const refreshed = applyAdminPrefillToSnapshot(snapshot, prefill);
  // Same optimistic-concurrency predicate the autosave uses (ADR 0002), so this
  // can never land on a row another writer has moved on, nor on a revision that
  // was archived between the read and this write.
  const result = await prisma.offer.updateMany({
    where: {
      id: loaded.offerId,
      isActive: true,
      stateVersion: loaded.stateVersion,
    },
    data: {
      workspaceState: serializeWorkspace(
        refreshed,
      ) as unknown as Prisma.InputJsonValue,
      stateVersion: { increment: 1 },
    },
  });
  if (result.count === 0) {
    // Another writer got there first. Leave the stored state alone and hand back
    // what we read; the next open re-checks and re-applies.
    return { ...loaded, adminContentStale: true };
  }
  return {
    ...loaded,
    snapshot: refreshed,
    stateVersion: loaded.stateVersion + 1,
    adminContentRefreshed: true,
  };
}

// Attach the estimator's saved BC4 particulars (issue #98) so the contract-stage
// form hydrates from them. Null when the offer has no contract row yet.
async function attachContractParticulars(
  loaded: LoadedOfferWorkspace,
): Promise<LoadedOfferWorkspace> {
  const contract = await prisma.contract.findUnique({
    where: { offerId: loaded.offerId },
    select: { particulars: true },
  });
  return {
    ...loaded,
    contractParticulars:
      contract?.particulars == null
        ? null
        : parseContractParticulars(contract.particulars),
    contractParticularOverrides:
      contract?.particulars == null
        ? []
        : parseContractParticularOverrides(contract.particulars),
  };
}

// The handoff creates the project against the lead, and only the tab that ran it
// ever learned its id, so after a reload Open Project had nowhere to go.
async function attachProjectId(
  loaded: LoadedOfferWorkspace,
  leadId: number,
): Promise<LoadedOfferWorkspace> {
  if (loaded.status !== OfferStatus.PROJECT) {
    return loaded;
  }
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { project: { select: { id: true } } },
  });
  return { ...loaded, projectId: lead?.project?.id ?? null };
}

// Reads the rows sendContractForSignature reads, plus the sent Contract's tabs,
// and returns only the terms: the Tender's documentData is the whole render
// input and stays on the server.
async function loadContractTerms(
  offerId: string,
  status: OfferStatus,
): Promise<ContractPreviewTerms | null> {
  if (!hasContractTerms(status)) {
    return null;
  }
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      agreedSnapshot: true,
      workspaceState: true,
      tender: { select: { documentData: true } },
      contract: { select: { documentData: true } },
    },
  });
  if (!offer) {
    return null;
  }
  try {
    return contractPreviewTerms({ status, row: offer });
  } catch (error) {
    // Opening the workspace must not fail on the preview; the send resolves the
    // terms again and refuses on its own.
    console.error(
      `[offer] resolving contract terms for offer ${offerId} failed:`,
      error,
    );
    return null;
  }
}

async function attachContractTerms(
  loaded: LoadedOfferWorkspace,
): Promise<LoadedOfferWorkspace> {
  return {
    ...loaded,
    contractTerms: await loadContractTerms(loaded.offerId, loaded.status),
  };
}

// No actor argument on this or any action below: each is a Server Action, so a
// caller-supplied id could put anyone's name on the offer or its audit trail.
// The actor is always the user the access check signed in.
export async function loadActiveOfferWorkspace(
  leadId: number,
): Promise<LoadedOfferWorkspace> {
  const access = await authorizeLeadAccess(leadId);
  if (!access.ok) {
    throw new Error(access.error);
  }

  // Finding the live offer, or creating the lead's first one, is
  // lib/domain/offers/start.ts, which Eve's start_offer calls too.
  const { created, offer: existing } = await openOfferForLead(
    userPrincipal(access.user),
    { leadId },
    prisma,
  );
  if (!created) {
    // Heal legacy/seed rows that were created without a minted base reference
    // (which render as a bare "-R1"). Mint one and persist it so the reference
    // is correct from here on. Idempotent: only runs while the base is blank.
    if (existing.baseReference.trim().length === 0) {
      const healed = await prisma.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        const baseReference = await mintOfferReference(tx, year);
        return tx.offer.update({
          where: { id: existing.id },
          data: { baseReference },
        });
      });
      revalidateTag(`offer-lead-${leadId}`, CACHE_PROFILES.SHORT);
      return attachContractTerms(
        await attachProjectId(
          await attachSigningStatus(
            await attachContractParticulars(
              await reapplyAdminContentIfStale(toLoaded(healed)),
            ),
            userPrincipal(access.user),
          ),
          leadId,
        ),
      );
    }
    return attachContractTerms(
      await attachProjectId(
        await attachSigningStatus(
          await attachContractParticulars(
            await reapplyAdminContentIfStale(toLoaded(existing)),
          ),
          userPrincipal(access.user),
        ),
        leadId,
      ),
    );
  }

  // First offer for this lead, created above with a freshly minted reference.
  revalidateTag(`offer-lead-${leadId}`, CACHE_PROFILES.SHORT);
  return toLoaded(existing);
}

type SaveResult =
  | { ok: true; stateVersion: number }
  | { ok: false; reason: "stale"; currentStateVersion: number | null }
  | { ok: false; reason: "superseded" }
  // The save would change a step that is frozen at the offer's stored status
  // (lockedSnapshotChanges), typically because another tab issued the offer.
  | { ok: false; reason: "locked" }
  // The snapshot does not satisfy the persisted schema, or names an image
  // outside Royal's Blob storage.
  | { ok: false; reason: "invalid" };

export type OfferSigningStatusPoll =
  | {
      ok: true;
      status: OfferStatus;
      stateVersion: number;
      signerStatuses: OfferSignerStatus[];
      declineReason: string | null;
      // Null unless the caller asked with needsContractTerms.
      contractTerms: ContractPreviewTerms | null;
    }
  | { ok: false; error: string };

// Lightweight poll for an offer's live signing progress: only the fields the
// DocuSign Connect webhook mutates — offer status, per-recipient signer status,
// and (on a decline) the reason. It deliberately does NOT return the workspace
// snapshot, so an open tab can refresh a signing envelope's progress without any
// risk of clobbering local state. Used to keep the signing tracker live while an
// envelope is out for signature, instead of requiring a manual page refresh
// (#121/#123 follow-up). allowInactive so a superseded offer still reports its
// status rather than erroring.
export async function pollOfferSigningStatus(input: {
  offerId: string;
  // The workspace holds no Contract terms for the offer's status, which it
  // reached without a load. Not sent on the signing ticks: the terms are two
  // stored documents, too heavy to re-read every few seconds.
  needsContractTerms?: boolean;
}): Promise<OfferSigningStatusPoll> {
  const access = await authorizeOfferAccess(input.offerId, {
    allowInactive: true,
  });
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  const status = await getOfferSigningStatus(
    userPrincipal(access.user),
    input.offerId,
    prisma,
  );
  const contractTerms =
    input.needsContractTerms === true
      ? await loadContractTerms(input.offerId, status.status)
      : null;
  return {
    ok: true,
    status: status.status,
    stateVersion: status.stateVersion,
    signerStatuses: status.signerStatuses,
    declineReason: status.declineReason,
    contractTerms,
  };
}

// Debounced autosave with optimistic concurrency (ADR 0002). The rule — the
// calc-version pin, the issued-offer lock, the GST split, the optimistic
// predicate and the lead deal-value sync — is
// lib/domain/offers/workspace-save.ts, which Eve calls too. What is left here
// is the Next half: Clerk identity, and the two cache expiries.
export async function saveOfferWorkspace(input: {
  offerId: string;
  expectedStateVersion: number;
  snapshot: OfferWorkspaceSnapshot;
}): Promise<SaveResult> {
  const access = await authorizeOfferAccess(input.offerId, {
    allowInactive: true,
  });
  if (!access.ok) {
    throw new Error(access.error);
  }

  const result = await saveOfferWorkspaceDomain(
    userPrincipal(access.user),
    input,
    prisma,
  );

  if (!result.ok) {
    // The domain carries an operator-facing reason on `invalid`/`locked`; this
    // action's contract has never included one, so it is dropped rather than
    // widened here. The domain logs it.
    return result.reason === "stale"
      ? {
          ok: false,
          reason: "stale",
          currentStateVersion: result.currentStateVersion,
        }
      : { ok: false, reason: result.reason };
  }

  // This projection is deliberately outside the save transaction. A failed
  // lead update must not roll back an offer price that the UI reports saved.
  await syncLeadDealValue(input.offerId, result.contractValueIncGst, prisma);

  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  // The Offers list and its KPIs print these columns from a cached read. Only
  // a price edit moves them, and most autosaves are copy edits.
  if (result.moneyChanged) {
    updateTag("offers");
  }
  return { ok: true, stateVersion: result.stateVersion };
}

// Persist a lifecycle transition, record an audit event, and freeze the agreed
// snapshot on AGREED / stamp sentAt on SENT.
export async function transitionOfferStatus(input: {
  offerId: string;
  toStatus: OfferStatus;
  note?: string;
}): Promise<{ ok: true; status: OfferStatus }> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    throw new Error(access.error);
  }

  // The OFFER_SIGNED / TENDER_SIGNED / CONTRACT_SIGNED states must be reached only
  // through a genuine DocuSign completion (the Connect webhook advances the offer
  // and archives the executed PDF — app/api/docusign/connect/route.ts). The
  // "Mark signed (simulate completion)" control routes here and would flip the
  // status without an executed PDF, which then produces an empty project
  // (issue #90). It is a local-development testing aid only, so refuse a manual
  // jump into a signed state anywhere but local dev.
  const isManualSignedJump =
    input.toStatus === OfferStatus.OFFER_SIGNED
    || input.toStatus === OfferStatus.TENDER_SIGNED
    || input.toStatus === OfferStatus.CONTRACT_SIGNED;
  if (isManualSignedJump && process.env.NODE_ENV !== "development") {
    throw new Error(
      "Manual 'mark signed' is disabled outside local development — complete signing via DocuSign.",
    );
  }

  const offer = await prisma.offer.findUniqueOrThrow({
    where: { id: input.offerId },
    select: { offerStatus: true },
  });

  const kind = classifyOfferTransition(offer.offerStatus, input.toStatus);
  if (typeof kind === "object") {
    // Stepping back from a document out for signature has to void the envelope
    // first, or the customer keeps a signing link for a document we show as a
    // draft.
    throw new Error(
      `Use Recall envelope to take the ${RECALL_DOCUMENT_LABEL[kind.recall]} back from signature. It voids the DocuSign envelope before the status changes.`,
    );
  }
  if (kind === "send-only") {
    throw new Error(
      `An offer moves from ${offer.offerStatus} to ${input.toStatus} only through its own action (sending for signature, or creating the project), not a status change.`,
    );
  }
  if (kind === "invalid") {
    throw new Error(
      `Invalid offer transition from ${offer.offerStatus} to ${input.toStatus}`,
    );
  }

  const committed = await commitOfferTransition(access, {
    offerId: input.offerId,
    from: offer.offerStatus,
    to: input.toStatus,
    skipOwnerGate: false,
    stampSentAt: input.toStatus === OfferStatus.SENT,
    actorId: access.user.id,
    note: input.note,
  });
  if (!committed) {
    throw new Error(
      "The offer's status changed while you were updating it. Refresh to see where it is now, then try again.",
    );
  }
  return { ok: true, status: input.toStatus };
}

const RECALL_DOCUMENT_LABEL = {
  offer: "offer",
  tender: "Tender",
  contract: "Contract",
} as const;

/**
 * The single write behind every workspace status change.
 *
 * `from` is the status the caller decided against. The update only lands while
 * the row still has that status and is still the live revision, so a webhook or
 * another tab that moved the offer in between turns this into a no-op (returns
 * false) instead of an overwrite. It takes the caller's successful access
 * result so it cannot be reached without authorizing first, and it is not
 * exported: this file is "use server".
 */
// The single write behind every workspace status change.
//
// The state machine, the owner gate and the AGREED freeze are
// lib/domain/offers/status.ts, shared with Eve's status tool. What stays here
// is the transaction boundary, the post-commit lead-stage sync and the cache
// expiry — and the boolean contract the two callers already use.
async function commitOfferTransition(
  access: Extract<OfferAccess, { ok: true }>,
  input: {
    offerId: string;
    from: OfferStatus;
    to: OfferStatus;
    skipOwnerGate: boolean;
    stampSentAt: boolean;
    actorId?: string;
    note?: string;
    /** The recall path only — see CommitTransitionInput.skipTransitionCheck. */
    skipTransitionCheck?: boolean;
  },
): Promise<boolean> {
  const committed = await prisma.$transaction(async (tx) =>
    commitOfferStatusTransition(
      userPrincipal(access.user),
      {
        note: input.note,
        expectedFromStatus: input.from,
        offerId: input.offerId,
        skipOwnerGate: input.skipOwnerGate,
        skipTransitionCheck: input.skipTransitionCheck,
        toStatus: input.to,
      },
      tx,
    ),
  );
  if (committed === null) {
    return false;
  }

  // After the transaction, never inside it — see syncLeadStageForOffer.
  await syncLeadStageForOffer(input.offerId);

  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  return true;
}

// One entry in the revision timeline for a lead's offer family.
export type OfferRevisionSummary = {
  readonly offerId: string;
  readonly reference: string;
  readonly revisionNumber: number;
  readonly status: OfferStatus;
  readonly contractValueIncGst: number | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly tenderPdfUrl: string | null;
  readonly contractPdfUrl: string | null;
};

// Every revision of the lead's offer (newest first) for the Versions timeline.
export async function listOfferRevisions(
  leadId: number,
): Promise<readonly OfferRevisionSummary[]> {
  const access = await authorizeLeadAccess(leadId);
  if (!access.ok) {
    throw new Error(access.error);
  }
  return listOfferRevisionHistory(userPrincipal(access.user), leadId, prisma);
}

// A single revision's saved content, for read-only viewing. Distinct from
// loadActiveOfferWorkspace, which only ever resolves the lead's live revision
// and self-provisions one — this addresses an exact revision and never writes.
export type LoadedOfferRevision =
  | {
      ok: true;
      offerId: string;
      reference: string;
      revisionNumber: number;
      status: OfferStatus;
      isActive: boolean;
      // Feeds the document's "prepared" date, so re-rendering an old revision
      // reproduces the date it was drawn up rather than today's.
      createdAt: string;
      // When this revision's proposal was last emailed, or null if it never
      // was. Preferred for the prepared date: it dates the copy the customer
      // actually received.
      lastSentAt: string | null;
      snapshot: OfferWorkspaceSnapshot;
    }
  // "empty": the revision was superseded before anything was saved onto it.
  // "unreadable": persisted state that no longer satisfies the current schema.
  | { ok: false; reason: "empty" | "unreadable" };

export async function loadOfferRevisionSnapshot(
  offerId: string,
): Promise<LoadedOfferRevision> {
  // The one read path allowed to resolve a superseded revision.
  const access = await authorizeOfferAccess(offerId, { allowInactive: true });
  if (!access.ok) {
    throw new Error(access.error);
  }

  return loadOfferRevisionSnapshotDomain(
    userPrincipal(access.user),
    offerId,
    prisma,
  );
}

export type CreateOfferRevisionResult =
  | {
      ok: true;
      offerId: string;
      leadId: number;
      // How many live DocuSign envelopes were pulled back. A revision is refused
      // unless DocuSign confirmed every void, so voidWarnings is always empty;
      // it stays for the client's existing check.
      voidedEnvelopes: number;
      voidWarnings: readonly string[];
    }
  // An executed Contract can't be revised — a change there is a contract
  // variation, a separate instrument, not a new offer revision.
  | { ok: false; reason: "locked" }
  // Nothing was forked: DocuSign did not confirm every void, or a document went
  // out for signature meanwhile. Returned, not thrown, because Next hides a
  // thrown message in production and `error` is what the estimator acts on.
  | { ok: false; reason: "refused"; error: string };

/**
 * Recall a document that is out for signature: void the live DocuSign envelope
 * AND step the offer back to its editable status.
 *
 * The three Recall controls used to call `transitionOfferStatus` alone, which
 * flipped our status and never told DocuSign. The estimator saw "Draft" and
 * edited with confidence while the customer still held a live signing link for
 * the superseded document — and could sign it, producing an executed PDF for a
 * contract the builder believed was withdrawn.
 *
 * `scope` and `toStatus` come from the client, so neither is trusted: both are
 * derived from the offer's own status and the call is refused unless the
 * client's values agree. `toStatus` is kept in the input only so the client is
 * unchanged.
 *
 * A refusal is returned, not thrown. Next replaces a thrown message with a
 * generic one in production, and the estimator needs to know which envelope is
 * still out and what to do about it.
 */
export async function recallOfferEnvelope(input: {
  offerId: string;
  scope: "offer" | "tender" | "contract";
  toStatus: OfferStatus;
  note?: string;
}): Promise<
  | { ok: true; status: OfferStatus; voidWarnings: readonly string[] }
  | { ok: false; error: string }
> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    throw new Error(access.error);
  }
  return recallOfferEnvelopeDomain(
    userPrincipal(access.user),
    input,
    prisma,
    createDocusignEnvelopeControl(),
  );
}

// Fork a new active revision from the current one, superseding it. The current
// row is deactivated first so the one-active-per-lead partial index holds. Any
// live Tender/Contract envelope out for signature is voided first, so nobody can
// sign a document that a newer revision has replaced, and nothing is forked
// unless DocuSign confirmed every void.
export async function createOfferRevision(input: {
  offerId: string;
}): Promise<CreateOfferRevisionResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    throw new Error(access.error);
  }
  const created = await createOfferRevisionDomain(
    userPrincipal(access.user),
    input,
    prisma,
    createDocusignEnvelopeControl(),
  );
  if (!created.ok) return created;

  revalidateTag(`offer-lead-${created.leadId}`, CACHE_PROFILES.SHORT);
  // The Offers list shows the live revision and its price.
  updateTag("offers");
  return {
    ok: true,
    offerId: created.offerId,
    leadId: created.leadId,
    voidedEnvelopes: created.voidedEnvelopes,
    voidWarnings: created.voidWarnings,
  };
}
