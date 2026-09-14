"use server";

import { revalidateTag } from "next/cache";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  SignerRole,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { generatePDF } from "@/lib/utils/generatePDF";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import {
  collectOfferSigners,
  collectOwnerIssues,
} from "@/lib/offer/workspace-model";
import { resolveOfferCustomerEmail } from "@/lib/offer/offer-customer-email";
import {
  deserializeWorkspace,
  parseWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import { createOfferAcceptanceEnvelope } from "@/lib/docusign/offer-envelope";
import { describeAcceptanceSendBlock } from "@/lib/offer/offer-acceptance-guard";
import { cancelRacedSend } from "@/lib/docusign/cancel-raced-send";

type OfferAcceptanceSendResult =
  | { ok: true; reference: string; envelopeId: string }
  | { ok: false; error: string };

const isValidEmail = (value: string): boolean =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

// Render the Offer document in "for signature" mode and send it as a customer-only
// DocuSign acceptance envelope (ADR 0004): the customer signs the offer to ACCEPT
// it before the legal Tender is generated. No builder recipient. Mirrors the
// Tender send's concurrency discipline (atomic claim → envelope → transactional
// persistence → reconcile-on-failure), but the envelope hangs directly off the
// Offer (docType OFFER) and moves the offer SENT → OFFER_SENT. The estimator later
// marks the offer AGREED to generate the Tender — signing does not do that.
export async function sendOfferForSignature(input: {
  offerId: string;
}): Promise<OfferAcceptanceSendResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }

  const offer = await prisma.offer.findUnique({
    where: { id: input.offerId },
    select: {
      id: true,
      baseReference: true,
      revisionNumber: true,
      offerStatus: true,
      workspaceState: true,
      lead: true,
    },
  });
  if (!offer) {
    return { ok: false, error: "Offer not found." };
  }
  if (!offer.workspaceState) {
    return {
      ok: false,
      error: "Save the offer before sending it for signature.",
    };
  }
  // The acceptance is sent once negotiation has settled, so gate on SENT (the
  // offer has been issued to the client). Recalling an out-for-signature offer
  // returns it to SENT, from which it can be re-sent.
  //
  // The reason comes from a per-status map rather than printing the enum: the
  // old message reported "current status: OFFER_SENT" while claiming the offer
  // had to be sent to the client first, which reads as its own contradiction
  // and names no way forward.
  const blocked = describeAcceptanceSendBlock(offer.offerStatus);
  if (blocked !== null) {
    return { ok: false, error: blocked };
  }

  let snapshot: ReturnType<typeof deserializeWorkspace>;
  try {
    snapshot = deserializeWorkspace(parseWorkspaceState(offer.workspaceState));
  } catch (error) {
    return {
      ok: false,
      error: `Couldn't read the saved offer: ${(error as Error).message}`,
    };
  }

  // Server-side owner gate (PR #124): re-validate owner completeness and — crucially
  // — UNIQUE signer emails. Two signers sharing an address would create DocuSign
  // recipients the completion webhook can't tell apart (it falls back to email
  // matching), corrupting the per-signer audit.
  const ownerIssues = collectOwnerIssues(snapshot.job.owners);
  if (ownerIssues.length > 0) {
    return {
      ok: false,
      error: `Complete the owner details before sending for signature: ${ownerIssues.join(" ")}`,
    };
  }

  const proposalInput = buildProposalInput(snapshot);
  // A manual price override without a stated reason must not be put out for a
  // binding acceptance — mirror the email send / client-side guard.
  if (proposalInput.customerPrice.needsOverrideReason) {
    return {
      ok: false,
      error:
        "Add a reason for the manual price override before sending the offer for signature.",
    };
  }

  const customerEmail = resolveOfferCustomerEmail({
    jobEmail: snapshot.job.clientEmail,
    leadEmail: offer.lead?.email,
  });
  if (!customerEmail) {
    return {
      ok: false,
      error:
        "No valid client email found on the offer or lead — set the client email in Job setup before sending for signature.",
    };
  }

  let config;
  try {
    config = getDocusignConfig();
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  let pdfBase64: string;
  try {
    pdfBase64 = await generatePDF({
      html: buildProposalHtml(proposalInput, snapshot.images, {
        forSignature: true,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Failed to generate the acceptance PDF: ${(error as Error).message}`,
    };
  }

  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;
  // Build the DocuSign recipients from the ordered signer set — one per individual
  // owner and per company director, in the SAME order as the sigOwner{k} anchors
  // baked into the acceptance PDF (collectOfferSigners). Customer-only.
  const signers = collectOfferSigners(snapshot.job.owners);
  // Every co-owner / director MUST have their own valid email; only the primary
  // signer may fall back to the resolved customer email. Runs before the send is
  // claimed, so a rejection needs no status rollback.
  const signersMissingEmail = signers
    .filter(
      (signer, index) =>
        index > 0 && !isValidEmail((signer.signatory.email ?? "").trim()),
    )
    .map((signer) => signer.signatory.name.trim() || "a co-owner/director");
  if (signersMissingEmail.length > 0) {
    return {
      ok: false,
      error: `Add a valid email for every signatory before sending for signature — missing for: ${signersMissingEmail.join(", ")}.`,
    };
  }
  const owners = signers.map((signer, index) => {
    const own = (signer.signatory.email ?? "").trim();
    return {
      name: signer.signatory.name,
      email: index === 0 ? (isValidEmail(own) ? own : customerEmail) : own,
      capacity: signer.signatory.capacity,
      entityName: signer.entityName,
      entityAbn: signer.entityAbn,
    };
  });
  // Safety net: a snapshot with no owners still needs one customer signer so the
  // acceptance PDF's sigOwner1 anchor receives a recipient.
  if (owners.length === 0) {
    owners.push({
      name: snapshot.job.clientNames,
      email: customerEmail,
      capacity: "Owner",
      entityName: null,
      entityAbn: null,
    });
  }

  // Atomically claim the send so two concurrent calls can't both create a DocuSign
  // envelope (double-send). Only the caller that flips the status off SENT
  // proceeds; the claim is released on envelope failure.
  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, offerStatus: OfferStatus.SENT },
    data: { offerStatus: OfferStatus.OFFER_SENT },
  });
  if (claim.count === 0) {
    // The row was not at SENT at that instant. A concurrent send is only one
    // reason: another tab may have forked a revision (SUPERSEDED), marked the
    // offer agreed, or taken it further down the lifecycle.
    //
    // So re-read rather than assume. Naming OFFER_SENT here would tell an
    // estimator whose revision had just been superseded to "create a revision
    // to replace it", which is both wrong and the exact fault this change set
    // out to fix — a message reporting a status the offer is not in.
    const current = await prisma.offer.findUnique({
      where: { id: offer.id },
      select: { offerStatus: true },
    });
    if (!current) {
      return { ok: false, error: "This offer no longer exists." };
    }
    return {
      ok: false,
      error:
        describeAcceptanceSendBlock(current.offerStatus) ??
        // Back at SENT already: the other send failed and released its claim
        // between our attempt and this read.
        "Someone else was sending this offer for signature just now. Try again.",
    };
  }

  let envelope;
  try {
    const context = await createDocusignContext(config);
    envelope = await createOfferAcceptanceEnvelope({
      context,
      config,
      pdfBase64,
      documentName: `Offer-Acceptance-${reference}.pdf`,
      emailSubject: `Offer acceptance — Royal Constructions ${reference}`,
      owners,
    });
  } catch (error) {
    // Release the claim so the estimator can retry.
    await prisma.offer.updateMany({
      where: { id: offer.id, offerStatus: OfferStatus.OFFER_SENT },
      data: { offerStatus: offer.offerStatus },
    });
    return {
      ok: false,
      error: `DocuSign envelope failed: ${describeDocusignError(error)}`,
    };
  }

  const stillClaimed = await prisma
    .$transaction(async (tx) => {
      await tx.envelope.create({
        data: {
          docType: EnvelopeDocType.OFFER,
          offerId: offer.id,
          docusignId: envelope.envelopeId,
          status: EnvelopeStatus.SENT,
          documentVersion: offer.revisionNumber,
          sentAt: new Date(),
          signatures: {
            create: envelope.recipients.map((recipient) => ({
              recipientRole:
                recipient.role === "BUILDER"
                  ? SignerRole.BUILDER
                  : SignerRole.CUSTOMER,
              name: recipient.name,
              email: recipient.email,
              routingOrder: recipient.routingOrder,
              docusignRecipientId: recipient.recipientId,
              capacity: recipient.capacity ?? null,
              entityName: recipient.entityName ?? null,
              entityAbn: recipient.entityAbn ?? null,
            })),
          },
        },
      });
      // Only over the status this send claimed, on the live revision: a recall
      // or revision during envelope creation must not be overwritten with
      // OFFER_SENT. The envelope row above is still written so it can be
      // cancelled and stays on the audit trail.
      const stillSent = await tx.offer.updateMany({
        where: {
          id: offer.id,
          offerStatus: OfferStatus.OFFER_SENT,
          isActive: true,
        },
        data: {
          offerStatus: OfferStatus.OFFER_SENT,
          // A new envelope replaces the acceptance, so the last envelope's
          // executed PDF no longer describes it. The webhook files this one's.
          executedPdfUrl: null,
        },
      });
      if (stillSent.count === 0) {
        return false;
      }
      await tx.offerStatusEvent.create({
        data: {
          offerId: offer.id,
          fromStatus: offer.offerStatus,
          toStatus: OfferStatus.OFFER_SENT,
          note: `DocuSign acceptance envelope ${envelope.envelopeId} sent to ${owners
            .map((owner) => owner.email)
            .join(", ")}`,
        },
      });
      return true;
    })
    .catch((error) => {
      // The envelope is ALREADY with the client and cannot be un-sent, so this
      // must never release the claim (that would let a retry double-send). Surface
      // the envelope id so the send is recoverable: the offer stays OFFER_SENT but
      // has no envelope/recipient rows, which the completion webhook needs to
      // correlate. Mirrors the Tender/Contract reconcile guard.
      console.error(
        `[offer] acceptance envelope ${envelope.envelopeId} sent but persisting it failed:`,
        error,
      );
      throw new Error(
        `The offer was sent for signature (DocuSign envelope ${envelope.envelopeId}) but recording it failed: ${(error as Error).message}. Do not resend — reconcile this envelope before continuing.`,
      );
    });

  // No *_SENT event and no lead sync: the offer is wherever the recall or
  // revision left it.
  if (!stillClaimed) {
    revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
    return cancelRacedSend(envelope.envelopeId);
  }

  revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  // The status moved to *_SENT above; bring the lead with it. Best effort
  // and outside any transaction — see syncLeadStageForOffer.
  await syncLeadStageForOffer(offer.id);
  return { ok: true, reference, envelopeId: envelope.envelopeId };
}

// DocuSign SDK errors bury the useful message in response.body.
function describeDocusignError(error: unknown): string {
  const response = (error as { response?: { body?: unknown } }).response;
  if (response?.body) {
    const body = response.body as { errorCode?: string; message?: string };
    if (body.message) {
      return body.errorCode ? `${body.errorCode}: ${body.message}` : body.message;
    }
  }
  return (error as Error).message ?? "Unknown error";
}
