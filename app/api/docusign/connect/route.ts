import { NextResponse } from "next/server";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import { revalidateTag } from "next/cache";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  Prisma,
  Role,
  SignerStatus,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { verifyConnectSignature } from "@/lib/docusign/connect-signature";
import {
  archiveExecuted,
  archiveUnexpectedCompletion,
  type ExecutedParent,
} from "@/lib/docusign/archive-executed";
import {
  classifyCompletion,
  completedEventNote,
  completedEventNotePrefix,
  isArchivedForEnvelope,
  isDeclinableEnvelopeStatus,
  legacyCompletedEventNote,
  unexpectedCompletionNote,
  unexpectedCompletionNotePrefix,
  unexpectedDeclineNote,
  unexpectedDeclineNotePrefix,
} from "@/lib/docusign/completion-classifier";
import {
  envelopeStatusRank,
  LIVE_ENVELOPE_STATUSES,
} from "@/lib/docusign/envelope-status";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "@/lib/notification/novu";
import { signerStatusesBelow } from "@/lib/offer/signing-status";

// DocuSign Connect (JSON SIM) webhook: keeps Envelope + EnvelopeSignature in
// step with signing progress, and on completion archives the executed PDF and
// advances the offer (TENDER_SENT → TENDER_SIGNED / CONTRACT_SENT →
// CONTRACT_SIGNED). Always answers 200 for events we don't track so DocuSign
// doesn't retry them forever. An executed PDF that could not be archived answers
// 500, so DocuSign redelivers until it is on file (issue #90).
export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.text();

  const hmacKey = process.env.DOCUSIGN_CONNECT_HMAC_KEY;
  if (hmacKey) {
    // DocuSign supports SEVERAL concurrent Connect HMAC keys — that is how a key
    // is rotated without downtime — and signs each delivery with EVERY active
    // key, emitting one header per key: x-docusign-signature-1, -2, -3…
    // Checking only `-1` therefore breaks the moment a second key is added: the
    // header we read is signed with the OLD key while the env var holds the NEW
    // one, so every callback 401s (observed on staging, PR #124 follow-up). The
    // payload is authentic if it matches ANY of the presented signatures.
    if (!verifyConnectSignature(request.headers, raw, hmacKey)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      "[docusign] Connect webhook received without DOCUSIGN_CONNECT_HMAC_KEY configured — rejecting.",
    );
    return NextResponse.json({ error: "HMAC not configured" }, { status: 401 });
  }

  let payload: ConnectPayload;
  try {
    payload = JSON.parse(raw) as ConnectPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = payload.event;
  const docusignId = payload.data?.envelopeId;
  if (!event || !docusignId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const envelope = await prisma.envelope.findUnique({
    where: { docusignId },
    include: {
      signatures: true,
      tender: { select: { id: true, offerId: true, executedPdfUrl: true } },
      contract: { select: { id: true, offerId: true, executedPdfUrl: true } },
      // An OFFER-type acceptance envelope hangs directly off the Offer (ADR 0004).
      offer: { select: { id: true, executedPdfUrl: true } },
    },
  });
  if (!envelope) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const offerId =
    envelope.tender?.offerId ??
    envelope.contract?.offerId ??
    envelope.offer?.id;
  try {
    await syncRecipients(envelope.id, envelope.signatures, payload);
    await syncEnvelopeStatus(envelope, event, payload);
  } catch (error) {
    console.error("[docusign] Connect processing failed:", error);
    // 500 → DocuSign retries with backoff, which is what we want here.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  } finally {
    // This webhook advances offer status (TENDER_SENT → TENDER_SIGNED, etc.)
    // and per-signer state, but nothing invalidated the caches keyed on the
    // offer — every other writer (send/sign actions) does. In a finally because
    // an archive failure still returns 500 after the status has moved, and the
    // cached view must not keep showing the offer as unsigned. Best-effort: a
    // revalidation failure must not change the response DocuSign gets.
    if (offerId) {
      try {
        revalidateTag(`offer-${offerId}`, CACHE_PROFILES.SHORT);
      } catch (error) {
        console.error(
          "[docusign] revalidate after Connect sync failed:",
          error,
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}

type ConnectRecipient = {
  recipientId?: string;
  email?: string;
  routingOrder?: string;
  status?: string;
  signedDateTime?: string;
  declinedReason?: string;
};

type ConnectPayload = {
  event?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: {
      recipients?: { signers?: ConnectRecipient[] };
      voidedReason?: string;
    };
    voidedReason?: string;
  };
};

const RECIPIENT_STATUS: Record<string, SignerStatus> = {
  sent: SignerStatus.SENT,
  delivered: SignerStatus.DELIVERED,
  completed: SignerStatus.SIGNED,
  signed: SignerStatus.SIGNED,
  declined: SignerStatus.DECLINED,
};

async function syncRecipients(
  envelopeId: string,
  signatures: readonly {
    id: string;
    docusignRecipientId: string | null;
    email: string;
    routingOrder: number;
  }[],
  payload: ConnectPayload,
): Promise<void> {
  const signers = payload.data?.envelopeSummary?.recipients?.signers ?? [];
  for (const signer of signers) {
    const status = RECIPIENT_STATUS[(signer.status ?? "").toLowerCase()];
    if (!status) {
      continue;
    }
    const match =
      signatures.find(
        (s) =>
          s.docusignRecipientId !== null &&
          s.docusignRecipientId === signer.recipientId,
      ) ??
      signatures.find(
        (s) => s.email.toLowerCase() === (signer.email ?? "").toLowerCase(),
      );
    if (!match) {
      continue;
    }
    // Forward-only, like the envelope status: a replayed or out-of-order event
    // must not move a signed recipient back to delivered. SIGNED is never in
    // the list for SIGNED, so signedAt is written only on the move into it.
    await prisma.envelopeSignature.updateMany({
      where: {
        id: match.id,
        status: { in: signerStatusesBelow(status) as SignerStatus[] },
      },
      data: {
        status,
        ...(status === SignerStatus.SIGNED
          ? {
              signedAt: signer.signedDateTime
                ? new Date(signer.signedDateTime)
                : new Date(),
            }
          : {}),
      },
    });
  }
}

const ENVELOPE_STATUS: Record<string, EnvelopeStatus> = {
  "envelope-sent": EnvelopeStatus.SENT,
  "envelope-delivered": EnvelopeStatus.DELIVERED,
  "envelope-completed": EnvelopeStatus.COMPLETED,
  "envelope-declined": EnvelopeStatus.DECLINED,
  "envelope-voided": EnvelopeStatus.VOIDED,
};

// The envelope shape the webhook loads. An envelope hangs off exactly one parent:
// a Tender, a Contract, or — for an OFFER-type acceptance (ADR 0004) — the Offer
// directly.
type ConnectEnvelope = {
  id: string;
  docusignId: string | null;
  docType: EnvelopeDocType;
  status: EnvelopeStatus;
  tender: { id: string; offerId: string; executedPdfUrl: string | null } | null;
  contract: {
    id: string;
    offerId: string;
    executedPdfUrl: string | null;
  } | null;
  offer: { id: string; executedPdfUrl: string | null } | null;
};

// Everything the completion/decline paths need to treat an envelope's parent
// uniformly: which Offer it belongs to, where the executed PDF is archived, and
// which offer-status a completion / decline advances to.
type EnvelopeTarget = {
  offerId: string;
  executedPdfUrl: string | null;
  parent: ExecutedParent;
  // How the document is named in audit notes and notifications.
  documentLabel: string;
  signedStatus: OfferStatus;
  declinedStatus: OfferStatus;
  voidedStatus: OfferStatus;
  expectedFromStatus: OfferStatus;
  // Only a fully-executed Contract nudges the admins to create the project.
  notifyContractSigned: boolean;
  // Matches this envelope's siblings, so a decline only moves the offer when it
  // is the CURRENT (latest-sent) envelope for the document.
  siblingEnvelopeWhere:
    | { tenderId: string }
    | { contractId: string }
    | { offerId: string };
};

function resolveEnvelopeTarget(
  envelope: ConnectEnvelope,
): EnvelopeTarget | null {
  switch (envelope.docType) {
    case EnvelopeDocType.TENDER:
      if (!envelope.tender) return null;
      return {
        offerId: envelope.tender.offerId,
        executedPdfUrl: envelope.tender.executedPdfUrl,
        parent: { kind: "tender", id: envelope.tender.id },
        documentLabel: "Tender",
        signedStatus: OfferStatus.TENDER_SIGNED,
        declinedStatus: OfferStatus.TENDER_DECLINED,
        voidedStatus: OfferStatus.TENDER_DRAFT,
        expectedFromStatus: OfferStatus.TENDER_SENT,
        notifyContractSigned: false,
        siblingEnvelopeWhere: { tenderId: envelope.tender.id },
      };
    case EnvelopeDocType.CONTRACT:
      if (!envelope.contract) return null;
      return {
        offerId: envelope.contract.offerId,
        executedPdfUrl: envelope.contract.executedPdfUrl,
        parent: { kind: "contract", id: envelope.contract.id },
        documentLabel: "Contract",
        signedStatus: OfferStatus.CONTRACT_SIGNED,
        declinedStatus: OfferStatus.CONTRACT_DECLINED,
        voidedStatus: OfferStatus.CONTRACT_DRAFT,
        expectedFromStatus: OfferStatus.CONTRACT_SENT,
        notifyContractSigned: true,
        siblingEnvelopeWhere: { contractId: envelope.contract.id },
      };
    case EnvelopeDocType.OFFER:
      // Offer-acceptance envelope (ADR 0004): the parent IS the Offer, so the
      // executed PDF is archived onto Offer.executedPdfUrl and completion advances
      // OFFER_SENT → OFFER_SIGNED (customer accepted). No admin nudge — the
      // estimator then marks the offer agreed to generate the Tender.
      if (!envelope.offer) return null;
      return {
        offerId: envelope.offer.id,
        executedPdfUrl: envelope.offer.executedPdfUrl,
        parent: { kind: "offer", id: envelope.offer.id },
        documentLabel: "Offer acceptance",
        signedStatus: OfferStatus.OFFER_SIGNED,
        declinedStatus: OfferStatus.OFFER_DECLINED,
        voidedStatus: OfferStatus.SENT,
        expectedFromStatus: OfferStatus.OFFER_SENT,
        notifyContractSigned: false,
        siblingEnvelopeWhere: { offerId: envelope.offer.id },
      };
    default:
      return null;
  }
}

async function syncEnvelopeStatus(
  envelope: ConnectEnvelope,
  event: string,
  payload: ConnectPayload,
): Promise<void> {
  const nextStatus = ENVELOPE_STATUS[event];
  if (!nextStatus) {
    return;
  }

  // Forward-only: advance the envelope status only on a strictly higher rank so
  // a replayed/out-of-order event can't regress it (e.g. a late "sent" after
  // "completed").
  if (envelopeStatusRank(nextStatus) > envelopeStatusRank(envelope.status)) {
    const now = new Date();
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: {
        status: nextStatus,
        ...(nextStatus === EnvelopeStatus.COMPLETED
          ? { completedAt: now }
          : {}),
        ...(nextStatus === EnvelopeStatus.VOIDED ? { voidedAt: now } : {}),
      },
    });
  }

  // A customer decline moves the offer to a revise-ready stage; it never
  // advances to the signed state, so branch off before the completion path.
  if (nextStatus === EnvelopeStatus.DECLINED) {
    await advanceOfferOnDecline(envelope, payload);
    return;
  }

  if (nextStatus === EnvelopeStatus.VOIDED) {
    await returnOfferToDraftOnVoid(envelope, payload);
    return;
  }

  if (nextStatus !== EnvelopeStatus.COMPLETED) {
    return;
  }

  await handleCompletion(envelope);
}

const completionOfferSelect = {
  id: true,
  offerStatus: true,
  isActive: true,
  baseReference: true,
  revisionNumber: true,
  leadId: true,
  agreedSnapshot: true,
  workspaceState: true,
  lead: { select: { name: true } },
} satisfies Prisma.OfferSelect;

type CompletionOffer = Prisma.OfferGetPayload<{
  select: typeof completionOfferSelect;
}>;

// A completion is classified BEFORE anything is filed. Archiving first is how a
// recalled envelope that DocuSign still completed ended up as the executed
// Tender.
//
// Every delivery runs this, not just the first, and each branch is idempotent,
// so a retry after a mid-way failure still finishes the work instead of
// short-circuiting on the already-COMPLETED envelope.
async function handleCompletion(envelope: ConnectEnvelope): Promise<void> {
  const target = resolveEnvelopeTarget(envelope);
  const docusignId = envelope.docusignId;
  if (!target || !docusignId) {
    return;
  }

  const latestEnvelope = await prisma.envelope.findFirst({
    where: target.siblingEnvelopeWhere,
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  // The offer is read BEFORE its events. The advance writes the new status and
  // its event in one transaction, so in this order a concurrent delivery sees
  // either the offer still waiting (advance) or the new status with its event
  // (replay). The other order could see the status without the event and raise
  // a false alarm.
  const offer = await prisma.offer.findUnique({
    where: { id: target.offerId },
    select: completionOfferSelect,
  });
  if (!offer) {
    return;
  }
  const advanceEvent = await prisma.offerStatusEvent.findFirst({
    where: {
      offerId: offer.id,
      OR: [
        { note: { startsWith: completedEventNotePrefix(docusignId) } },
        { note: legacyCompletedEventNote(docusignId) },
      ],
    },
    select: { id: true },
  });
  // Written in one transaction with the row's move to COMPLETED, and the row
  // was loaded before this read, so a delivery that sees that COMPLETED row
  // also sees the flag.
  const unexpectedEvent = await prisma.offerStatusEvent.findFirst({
    where: {
      offerId: offer.id,
      note: { startsWith: unexpectedCompletionNotePrefix(docusignId) },
    },
    select: { id: true },
  });

  const completion = classifyCompletion({
    isLatest: latestEnvelope?.id === envelope.id,
    isActive: offer.isActive,
    offerStatus: offer.offerStatus,
    expectedFromStatus: target.expectedFromStatus,
    envelopeDbStatusBefore: envelope.status,
    advancedByThisEnvelope: advanceEvent !== null,
    flaggedUnexpected: unexpectedEvent !== null,
  });

  let archived = true;
  switch (completion) {
    case "stale-sibling":
      console.warn(
        `[docusign] envelope ${docusignId} completed, but a newer ${target.documentLabel} envelope exists; nothing was filed.`,
      );
      return;
    case "advance":
      if (
        !isArchivedForEnvelope(
          target.executedPdfUrl,
          target.parent.kind,
          docusignId,
        )
      ) {
        archived = await tryArchive(docusignId, () =>
          archiveExecuted(target.parent, docusignId),
        );
      }
      await advanceOfferOnCompletion(envelope, target, offer, docusignId);
      break;
    case "legit-replay":
      // Usually the redelivery after an archive failure: the offer moved on,
      // but its PDF is missing or still the previous envelope's.
      if (
        !isArchivedForEnvelope(
          target.executedPdfUrl,
          target.parent.kind,
          docusignId,
        )
      ) {
        archived = await tryArchive(docusignId, () =>
          archiveExecuted(target.parent, docusignId),
        );
      }
      break;
    case "unexpected":
      archived = await recordUnexpectedCompletion(
        envelope,
        target,
        offer,
        docusignId,
      );
      break;
  }

  // Thrown only now, after the status move, the lead sync and any notification
  // (issue #90). Swallowing it returned 200 with executedPdfUrl still null, so
  // DocuSign never redelivered. The 500 makes it redeliver; the retry finds the
  // offer moved on, classifies as a replay and files the PDF without repeating
  // anything else. An unexpected completion is flagged by its event, so its
  // retry is unexpected again and stores the copy without a second event or
  // notification.
  if (!archived) {
    throw new Error(
      `The executed PDF for DocuSign envelope ${docusignId} was not archived.`,
    );
  }
}

async function tryArchive(
  docusignId: string,
  store: () => Promise<string>,
): Promise<boolean> {
  try {
    await store();
    return true;
  } catch (error) {
    console.error(
      `[docusign] Failed to archive the executed PDF for envelope ${docusignId}:`,
      error,
    );
    return false;
  }
}

function offerReferenceOf(offer: CompletionOffer): string {
  return `${offer.baseReference}-R${offer.revisionNumber}`;
}

function customerNameOf(offer: CompletionOffer): string {
  const snapshot = (offer.agreedSnapshot ?? offer.workspaceState) as {
    job?: { clientNames?: string };
  } | null;
  return snapshot?.job?.clientNames || offer.lead.name || "the client";
}

function siteAddressOf(offer: CompletionOffer): string {
  const snapshot = (offer.agreedSnapshot ?? offer.workspaceState) as {
    job?: { siteAddress?: string };
  } | null;
  return snapshot?.job?.siteAddress ?? "";
}

async function notifyAdmins(
  notification: ReturnType<typeof createNotification>,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: Role.ADMIN },
    select: { id: true },
  });
  await triggerNotification(
    admins.map((admin) => admin.id),
    notification,
  );
}

async function advanceOfferOnCompletion(
  envelope: ConnectEnvelope,
  target: EnvelopeTarget,
  offer: CompletionOffer,
  docusignId: string,
): Promise<void> {
  // Forward-only: transition solely from the matching SENT state so a
  // replayed completion event can't drag an offer that has already moved on
  // (e.g. to PROJECT, or past OFFER_SIGNED to AGREED) back to the signed state.
  const claimed = await prisma.$transaction(async (tx) => {
    const latest = await tx.envelope.findFirst({
      where: target.siblingEnvelopeWhere,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!latest || latest.id !== envelope.id) {
      return false;
    }
    const updated = await tx.offer.updateMany({
      where: {
        id: offer.id,
        isActive: true,
        offerStatus: target.expectedFromStatus,
      },
      data: { offerStatus: target.signedStatus },
    });
    if (updated.count === 0) {
      return false;
    }
    await tx.offerStatusEvent.create({
      data: {
        offerId: offer.id,
        fromStatus: target.expectedFromStatus,
        toStatus: target.signedStatus,
        // The prefix is what lets a later delivery recognise itself as a
        // replay of this advance.
        note: completedEventNote(docusignId),
      },
    });
    return true;
  });

  // Deliberately AFTER the transaction, never inside it. A failure in here
  // must not be able to roll back the signature — see the note on
  // syncLeadStageForOffer for why swallowing an error inside a transaction
  // silently discards the whole thing.
  if (claimed) {
    await syncLeadStageForOffer(offer.id);
  }

  // Contract fully executed → nudge the admins to create the project.
  // Project creation stays a deliberate click (kickoff dates, site manager,
  // and booking warnings need a human), so the nudge is the automation.
  if (claimed && target.notifyContractSigned) {
    try {
      await notifyAdmins(
        createNotification("contractSigned", {
          leadId: String(offer.leadId),
          offerReference: offerReferenceOf(offer),
          customerName: customerNameOf(offer),
          siteAddress: siteAddressOf(offer),
        }),
      );
    } catch (error) {
      // The nudge must never fail the webhook — DocuSign would retry the
      // whole event and re-run the status transition path.
      console.error("[docusign] contract-signed notification failed:", error);
    }
  }
}

// DocuSign completed an envelope the app had recalled, voided or replaced. The
// signed copy is kept apart from the document, the event is recorded once and
// the admins are told once. The parent and the offer are left exactly as they
// were: a withdrawn document must never become the executed one.
//
// Returns whether the signed copy was stored, so the caller can ask DocuSign to
// redeliver when it was not.
async function recordUnexpectedCompletion(
  envelope: ConnectEnvelope,
  target: EnvelopeTarget,
  offer: CompletionOffer,
  docusignId: string,
): Promise<boolean> {
  // Our row must say what DocuSign says. The only place a VOIDED envelope may
  // become COMPLETED: here nothing reads it as executed, because the parent's
  // URL is never written. The move and the event commit together: a COMPLETED
  // row without the event reads as a signature to retry, and the next delivery
  // advanced the offer on the withdrawn envelope.
  const recorded = await recordUnexpectedEvent(
    offer.id,
    unexpectedCompletionNotePrefix(docusignId),
    unexpectedCompletionNote(docusignId, target.documentLabel),
    { completeEnvelopeId: envelope.id },
  );

  const archived = await tryArchive(docusignId, () =>
    archiveUnexpectedCompletion(target.parent.kind, docusignId),
  );
  console.warn(
    `[docusign] envelope ${docusignId} completed after it was recalled or replaced; recorded on offer ${offer.id}, not filed as the executed ${target.documentLabel}.`,
  );

  // Only on the delivery that wrote the event, so a redelivery (including the
  // one an archive failure asks for) does not notify again.
  if (recorded) {
    try {
      await notifyAdmins(
        createNotification("unexpectedEnvelopeCompletion", {
          leadId: String(offer.leadId),
          offerReference: offerReferenceOf(offer),
          documentLabel: target.documentLabel,
          envelopeId: docusignId,
          customerName: customerNameOf(offer),
        }),
      );
    } catch (error) {
      console.error(
        "[docusign] unexpected-completion notification failed:",
        error,
      );
    }
  }
  return archived;
}

// Writes the audit note once per envelope. Returns whether this call wrote it.
// `completeEnvelopeId` moves that envelope to COMPLETED in the same transaction,
// on every delivery, whether or not the note was already there.
async function recordUnexpectedEvent(
  offerId: string,
  notePrefix: string,
  note: string,
  options?: { readonly completeEnvelopeId?: string },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Lock the offer row, so two deliveries of the same event cannot both find
    // no note and both write one.
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "Offer" WHERE "id" = ${offerId} FOR UPDATE`,
    );
    if (locked.length === 0) {
      return false;
    }
    if (options?.completeEnvelopeId) {
      await tx.envelope.updateMany({
        where: {
          id: options.completeEnvelopeId,
          status: { in: [...LIVE_ENVELOPE_STATUSES, EnvelopeStatus.VOIDED] },
        },
        data: { status: EnvelopeStatus.COMPLETED, completedAt: new Date() },
      });
    }
    const existing = await tx.offerStatusEvent.findFirst({
      where: { offerId, note: { startsWith: notePrefix } },
      select: { id: true },
    });
    if (existing) {
      return false;
    }
    const current = await tx.offer.findUnique({
      where: { id: offerId },
      select: { offerStatus: true },
    });
    if (!current) {
      return false;
    }
    // fromStatus == toStatus: an audit note, not a transition.
    await tx.offerStatusEvent.create({
      data: {
        offerId,
        fromStatus: current.offerStatus,
        toStatus: current.offerStatus,
        note,
      },
    });
    return true;
  });
}

// A void from the DocuSign console is the same business event as an in-app
// recall: the document is no longer out for signature, so return the offer to
// its matching draft state. The current-status claim prevents a late or
// duplicate callback from moving a later workflow stage backwards.
async function returnOfferToDraftOnVoid(
  envelope: ConnectEnvelope,
  payload: ConnectPayload,
): Promise<void> {
  const target = resolveEnvelopeTarget(envelope);
  const docusignId = envelope.docusignId;
  if (!target || !docusignId) {
    return;
  }

  const voidReason =
    payload.data?.envelopeSummary?.voidedReason?.trim() ??
    payload.data?.voidedReason?.trim();
  let voided = false;
  await prisma.$transaction(async (tx) => {
    const latest = await tx.envelope.findFirst({
      where: target.siblingEnvelopeWhere,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!latest || latest.id !== envelope.id) {
      return;
    }
    const claim = await tx.offer.updateMany({
      where: {
        id: target.offerId,
        isActive: true,
        offerStatus: target.expectedFromStatus,
      },
      data: { offerStatus: target.voidedStatus },
    });
    if (claim.count === 0) {
      return;
    }
    await tx.offerStatusEvent.create({
      data: {
        offerId: target.offerId,
        fromStatus: target.expectedFromStatus,
        toStatus: target.voidedStatus,
        note: voidReason
          ? `DocuSign voided envelope ${docusignId}: ${voidReason}`
          : `DocuSign voided envelope ${docusignId}.`,
      },
    });
    voided = true;
  });

  if (voided) {
    await syncLeadStageForOffer(target.offerId);
  }
}

// A decline (envelope-declined) moves the offer to a revise-ready stage —
// OFFER_DECLINED / TENDER_DECLINED / CONTRACT_DECLINED — and records DocuSign's
// decline reason on the status event, so the operator sees why and can revise and
// re-issue via a new revision (issue #89, ADR 0004).
async function advanceOfferOnDecline(
  envelope: ConnectEnvelope,
  payload: ConnectPayload,
): Promise<void> {
  const target = resolveEnvelopeTarget(envelope);
  if (!target) {
    return;
  }

  // A decline over an envelope recall or revision already voided moves nothing:
  // the customer is refusing a document the estimator withdrew, and a completion
  // over the same envelope is unexpected too.
  if (!isDeclinableEnvelopeStatus(envelope.status)) {
    await flagUnexpectedDecline(envelope, target);
    return;
  }

  // DocuSign attaches the decliner's reason to the recipient record; surface it
  // rather than inventing our own copy.
  const declineReason = (
    payload.data?.envelopeSummary?.recipients?.signers ?? []
  )
    .find((signer) => (signer.status ?? "").toLowerCase() === "declined")
    ?.declinedReason?.trim();

  // Atomic claim: only the delivery that flips *_SENT -> *_DECLINED records the
  // event, so concurrent duplicate webhooks can't write duplicate audit rows,
  // and a replayed decline (or an offer that already advanced) is a no-op.
  let declined = false;
  await prisma.$transaction(async (tx) => {
    const latest = await tx.envelope.findFirst({
      where: target.siblingEnvelopeWhere,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!latest || latest.id !== envelope.id) {
      return;
    }
    const claim = await tx.offer.updateMany({
      where: {
        id: target.offerId,
        isActive: true,
        offerStatus: target.expectedFromStatus,
      },
      data: { offerStatus: target.declinedStatus },
    });
    if (claim.count === 0) {
      return;
    }
    await tx.offerStatusEvent.create({
      data: {
        offerId: target.offerId,
        fromStatus: target.expectedFromStatus,
        toStatus: target.declinedStatus,
        note: declineReason
          ? `Declined via DocuSign: ${declineReason}`
          : "Declined via DocuSign.",
      },
    });
    declined = true;
  });

  // A decline keeps the deal open rather than closing it, so the lead lands at
  // NEGOTIATING. Outside the transaction, same reasoning as the signed path.
  if (declined) {
    await syncLeadStageForOffer(target.offerId);
    return;
  }

  await flagUnexpectedDecline(envelope, target);
}

// A decline that moved nothing. On an envelope the app had recalled or replaced
// it is still worth a note: the customer is refusing a document the estimator
// withdrew. There is nothing to file, so only the deduplicated event is written.
async function flagUnexpectedDecline(
  envelope: ConnectEnvelope,
  target: EnvelopeTarget,
): Promise<void> {
  const docusignId = envelope.docusignId;
  if (!docusignId) {
    return;
  }
  const latestEnvelope = await prisma.envelope.findFirst({
    where: target.siblingEnvelopeWhere,
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  const offer = await prisma.offer.findUnique({
    where: { id: target.offerId },
    select: { offerStatus: true, isActive: true },
  });
  const current = await prisma.envelope.findUnique({
    where: { id: envelope.id },
    select: { status: true },
  });
  if (!offer || !current) {
    return;
  }
  const kind = classifyCompletion({
    isLatest: latestEnvelope?.id === envelope.id,
    isActive: offer.isActive,
    offerStatus: offer.offerStatus,
    expectedFromStatus: target.expectedFromStatus,
    envelopeDbStatusBefore: envelope.status,
    // The decline note carries no envelope id, so the envelope row stands in
    // for it. A row that now reads DECLINED was live when this or an earlier
    // delivery reached it: the decline was of a document still out, and this is
    // a replay or a race with the delivery that moved the offer. A recalled or
    // replaced envelope stays VOIDED, because a decline does not outrank it.
    advancedByThisEnvelope: current.status === EnvelopeStatus.DECLINED,
    // Only a completion is flagged; this decline's own note is deduplicated.
    flaggedUnexpected: false,
  });
  if (kind !== "unexpected") {
    return;
  }
  await recordUnexpectedEvent(
    target.offerId,
    unexpectedDeclineNotePrefix(docusignId),
    unexpectedDeclineNote(docusignId, target.documentLabel),
  );
}
