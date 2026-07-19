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
      return toLoaded(healed);
    }
    return toLoaded(existing);
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
  | { ok: false; reason: "stale"; currentStateVersion: number | null };

// Debounced autosave with optimistic concurrency (ADR 0002): the write only
// lands if the caller's stateVersion still matches; otherwise it is rejected so
// the client can reload rather than silently clobber a newer save.
export async function saveOfferWorkspace(input: {
  offerId: string;
  expectedStateVersion: number;
  snapshot: OfferWorkspaceSnapshot;
}): Promise<SaveResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    throw new Error(access.error);
  }

  const persisted = serializeWorkspace(input.snapshot);
  const contractValue = new Prisma.Decimal(persisted.selectedPriceCents).div(
    100,
  );

  const result = await prisma.offer.updateMany({
    where: { id: input.offerId, stateVersion: input.expectedStateVersion },
    data: {
      workspaceState: persisted as unknown as Prisma.InputJsonValue,
      contractValueIncGst: contractValue,
      stateVersion: { increment: 1 },
    },
  });

  if (result.count === 0) {
    const current = await prisma.offer.findUnique({
      where: { id: input.offerId },
      select: { stateVersion: true },
    });
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

    const freezeAgreed =
      input.toStatus === OfferStatus.AGREED && offer.workspaceState !== null;

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
  return offers.map((offer) => ({
    offerId: offer.id,
    reference:
      offer.baseReference.trim().length > 0
        ? `${offer.baseReference}-R${offer.revisionNumber}`
        : `R${offer.revisionNumber}`,
    revisionNumber: offer.revisionNumber,
    status: offer.offerStatus,
    contractValueIncGst:
      offer.contractValueIncGst === null
        ? null
        : Number(offer.contractValueIncGst),
    isActive: offer.isActive,
    createdAt: offer.createdAt.toISOString(),
    tenderPdfUrl: offer.tender?.executedPdfUrl ?? null,
    contractPdfUrl: offer.contract?.executedPdfUrl ?? null,
  }));
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
        contractValueIncGst: currentRow.contractValueIncGst,
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
