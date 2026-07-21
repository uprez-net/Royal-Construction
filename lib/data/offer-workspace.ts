"use server";

import { EnvelopeStatus, OfferStatus, Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  authorizeLeadAccess,
  authorizeOfferAccess,
} from "@/lib/data/offer-access";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import { voidEnvelope } from "@/lib/docusign/void-envelope";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { resolveOfferContractValue } from "@/lib/offer/offer-contract-value";

// Allowed lifecycle transitions for the offer WORKSPACE (the legacy
// OFFER_STATE_MACHINE in offers.ts treats these new states as terminal). The
// early offer phase (pending/sent/agreed/rejected) moves flexibly; the
// tender→contract→project progression must pass each gate in order. A
// self-transition is always allowed so the UI's post-server-action status sync
// (the dedicated send actions already advanced the row) is a harmless no-op.
const OFFER_WORKFLOW_TRANSITIONS: Partial<Record<OfferStatus, OfferStatus[]>> = {
  PENDING: [OfferStatus.SENT, OfferStatus.AGREED, OfferStatus.REJECTED],
  SENT: [OfferStatus.AGREED, OfferStatus.REJECTED, OfferStatus.PENDING],
  REJECTED: [OfferStatus.PENDING, OfferStatus.SENT, OfferStatus.AGREED],
  AGREED: [OfferStatus.TENDER_DRAFT, OfferStatus.SENT, OfferStatus.PENDING],
  TENDER_DRAFT: [OfferStatus.TENDER_SENT, OfferStatus.AGREED],
  TENDER_SENT: [OfferStatus.TENDER_DRAFT, OfferStatus.TENDER_SIGNED],
  TENDER_SIGNED: [OfferStatus.CONTRACT_DRAFT],
  CONTRACT_DRAFT: [OfferStatus.CONTRACT_SENT, OfferStatus.TENDER_SIGNED],
  CONTRACT_SENT: [OfferStatus.CONTRACT_DRAFT, OfferStatus.CONTRACT_SIGNED],
  CONTRACT_SIGNED: [OfferStatus.PROJECT],
  PROJECT: [],
};

