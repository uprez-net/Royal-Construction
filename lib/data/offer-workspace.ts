"use server";

import { EnvelopeStatus, OfferStatus, Prisma } from "@prisma/client";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import { revalidateTag, updateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  authorizeLeadAccess,
  authorizeOfferAccess,
  type OfferAccess,
} from "@/lib/data/offer-access";
import { getDocusignConfig } from "@/lib/docusign/config";
import {
  createDocusignContext,
  type DocusignContext,
} from "@/lib/docusign/client";
import {
  getEnvelopeStatus,
  voidEnvelope,
} from "@/lib/docusign/void-envelope";
import {
  LIVE_ENVELOPE_STATUSES,
  readRefusedVoid,
  type RefusedVoidReading,
} from "@/lib/docusign/envelope-status";
import {
  CURRENT_CALC_VERSION,
  LEGACY_CALC_VERSION,
  canonicalStoredWorkspace,
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  validatePersistedWorkspace,
  type OfferWorkspaceSnapshot,
  type PersistedOfferWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import {
  applyAdminPrefillToSnapshot,
  buildAdminOfferPrefill,
} from "@/lib/offer/admin-offer-prefill";
import {
  isOfferBuildStepEditable,
  lockedSnapshotChanges,
} from "@/lib/offer/offer-editability";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import {
  resolveOfferContractValue,
  resolveOfferPriceSplit,
} from "@/lib/offer/offer-contract-value";
import { splitContractValueByGst } from "@/lib/offer/workspace-pricing";
import {
  parseContractParticularOverrides,
  parseContractParticulars,
  type ContractParticularKey,
  type ContractParticulars,
} from "@/lib/offer/contract-particulars";
import type {
  OfferSignerStatus,
  OfferSignerStatusValue,
} from "@/lib/offer/signing-status";
import {
  collectOwnerIssues,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import {
  classifyOfferTransition,
  requiresOwnerGate,
} from "@/lib/offer/offer-workflow-transitions";
import {
  decideRecallPullBack,
  describeUnconfirmedVoid,
  envelopeScopeFilter,
  resolveRecall,
  type EnvelopeVoidOutcome,
  type OfferEnvelopeScope,
  type UnsettledEnvelope,
} from "@/lib/offer/offer-recall";

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

// A declined offer carries the reason on its most recent decline status event;
// attach it so the workspace can tell the operator why it was declined and
// prompt a new revision. A no-op for any non-declined status.
async function attachDeclineReason(
  loaded: LoadedOfferWorkspace,
): Promise<LoadedOfferWorkspace> {
  return {
    ...loaded,
    declineReason: await loadDeclineReason(loaded.offerId, loaded.status),
  };
}

// Per-recipient DocuSign status for an offer's Tender + Contract envelopes, so
// the signing tracker can show who has actually signed (#121/#123). A document
// can have SEVERAL envelopes over its life — recalling and re-sending creates a
// new one — so only the NEWEST envelope per doc type is reported; older ones are
// superseded and their statuses would be misleading. Shared by the workspace
// loader and the signing-status poll so they can never diverge.
async function loadOfferSignerStatuses(
  offerId: string,
): Promise<OfferSignerStatus[]> {
  const envelopes = await prisma.envelope.findMany({
    where: {
      // Tender/Contract envelopes hang off their record; an OFFER acceptance
      // envelope hangs directly off the Offer (ADR 0004).
      OR: [{ tender: { offerId } }, { contract: { offerId } }, { offerId }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      docType: true,
      signatures: {
        select: {
          recipientRole: true,
          name: true,
          email: true,
          status: true,
          signedAt: true,
          routingOrder: true,
        },
        orderBy: { routingOrder: "asc" },
      },
    },
  });

  // findMany is ordered newest-first, so the first envelope seen for a doc type
  // is the live one.
  const newestPerDocType = new Map<string, (typeof envelopes)[number]>();
  for (const envelope of envelopes) {
    if (!newestPerDocType.has(envelope.docType)) {
      newestPerDocType.set(envelope.docType, envelope);
    }
  }

  const signerStatuses: OfferSignerStatus[] = [];
  for (const envelope of newestPerDocType.values()) {
    for (const signature of envelope.signatures) {
      signerStatuses.push({
        docType:
          envelope.docType === "TENDER"
            ? "TENDER"
            : envelope.docType === "CONTRACT"
              ? "CONTRACT"
              : "OFFER",
        role: signature.recipientRole === "BUILDER" ? "BUILDER" : "CUSTOMER",
        name: signature.name,
        email: signature.email,
        status: signature.status as OfferSignerStatusValue,
        // ISO string, not a Date — this crosses the server → client boundary.
        signedAt: signature.signedAt ? signature.signedAt.toISOString() : null,
        routingOrder: signature.routingOrder,
      });
    }
  }
  return signerStatuses;
}

// The most recent decline-event note for a declined offer status, or null.
// Shared by the loader's decorator and the poll so both surface the same reason.
async function loadDeclineReason(
  offerId: string,
  status: OfferStatus,
): Promise<string | null> {
  if (
    status !== OfferStatus.OFFER_DECLINED &&
    status !== OfferStatus.TENDER_DECLINED &&
    status !== OfferStatus.CONTRACT_DECLINED
  ) {
    return null;
  }
  const event = await prisma.offerStatusEvent.findFirst({
    where: { offerId, toStatus: status },
    orderBy: { at: "desc" },
    select: { note: true },
  });
  return event?.note ?? null;
}

// Admin content versioning (see AdminOfferContent.version). Each offer stamps
// the admin version its cost lines / allowances / exclusions / draft copy came
// from. When the offer is OPENED and that stamp is behind the live admin
// version, one of two things happens:
//
//   - the offer is still editable (`pending`): the current admin defaults are
//     re-applied and persisted, so an admin correction reaches every offer that
//     has not gone out yet without anyone reopening each one by hand;
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

  let prefill: Awaited<ReturnType<typeof buildAdminOfferPrefill>>;
  try {
    prefill = await buildAdminOfferPrefill();
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

async function attachSignerStatus(
  loaded: LoadedOfferWorkspace,
): Promise<LoadedOfferWorkspace> {
  return {
    ...loaded,
    signerStatuses: await loadOfferSignerStatuses(loaded.offerId),
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

// Mint the next base reference (RC-Q-YYYY-NNN) inside a transaction.
async function mintOfferReference(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.offerReferenceCounter.upsert({
    where: { year },
    create: { year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  return `RC-Q-${year}-${String(counter.lastSeq).padStart(3, "0")}`;
}

export async function loadActiveOfferWorkspace(
  leadId: number,
  actorId?: string,
): Promise<LoadedOfferWorkspace> {
  const access = await authorizeLeadAccess(leadId);
  if (!access.ok) {
    throw new Error(access.error);
  }

  const existing = await prisma.offer.findFirst({
    where: { leadId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
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
      return attachSignerStatus(
        await attachContractParticulars(
          await attachDeclineReason(
            await reapplyAdminContentIfStale(toLoaded(healed)),
          ),
        ),
      );
    }
    return attachSignerStatus(
      await attachContractParticulars(
        await attachDeclineReason(
          await reapplyAdminContentIfStale(toLoaded(existing)),
        ),
      ),
    );
  }

  // First offer for this lead — create it with a freshly minted reference.
  const created = await prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const baseReference = await mintOfferReference(tx, year);
    return tx.offer.create({
      data: {
        leadId,
        baseReference,
        revisionNumber: 1,
        isActive: true,
        createdById: actorId,
        offerStatus: OfferStatus.PENDING,
        amount: new Prisma.Decimal(0),
        gstAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
      },
    });
  });
  revalidateTag(`offer-lead-${leadId}`, CACHE_PROFILES.SHORT);
  return toLoaded(created);
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
}): Promise<OfferSigningStatusPoll> {
  const access = await authorizeOfferAccess(input.offerId, {
    allowInactive: true,
  });
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  const offer = await prisma.offer.findUnique({
    where: { id: input.offerId },
    select: { offerStatus: true, stateVersion: true },
  });
  if (!offer) {
    return { ok: false, error: "Offer not found." };
  }
  const [signerStatuses, declineReason] = await Promise.all([
    loadOfferSignerStatuses(input.offerId),
    loadDeclineReason(input.offerId, offer.offerStatus),
  ]);
  return {
    ok: true,
    status: offer.offerStatus,
    stateVersion: offer.stateVersion,
    signerStatuses,
    declineReason,
  };
}

// The ONLY place CURRENT_CALC_VERSION is named on the server. See the CalcVersion
// notes in lib/offer/workspace-persistence.ts.
function pinCalcVersion(
  persisted: PersistedOfferWorkspaceState,
  storedCalcVersion: number | null,
): PersistedOfferWorkspaceState {
  return {
    ...persisted,
    calcVersion: storedCalcVersion ?? CURRENT_CALC_VERSION,
  };
}

// Reads the pin off a raw stored blob without running the full zod parse — this
// runs on the save path and must not throw on an offer whose state is otherwise
// unparseable. A blob with no pin is pre-versioning, hence legacy.
function readStoredCalcVersion(state: unknown): number | null {
  if (state === null || state === undefined) {
    return null;
  }
  if (typeof state !== "object") {
    return LEGACY_CALC_VERSION;
  }
  const raw = (state as Record<string, unknown>).calcVersion;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0
    ? raw
    : LEGACY_CALC_VERSION;
}

// Debounced autosave with optimistic concurrency (ADR 0002): the write only
// lands if the caller's stateVersion still matches; otherwise it is rejected so
// the client can reload rather than silently clobber a newer save.
export async function saveOfferWorkspace(input: {
  offerId: string;
  expectedStateVersion: number;
  snapshot: OfferWorkspaceSnapshot;
}): Promise<SaveResult> {
  // Resolved with allowInactive so a superseded revision comes back as a
  // recoverable result rather than a throw: a second tab that was editing this
  // offer when another tab forked a new revision should reload onto the live
  // revision, not sit in a permanent error state.
  const access = await authorizeOfferAccess(input.offerId, {
    allowInactive: true,
  });
  if (!access.ok) {
    throw new Error(access.error);
  }
  if (!access.isActive) {
    return { ok: false, reason: "superseded" };
  }

  // The offer's calculation rules are stamped by the SERVER, never taken from
  // the client: saveOfferWorkspace persists the client's serialized snapshot
  // wholesale, so a stale tab could otherwise up- or down-grade the maths of a
  // live quote. A row that has never been saved is a brand-new offer and gets
  // today's rules; anything already saved keeps its stored pin forever.
  const storedRow = await prisma.offer.findUnique({
    where: { id: input.offerId },
    select: {
      workspaceState: true,
      offerStatus: true,
      amount: true,
      gstAmount: true,
      totalAmount: true,
      contractValueIncGst: true,
    },
  });
  if (storedRow === null) {
    return { ok: false, reason: "stale", currentStateVersion: null };
  }
  const persisted = pinCalcVersion(
    serializeWorkspace(input.snapshot),
    readStoredCalcVersion(storedRow.workspaceState),
  );
  const validated = validatePersistedWorkspace(persisted);
  if (!validated.ok) {
    console.error(
      `[offer-workspace] refused an invalid snapshot for offer ${input.offerId}: ${validated.error}`,
    );
    return { ok: false, reason: "invalid" };
  }

  // The workspace locks a step's controls once the offer is issued, but this
  // action writes the whole snapshot it is given. A tab still showing the offer
  // as pending after another tab sent it could otherwise change the cost lines
  // and reprice an issued offer. Compared in persisted form, against the stored
  // row as a tab that opened it would save it back.
  const storedStatus = storedRow.offerStatus.toLowerCase() as OfferWorkspaceStatus;
  let storedCanonical: PersistedOfferWorkspaceState | null = null;
  if (storedRow.workspaceState !== null) {
    try {
      storedCanonical = canonicalStoredWorkspace(storedRow.workspaceState);
    } catch (error) {
      // Unreadable, so nothing can be compared. A pending offer has no issued
      // record to protect and the save repairs the row; an issued one keeps it.
      if (storedStatus !== "pending") {
        console.error(
          `[offer-workspace] stored snapshot for issued offer ${input.offerId} is unreadable; refusing the save:`,
          error,
        );
        return { ok: false, reason: "locked" };
      }
    }
  }
  const frozenChanges = lockedSnapshotChanges(
    storedStatus,
    storedCanonical,
    validated.state,
  );
  if (frozenChanges.length > 0) {
    return { ok: false, reason: "locked" };
  }
  // Resolve the price through the same path the Tender/Contract and the project
  // handoff use. `selectedPriceCents` is only the OPTIONAL manual override, and a
  // blank override serialises to 0 cents — so reading it here stamped $0 on every
  // offer priced the normal way, which is what the Versions timeline displayed.
  const selectedContractValueIncGst = buildProposalInput(
    // Deliberately the pinned state, not input.snapshot: the money columns must
    // agree with what was actually persisted, including its calculation rules.
    deserializeWorkspace(persisted),
  ).customerPrice.selectedContractValueIncGst;
  const contractValue = new Prisma.Decimal(selectedContractValueIncGst);
  // The three money columns the Offers list prints (amount / GST / total) were
  // never written after the row was minted at zero, so every offer read $0.00
  // regardless of what the client was actually quoted. Derive them from the SAME
  // number the proposal document prints, so the list and the PDF can never
  // disagree — see splitContractValueByGst for why GST is a back-solve.
  const priceSplit = splitContractValueByGst({
    contractValueIncGst: selectedContractValueIncGst,
    gstRate: input.snapshot.workspacePricingSettings.gstRate,
  });
  const amount = new Prisma.Decimal(priceSplit.amountExGst);
  const gstAmount = new Prisma.Decimal(priceSplit.gstAmount);
  const totalAmount = new Prisma.Decimal(priceSplit.totalIncGst);
  const moneyChanged =
    !sameMoney(storedRow.amount, amount) ||
    !sameMoney(storedRow.gstAmount, gstAmount) ||
    !sameMoney(storedRow.totalAmount, totalAmount) ||
    !sameMoney(storedRow.contractValueIncGst, contractValue);

  // isActive is part of the predicate, not just the check above: forking a
  // revision deactivates this row without touching its stateVersion, so a save
  // that passed the check moments earlier would still satisfy an id+version
  // predicate and land on the freshly archived revision. offerStatus is there
  // for the same reason: the lock above was decided against that status, and a
  // send landing in between must not let this write through.
  const result = await prisma.offer.updateMany({
    where: {
      id: input.offerId,
      isActive: true,
      offerStatus: storedRow.offerStatus,
      stateVersion: input.expectedStateVersion,
    },
    data: {
      workspaceState: persisted as unknown as Prisma.InputJsonValue,
      amount,
      gstAmount,
      totalAmount,
      contractValueIncGst: contractValue,
      stateVersion: { increment: 1 },
    },
  });

  if (result.count === 0) {
    const current = await prisma.offer.findUnique({
      where: { id: input.offerId },
      select: { stateVersion: true, isActive: true },
    });
    // Distinguish the two ways the predicate can miss — they need different
    // recoveries: a stale version reconciles against the same revision, a
    // superseded one has to move to whichever revision is now live.
    if (current !== null && !current.isActive) {
      return { ok: false, reason: "superseded" };
    }
    return {
      ok: false,
      reason: "stale",
      currentStateVersion: current?.stateVersion ?? null,
    };
  }

  // Keep the lead's deal value in step with the quoted contract price.
  // Offer.contractValueIncGst is the authoritative number once an offer
  // exists; a second hand-typed figure on the lead would only ever disagree
  // with it, and would leave the pipeline blank at exactly the stages where a
  // real price is known.
  //
  // updateMany + the NOT filter skips manually-owned leads atomically, with no
  // read-then-write race. A zero/absent price must not null an existing value,
  // hence the greaterThan(0) guard. The offer update above is already scoped to
  // isActive, so a superseded revision cannot reach this point.
  //
  // Deliberately non-fatal. The offer write above has ALREADY committed and
  // bumped stateVersion; letting a sync failure throw here would report the
  // save as failed while it actually succeeded, and the client would then
  // retry against a stale expectedStateVersion and be told it is superseded.
  // Mirroring the value onto the lead is secondary to persisting the offer.
  try {
    if (contractValue.greaterThan(0)) {
      const offerLead = await prisma.offer.findUnique({
        where: { id: input.offerId },
        select: { leadId: true },
      });
      if (offerLead?.leadId) {
        await prisma.lead.updateMany({
          where: {
            id: offerLead.leadId,
            // Match the two syncable states EXPLICITLY. `NOT: { source: "MANUAL" }`
            // looks equivalent but is not: it compiles to NOT (col = 'MANUAL'),
            // which evaluates to NULL — not true — for rows where the column is
            // NULL. That is every lead never manually overridden, so the sync
            // would silently skip almost everything. Verified against Postgres.
            OR: [
              { estimatedValueSource: null },
              { estimatedValueSource: "OFFER" },
            ],
          },
          data: {
            estimatedValue: contractValue,
            estimatedValueSource: "OFFER",
          },
        });
      }
    }
  } catch (error) {
    console.error(
      `[offer-workspace] lead value sync failed for offer ${input.offerId}; the offer itself saved successfully`,
      error,
    );
  }

  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  // The Offers list and its KPIs print these columns from a cached read. Only
  // a price edit moves them, and most autosaves are copy edits.
  if (moneyChanged) {
    updateTag("offers");
  }
  return { ok: true, stateVersion: input.expectedStateVersion + 1 };
}

function sameMoney(
  stored: Prisma.Decimal | null,
  next: Prisma.Decimal,
): boolean {
  return stored !== null && stored.equals(next);
}

// Persist a lifecycle transition, record an audit event, and freeze the agreed
// snapshot on AGREED / stamp sentAt on SENT.
export async function transitionOfferStatus(input: {
  offerId: string;
  toStatus: OfferStatus;
  actorId?: string;
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
    input.toStatus === OfferStatus.OFFER_SIGNED ||
    input.toStatus === OfferStatus.TENDER_SIGNED ||
    input.toStatus === OfferStatus.CONTRACT_SIGNED;
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
    actorId: input.actorId,
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
  },
): Promise<boolean> {
  const committed = await prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findUniqueOrThrow({
      where: { id: input.offerId },
      select: { workspaceState: true },
    });

    // Owner completeness gate (PR #124 review): SENT locks the offer and AGREED
    // freezes it for the Tender, so both require complete owner parties. A
    // missing name / Current Location / signer email (or a shared signer email)
    // must not be lockable and advanced into the legal documents. This guards the
    // generic "Mark sent" / "Mark agreed" path, which does not go through the
    // send actions that already validate owners.
    if (!input.skipOwnerGate && requiresOwnerGate(input.from, input.to)) {
      const verb =
        input.to === OfferStatus.SENT
          ? "marking the offer sent"
          : "marking the offer agreed";
      // A blank offer (no workspaceState) has no owners at all — refuse to lock /
      // freeze it, not just skip the check (PR #124).
      if (!offer.workspaceState) {
        throw new Error(`Add and save offer content before ${verb}.`);
      }
      const ownerIssues = collectOwnerIssues(
        parseWorkspaceState(offer.workspaceState).job.owners,
      );
      if (ownerIssues.length > 0) {
        throw new Error(
          `Complete the owner details before ${verb}: ${ownerIssues.join(" ")}`,
        );
      }
    }

    // Freeze only on the first transition into AGREED. An AGREED → AGREED
    // re-transition (a permitted self-transition) must not re-snapshot a since-mutated
    // workspaceState over the frozen agreedSnapshot or reset acceptedAt.
    const freezeAgreed =
      input.to === OfferStatus.AGREED &&
      input.from !== OfferStatus.AGREED &&
      offer.workspaceState !== null;

    const written = await tx.offer.updateMany({
      where: {
        id: input.offerId,
        offerStatus: input.from,
        isActive: true,
      },
      data: {
        offerStatus: input.to,
        ...(input.stampSentAt ? { sentAt: new Date() } : {}),
        ...(freezeAgreed
          ? {
              agreedSnapshot: offer.workspaceState as Prisma.InputJsonValue,
              acceptedAt: new Date(),
            }
          : {}),
      },
    });
    if (written.count === 0) {
      return false;
    }

    await tx.offerStatusEvent.create({
      data: {
        offerId: input.offerId,
        fromStatus: input.from,
        toStatus: input.to,
        actorId: input.actorId,
        note: input.note,
      },
    });
    return true;
  });
  if (!committed) {
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
  const offers = await prisma.offer.findMany({
    where: { leadId },
    orderBy: { revisionNumber: "desc" },
    select: {
      id: true,
      baseReference: true,
      revisionNumber: true,
      offerStatus: true,
      contractValueIncGst: true,
      isActive: true,
      createdAt: true,
      tender: { select: { executedPdfUrl: true } },
      contract: { select: { executedPdfUrl: true } },
    },
  });

  // Revisions saved before the contract-value fix stored the blank price
  // override ($0) instead of the quoted price, and only their own snapshot can
  // recover it. Fetch those snapshots in one targeted follow-up rather than
  // selecting every revision's workspaceState above — the blobs are large, and
  // once the data is healthy this query matches nothing and costs nothing.
  const unpricedIds = offers
    .filter((offer) => Number(offer.contractValueIncGst ?? 0) <= 0)
    .map((offer) => offer.id);
  const stateById = new Map<string, Prisma.JsonValue | null>(
    unpricedIds.length === 0
      ? []
      : (
          await prisma.offer.findMany({
            where: { id: { in: unpricedIds } },
            select: { id: true, workspaceState: true },
          })
        ).map((row) => [row.id, row.workspaceState]),
  );

  return offers.map((offer) => ({
    offerId: offer.id,
    reference:
      offer.baseReference.trim().length > 0
        ? `${offer.baseReference}-R${offer.revisionNumber}`
        : `R${offer.revisionNumber}`,
    revisionNumber: offer.revisionNumber,
    status: offer.offerStatus,
    contractValueIncGst: resolveOfferContractValue(
      offer.contractValueIncGst === null
        ? null
        : Number(offer.contractValueIncGst),
      stateById.get(offer.id) ?? null,
    ),
    isActive: offer.isActive,
    createdAt: offer.createdAt.toISOString(),
    tenderPdfUrl: offer.tender?.executedPdfUrl ?? null,
    contractPdfUrl: offer.contract?.executedPdfUrl ?? null,
  }));
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

  const offer = await prisma.offer.findUniqueOrThrow({
    where: { id: offerId },
    select: {
      id: true,
      baseReference: true,
      revisionNumber: true,
      offerStatus: true,
      isActive: true,
      createdAt: true,
      workspaceState: true,
    },
  });

  if (offer.workspaceState === null) {
    return { ok: false, reason: "empty" };
  }

  let snapshot: OfferWorkspaceSnapshot;
  try {
    snapshot = deserializeWorkspace(parseWorkspaceState(offer.workspaceState));
  } catch {
    // parseWorkspaceState is a strict zod parse. Surface unreadable history as
    // an empty state rather than taking the whole page down with it.
    return { ok: false, reason: "unreadable" };
  }

  return {
    ok: true,
    offerId: offer.id,
    // Built from the DB columns, never from snapshot.job — a forked revision
    // inherits the parent's workspaceState verbatim, so the reference embedded
    // in the snapshot still names the revision it was copied from.
    reference:
      offer.baseReference.trim().length > 0
        ? `${offer.baseReference}-R${offer.revisionNumber}`
        : `R${offer.revisionNumber}`,
    revisionNumber: offer.revisionNumber,
    status: offer.offerStatus,
    isActive: offer.isActive,
    createdAt: offer.createdAt.toISOString(),
    snapshot,
  };
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
 * Void every envelope in `scope` that is still out for signature, so a customer
 * can no longer sign a document the builder has pulled back.
 *
 * Reports what DocuSign confirmed; callers refuse to move on unless every live
 * envelope is confirmed dead (decideRecallPullBack). An envelope is marked
 * VOIDED only after DocuSign accepts the void, so one that fails stays live
 * here, matching DocuSign. Each status is committed in its own write straight
 * away rather than inside a caller's transaction: voiding is irreversible, so if
 * that transaction rolls back, or a later envelope in the same scope fails, the
 * DB must not show a dead envelope as live. The live-status guard avoids
 * clobbering a terminal status a webhook has already set. "Live" includes
 * DELIVERED: an envelope the customer has opened is still signable.
 *
 * DocuSign refuses to void an envelope that has already ended, so a refusal is
 * followed by reading the envelope's status back from DocuSign. One already
 * voided or declined (its Connect event lost) is recorded as such and counts as
 * dead; refusing it would strand the offer, since nobody could void it again.
 * One DocuSign shows as signed, or still out, is reported unsettled.
 *
 * A row with no docusignId has no DocuSign counterpart (every send writes the id
 * from DocuSign's response in the same write that creates the row), so there is
 * nothing to void and nothing the webhook could ever update. It is marked VOIDED
 * and counted as voided; refusing it would block the offer for good.
 *
 * Deliberately NOT exported: this file is "use server", so an export here would
 * be a callable endpoint that voids envelopes with no authorization of its own.
 * Callers below authorize first.
 */
async function voidLiveOfferEnvelopes(
  offerId: string,
  reason: string,
  scope: OfferEnvelopeScope,
): Promise<EnvelopeVoidOutcome> {
  const liveEnvelopes = await prisma.envelope.findMany({
    where: {
      status: { in: LIVE_ENVELOPE_STATUSES },
      OR: envelopeScopeFilter(offerId, scope),
    },
    select: { id: true, docusignId: true },
  });
  const liveIds = liveEnvelopes.map((env) => env.id);
  const voidedIds: string[] = [];
  const endedIds: string[] = [];
  const unsettled: UnsettledEnvelope[] = [];

  const inDocusign: { id: string; docusignId: string }[] = [];
  for (const env of liveEnvelopes) {
    if (env.docusignId === null) {
      await writeEnvelopeEnded(env.id, EnvelopeStatus.VOIDED);
      voidedIds.push(env.id);
    } else {
      inDocusign.push({ id: env.id, docusignId: env.docusignId });
    }
  }
  if (inDocusign.length === 0) {
    return { liveIds, voidedIds, endedIds, unsettled };
  }

  let context: DocusignContext;
  try {
    context = await createDocusignContext(getDocusignConfig());
  } catch (error) {
    console.error("[offer] could not reach DocuSign to void envelopes:", error);
    for (const env of inDocusign) {
      unsettled.push({ ...env, reason: "still-out" });
    }
    return { liveIds, voidedIds, endedIds, unsettled };
  }

  for (const env of inDocusign) {
    const settled = await settleLiveEnvelope(context, env, reason);
    if (settled.kind === "voided") {
      voidedIds.push(env.id);
    } else if (settled.kind === "ended") {
      endedIds.push(env.id);
    } else {
      unsettled.push({ ...env, reason: settled.reason });
    }
  }
  return { liveIds, voidedIds, endedIds, unsettled };
}

// Void one envelope in DocuSign and record the result. Not exported: this file
// is "use server", and the caller has already authorized.
async function settleLiveEnvelope(
  context: DocusignContext,
  env: { id: string; docusignId: string },
  reason: string,
): Promise<
  | { kind: "voided" }
  | { kind: "ended" }
  | { kind: "unsettled"; reason: UnsettledEnvelope["reason"] }
> {
  try {
    await voidEnvelope(context, env.docusignId, reason);
  } catch (voidError) {
    let reading: RefusedVoidReading = { kind: "still-out" };
    try {
      reading = readRefusedVoid(
        await getEnvelopeStatus(context, env.docusignId),
      );
    } catch (readError) {
      console.error(
        `[offer] could not read envelope ${env.docusignId} back from DocuSign:`,
        readError,
      );
    }
    if (reading.kind !== "ended") {
      console.error(
        `[offer] DocuSign did not void envelope ${env.docusignId}:`,
        voidError,
      );
      return { kind: "unsettled", reason: reading.kind };
    }
    return (await recordEnvelopeEnded(env, reading.status))
      ? { kind: "ended" }
      : { kind: "unsettled", reason: "unrecorded" };
  }

  // DocuSign has voided it, so a failed write is not an unconfirmed void. On a
  // retry DocuSign refuses the void, the read-back finds it voided, and it is
  // recorded then.
  return (await recordEnvelopeEnded(env, EnvelopeStatus.VOIDED))
    ? { kind: "voided" }
    : { kind: "unsettled", reason: "unrecorded" };
}

async function recordEnvelopeEnded(
  env: { id: string; docusignId: string },
  status: EnvelopeStatus,
): Promise<boolean> {
  try {
    await writeEnvelopeEnded(env.id, status);
    return true;
  } catch (error) {
    console.error(
      `[offer] DocuSign has envelope ${env.docusignId} ${status}, but recording it failed:`,
      error,
    );
    return false;
  }
}

// Only over a live status, so a terminal status the webhook already wrote is
// never overwritten.
function writeEnvelopeEnded(id: string, status: EnvelopeStatus) {
  return prisma.envelope.updateMany({
    where: { id, status: { in: LIVE_ENVELOPE_STATUSES } },
    data: {
      status,
      ...(status === EnvelopeStatus.VOIDED ? { voidedAt: new Date() } : {}),
    },
  });
}

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
  actorId?: string;
  note?: string;
}): Promise<
  | { ok: true; status: OfferStatus; voidWarnings: readonly string[] }
  | { ok: false; error: string }
> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    throw new Error(access.error);
  }

  // Decide everything before voiding: an unchecked scope once reached the void
  // query as `OR: undefined` and matched every live envelope in the database.
  const offer = await prisma.offer.findUniqueOrThrow({
    where: { id: input.offerId },
    select: { offerStatus: true, isActive: true },
  });
  const recall = resolveRecall(
    input.scope,
    input.toStatus,
    offer.offerStatus,
    offer.isActive,
  );
  if (!recall.ok) {
    return { ok: false, error: recall.error };
  }

  // Void FIRST, and move the status only once DocuSign has confirmed every void.
  // An unconfirmed void may leave the document signable; showing it as a draft
  // would invite edits to a document the customer can still sign, so the offer
  // stays where it is and the estimator is told why. If the transition fails
  // after a confirmed void, the envelope is already dead — the safe direction.
  const voids = await voidLiveOfferEnvelopes(
    input.offerId,
    "Recalled by the builder.",
    recall.scope,
  );
  if (!decideRecallPullBack(voids).proceed) {
    return {
      ok: false,
      error: describeUnconfirmedVoid({
        unsettled: voids.unsettled,
        voidedCount: voids.voidedIds.length,
        action: "recall",
      }),
    };
  }

  // No owner gate: the offer passed it when it was sent, and it cannot be
  // edited while out for signature, so a gate here could strand a voided
  // envelope behind a status that never steps back. sentAt keeps the date the
  // offer first went out.
  const committed = await commitOfferTransition(access, {
    offerId: input.offerId,
    from: recall.from,
    to: recall.to,
    skipOwnerGate: true,
    stampSentAt: false,
    actorId: input.actorId,
    note: input.note,
  });
  if (!committed) {
    return {
      ok: false,
      error: `${voids.voidedIds.length > 0 ? "The DocuSign envelope was voided and stays voided, but the" : "The"} offer's status changed before the recall could move it back. Refresh to see where it is now.`,
    };
  }

  // Kept for the client's existing check; a recall with anything to warn about
  // is now refused instead.
  return { ok: true, status: recall.to, voidWarnings: [] };
}

// Fork a new active revision from the current one, superseding it. The current
// row is deactivated first so the one-active-per-lead partial index holds. Any
// live Tender/Contract envelope out for signature is voided first, so nobody can
// sign a document that a newer revision has replaced, and nothing is forked
// unless DocuSign confirmed every void.
export async function createOfferRevision(input: {
  offerId: string;
  actorId?: string;
}): Promise<CreateOfferRevisionResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    throw new Error(access.error);
  }

  const current = await prisma.offer.findUniqueOrThrow({
    where: { id: input.offerId },
    select: { offerStatus: true },
  });

  // An executed Contract (or a handed-off Project) is binding — revisions stop
  // here; further changes are contract variations, handled separately.
  if (
    current.offerStatus === OfferStatus.TENDER_SIGNED ||
    current.offerStatus === OfferStatus.CONTRACT_DRAFT ||
    current.offerStatus === OfferStatus.CONTRACT_SENT ||
    current.offerStatus === OfferStatus.CONTRACT_DECLINED ||
    current.offerStatus === OfferStatus.CONTRACT_SIGNED ||
    current.offerStatus === OfferStatus.PROJECT
  ) {
    return { ok: false, reason: "locked" };
  }

  // Pull back any envelope still out for signature so the customer can't sign a
  // superseded Tender, Contract or acceptance.
  const voids = await voidLiveOfferEnvelopes(
    input.offerId,
    "Superseded by a new revision of this offer.",
    "all",
  );
  if (!decideRecallPullBack(voids).proceed) {
    return {
      ok: false,
      reason: "refused",
      error: describeUnconfirmedVoid({
        unsettled: voids.unsettled,
        voidedCount: voids.voidedIds.length,
        action: "revision",
      }),
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const lockedOffer = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "Offer" WHERE "id" = ${input.offerId} FOR UPDATE`,
    );
    if (lockedOffer.length === 0) {
      return null;
    }
    const currentRow = await tx.offer.findUniqueOrThrow({
      where: { id: input.offerId },
    });
    if (
      currentRow.offerStatus === OfferStatus.TENDER_SIGNED ||
      currentRow.offerStatus === OfferStatus.CONTRACT_DRAFT ||
      currentRow.offerStatus === OfferStatus.CONTRACT_SENT ||
      currentRow.offerStatus === OfferStatus.CONTRACT_DECLINED ||
      currentRow.offerStatus === OfferStatus.CONTRACT_SIGNED ||
      currentRow.offerStatus === OfferStatus.PROJECT
    ) {
      return null;
    }

    if (voids.voidedIds.length > 0) {
      // Re-assert only what DocuSign confirmed, and only on rows still live — if
      // a webhook marked one terminal between our read and here, don't clobber it.
      await tx.envelope.updateMany({
        where: {
          // Prisma's `in` wants a mutable array; the helper returns readonly.
          id: { in: [...voids.voidedIds] },
          status: { in: LIVE_ENVELOPE_STATUSES },
        },
        data: { status: EnvelopeStatus.VOIDED, voidedAt: new Date() },
      });
    }

    // A live envelope outside the confirmed voids was sent after they ran.
    // Forking now would supersede an offer the customer can still sign.
    const sentMeanwhile = await tx.envelope.count({
      where: {
        status: { in: LIVE_ENVELOPE_STATUSES },
        OR: envelopeScopeFilter(input.offerId, "all"),
        id: { notIn: [...voids.voidedIds, ...voids.endedIds] },
      },
    });
    if (sentMeanwhile > 0) {
      return "sent-meanwhile" as const;
    }

    await tx.offer.update({
      where: { id: currentRow.id },
      data: { isActive: false, offerStatus: OfferStatus.SUPERSEDED },
    });

    const forkedPriceSplit = resolveOfferPriceSplit(
      currentRow.contractValueIncGst === null
        ? null
        : Number(currentRow.contractValueIncGst),
      currentRow.workspaceState,
    );

    const next = await tx.offer.create({
      data: {
        leadId: currentRow.leadId,
        baseReference: currentRow.baseReference,
        revisionNumber: currentRow.revisionNumber + 1,
        isActive: true,
        createdById: input.actorId,
        offerStatus: OfferStatus.PENDING,
        // Derive rather than copy: the parent's columns may predate the fix
        // that wrote the resolved price, and inheriting them would carry that
        // $0 into every future revision even after the parent's own row is
        // repaired. The fork starts as an unedited copy of the parent's
        // snapshot, so it is priced identically until someone edits it — and a
        // revision sent without an edit must not quote $0.
        amount: forkedPriceSplit?.amountExGst ?? currentRow.amount,
        gstAmount: forkedPriceSplit?.gstAmount ?? currentRow.gstAmount,
        totalAmount: forkedPriceSplit?.totalIncGst ?? currentRow.totalAmount,
        contractValueIncGst:
          forkedPriceSplit?.totalIncGst ?? currentRow.contractValueIncGst,
        workspaceState:
          currentRow.workspaceState === null
            ? Prisma.JsonNull
            : (currentRow.workspaceState as Prisma.InputJsonValue),
      },
    });

    await tx.offer.update({
      where: { id: currentRow.id },
      data: { supersededById: next.id },
    });

    return next;
  });
  if (created === "sent-meanwhile") {
    // A live envelope outside the confirmed voids appeared after they ran.
    return {
      ok: false,
      reason: "refused",
      error:
        "No revision was created: a document on this offer was sent for signature while the revision was being prepared. Refresh and try again.",
    };
  }
  if (!created) {
    return { ok: false, reason: "locked" };
  }

  revalidateTag(`offer-lead-${created.leadId}`, CACHE_PROFILES.SHORT);
  // The Offers list shows the live revision and its price.
  updateTag("offers");
  return {
    ok: true,
    offerId: created.id,
    leadId: created.leadId,
    voidedEnvelopes: voids.voidedIds.length,
    voidWarnings: [],
  };
}