// The active offer for a lead, ready to hydrate the workspace. `snapshot` is
// null when the offer has no saved working-state yet (client uses defaults).
type LoadedOfferWorkspace = {
  offerId: string;
  reference: string;
  revisionNumber: number;
  status: OfferStatus;
  stateVersion: number;
  snapshot: OfferWorkspaceSnapshot | null;
  // Set only when the offer is in a *_DECLINED state: the note from the decline
  // status event (carries DocuSign's own reason) so the workspace can tell the
  // operator why the customer declined. Null otherwise.
  declineReason?: string | null;
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
// attach it so the workspace can tell the operator why the customer declined
// and prompt a new revision. A no-op for any non-declined status.
async function attachDeclineReason(
  loaded: LoadedOfferWorkspace,
): Promise<LoadedOfferWorkspace> {
  if (
    loaded.status !== OfferStatus.TENDER_DECLINED &&
    loaded.status !== OfferStatus.CONTRACT_DECLINED
  ) {
    return loaded;
  }
  const event = await prisma.offerStatusEvent.findFirst({
    where: { offerId: loaded.offerId, toStatus: loaded.status },
    orderBy: { at: "desc" },
    select: { note: true },
  });
  return { ...loaded, declineReason: event?.note ?? null };
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
      return attachDeclineReason(toLoaded(healed));
    }
    return attachDeclineReason(toLoaded(existing));
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
  | { ok: false; reason: "superseded" };

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

  const persisted = serializeWorkspace(input.snapshot);
  // Resolve the price through the same path the Tender/Contract and the project
  // handoff use. `selectedPriceCents` is only the OPTIONAL manual override, and a
  // blank override serialises to 0 cents — so reading it here stamped $0 on every
  // offer priced the normal way, which is what the Versions timeline displayed.
  const contractValue = new Prisma.Decimal(
    buildProposalInput(input.snapshot).customerPrice.selectedContractValueIncGst,
  );

  // isActive is part of the predicate, not just the check above: forking a
  // revision deactivates this row without touching its stateVersion, so a save
  // that passed the check moments earlier would still satisfy an id+version
  // predicate and land on the freshly archived revision.
  const result = await prisma.offer.updateMany({
    where: {
      id: input.offerId,
      isActive: true,
      stateVersion: input.expectedStateVersion,
    },
    data: {
      workspaceState: persisted as unknown as Prisma.InputJsonValue,
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

  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  return { ok: true, stateVersion: input.expectedStateVersion + 1 };
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

  await prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findUniqueOrThrow({
      where: { id: input.offerId },
      select: { offerStatus: true, workspaceState: true },
    });

    const allowed =
      offer.offerStatus === input.toStatus ||
      (OFFER_WORKFLOW_TRANSITIONS[offer.offerStatus] ?? []).includes(
        input.toStatus,
      );
    if (!allowed) {
      throw new Error(
        `Invalid offer transition from ${offer.offerStatus} to ${input.toStatus}`,
      );
    }

    // Freeze only on the first transition into AGREED. An AGREED → AGREED
    // re-transition (permitted above) must not re-snapshot a since-mutated
    // workspaceState over the frozen agreedSnapshot or reset acceptedAt.
    const freezeAgreed =
      input.toStatus === OfferStatus.AGREED &&
      offer.offerStatus !== OfferStatus.AGREED &&
      offer.workspaceState !== null;

    await tx.offer.update({
      where: { id: input.offerId },
      data: {
        offerStatus: input.toStatus,
        ...(input.toStatus === OfferStatus.SENT ? { sentAt: new Date() } : {}),
        ...(freezeAgreed
          ? {
              agreedSnapshot: offer.workspaceState as Prisma.InputJsonValue,
              acceptedAt: new Date(),
            }
          : {}),
      },
    });

    await tx.offerStatusEvent.create({
      data: {
        offerId: input.offerId,
        fromStatus: offer.offerStatus,
        toStatus: input.toStatus,
        actorId: input.actorId,
        note: input.note,
      },
    });
  });

  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  return { ok: true, status: input.toStatus };
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
      // How many live DocuSign envelopes were pulled back, and any that could
      // not be voided in DocuSign itself (marked recalled in our DB regardless).
      voidedEnvelopes: number;
      voidWarnings: readonly string[];
    }
  // An executed Contract can't be revised — a change there is a contract
  // variation, a separate instrument, not a new offer revision.
  | { ok: false; reason: "executed" };

// Fork a new active revision from the current one, superseding it. The current
// row is deactivated first so the one-active-per-lead partial index holds. Any
// live Tender/Contract envelope out for signature is voided first, so nobody can
// sign a document that a newer revision has replaced.
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
    current.offerStatus === OfferStatus.CONTRACT_SIGNED ||
    current.offerStatus === OfferStatus.PROJECT
  ) {
    return { ok: false, reason: "executed" };
  }

  // Pull back any envelope still out for signature so the customer can't sign a
  // superseded Tender/Contract. DocuSign voiding is best-effort: if DocuSign is
  // unreachable we still mark the envelope recalled in our system and surface a
  // warning so it can be voided by hand.
  const liveEnvelopes = await prisma.envelope.findMany({
    where: {
      status: EnvelopeStatus.SENT,
      OR: [
        { tender: { offerId: input.offerId } },
        { contract: { offerId: input.offerId } },
      ],
    },
    select: { id: true, docusignId: true },
  });

  const voidWarnings: string[] = [];
  if (liveEnvelopes.length > 0) {
    try {
      const context = await createDocusignContext(getDocusignConfig());
      for (const env of liveEnvelopes) {
        if (!env.docusignId) {
          continue;
        }
        try {
          await voidEnvelope(
            context,
            env.docusignId,
            "Superseded by a new revision of this offer.",
          );
          // Voiding in DocuSign is irreversible, so commit the VOIDED status in
          // its own write right away — if the revision transaction below rolls
          // back, the DB must not keep this envelope SENT while it's dead in
          // DocuSign. SENT-only guard avoids clobbering a webhook-set terminal
          // state.
          await prisma.envelope.updateMany({
            where: { id: env.id, status: EnvelopeStatus.SENT },
            data: { status: EnvelopeStatus.VOIDED, voidedAt: new Date() },
          });
        } catch {
          voidWarnings.push(
            `DocuSign envelope ${env.docusignId} could not be voided automatically — void it manually in DocuSign.`,
          );
        }
      }
    } catch {
      voidWarnings.push(
        "DocuSign was unreachable — the previous envelope was recalled in the system but may still be live in DocuSign; void it manually.",
      );
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const currentRow = await tx.offer.findUniqueOrThrow({
      where: { id: input.offerId },
    });

    if (liveEnvelopes.length > 0) {
      // Only void rows that are still SENT — if a webhook marked one completed
      // between our read and here, don't clobber that terminal state.
      await tx.envelope.updateMany({
        where: {
          id: { in: liveEnvelopes.map((env) => env.id) },
          status: EnvelopeStatus.SENT,
        },
        data: { status: EnvelopeStatus.VOIDED, voidedAt: new Date() },
      });
    }

    await tx.offer.update({
      where: { id: currentRow.id },
      data: { isActive: false, offerStatus: OfferStatus.SUPERSEDED },
    });

    const next = await tx.offer.create({
      data: {
        leadId: currentRow.leadId,
        baseReference: currentRow.baseReference,
        revisionNumber: currentRow.revisionNumber + 1,
        isActive: true,
        createdById: input.actorId,
        offerStatus: OfferStatus.PENDING,
        amount: currentRow.amount,
        gstAmount: currentRow.gstAmount,
        totalAmount: currentRow.totalAmount,
        // Derive rather than copy: the parent's column may predate the fix that
        // wrote the resolved price, and inheriting it would carry that $0 into
        // every future revision even after the parent's own row is repaired.
        contractValueIncGst:
          resolveOfferContractValue(
            currentRow.contractValueIncGst === null
              ? null
              : Number(currentRow.contractValueIncGst),
            currentRow.workspaceState,
          ) ?? currentRow.contractValueIncGst,
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

  revalidateTag(`offer-lead-${created.leadId}`, CACHE_PROFILES.SHORT);
  return {
    ok: true,
    offerId: created.id,
    leadId: created.leadId,
    voidedEnvelopes: liveEnvelopes.length,
    voidWarnings,
  };
}
