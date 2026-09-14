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
import { buildTenderHtml } from "@/lib/offer/offer-tender-html";
import {
  collectOfferSigners,
  collectOwnerIssues,
} from "@/lib/offer/workspace-model";
import { getPaymentScheduleTotalPct } from "@/lib/offer/workspace-payment-schedule";
import { resolveOfferCustomerEmail } from "@/lib/offer/offer-customer-email";
import {
  deserializeWorkspace,
  parseWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import { createTenderEnvelope } from "@/lib/docusign/tender-envelope";
import { withTenderPaymentTerms } from "@/lib/offer/contract-payment-source";
import { cancelRacedSend } from "@/lib/docusign/cancel-raced-send";
import {
  describeGrannyExclusionConflicts,
  findGrannyExclusionConflicts,
} from "@/lib/offer/granny-exclusion";

type TenderSendResult =
  | { ok: true; reference: string; envelopeId: string }
  | { ok: false; error: string };

// Generate the Tender PDF from the frozen workspace snapshot and send it as a
// runtime DocuSign envelope (no template): signature tabs AutoPlace onto the
// anchor strings baked into the document. The owner(s) sign first, then the
// builder counter-signs (issue #89). Persists Tender + Envelope +
// EnvelopeSignature for the legal audit trail and moves the offer to TENDER_SENT.
export async function sendTenderForSignature(input: {
  offerId: string;
}): Promise<TenderSendResult> {
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
    return { ok: false, error: "Save the offer before sending the Tender." };
  }
  if (
    offer.offerStatus !== OfferStatus.TENDER_DRAFT &&
    offer.offerStatus !== OfferStatus.AGREED
  ) {
    return {
      ok: false,
      error: `Tender can only be sent from an agreed offer (current status: ${offer.offerStatus}).`,
    };
  }

  const snapshot = deserializeWorkspace(parseWorkspaceState(offer.workspaceState));

  // Server-side owner gate (PR #124): re-validate owner completeness — crucially,
  // UNIQUE signer emails. Two signers sharing an address would create DocuSign
  // recipients the completion webhook can't tell apart (it falls back to email
  // matching), corrupting the per-signer audit. Guards existing/directly-invoked
  // offers that never passed the client gate.
  const ownerIssues = collectOwnerIssues(snapshot.job.owners);
  if (ownerIssues.length > 0) {
    return {
      ok: false,
      error: `Complete the owner details before sending the Tender: ${ownerIssues.join(" ")}`,
    };
  }

  // A granny flat priced on one page and excluded on another. Checked on the
  // workspace the Tender renders from; the Offer steps are locked by now, so
  // the fix is a revision.
  const grannyConflicts = findGrannyExclusionConflicts(snapshot);
  if (grannyConflicts.length > 0) {
    return {
      ok: false,
      error: describeGrannyExclusionConflicts(grannyConflicts, {
        revisionNeeded: true,
      }),
    };
  }

  // A Tender is a fixed-price contract: its progress-payment schedule must sum
  // to exactly the contract value (100%), or the customer is asked to sign a
  // schedule that over- or under-claims. Block sending an unbalanced schedule.
  const scheduleTotalPct = getPaymentScheduleTotalPct(snapshot.paymentSchedule);
  if (scheduleTotalPct !== 1) {
    return {
      ok: false,
      error: `The Tender payment schedule must total 100% before sending (currently ${Math.round(
        scheduleTotalPct * 100,
      )}%).`,
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
        "No valid client email found on the offer or lead — set the client email in Job setup before sending the Tender.",
    };
  }
  let config;
  try {
    config = getDocusignConfig();
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const proposalInput = buildProposalInput(snapshot);
  let pdfBase64: string;
  try {
    pdfBase64 = await generatePDF({ html: buildTenderHtml(proposalInput) });
  } catch (error) {
    return {
      ok: false,
      error: `Failed to generate the Tender PDF: ${(error as Error).message}`,
    };
  }

  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;
  // Build the DocuSign recipient list from the ordered signer set — one
  // recipient per individual owner and per company director, in the SAME order
  // as the sigOwner{k} anchors baked into the Tender PDF (collectOfferSigners).
  const isValidEmail = (value: string): boolean =>
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
  const signers = collectOfferSigners(snapshot.job.owners);
  // Every co-owner / director MUST have their own valid email. Falling back to
  // the primary client's inbox would send that signer's DocuSign link to the
  // wrong party, letting them access/sign on the other's behalf (codex #2). Only
  // the primary signer may use the resolved customer email. Runs before the send
  // is claimed, so a rejection needs no status rollback.
  const signersMissingEmail = signers
    .filter(
      (signer, index) =>
        index > 0 && !isValidEmail((signer.signatory.email ?? "").trim()),
    )
    .map((signer) => signer.signatory.name.trim() || "a co-owner/director");
  if (signersMissingEmail.length > 0) {
    return {
      ok: false,
      error: `Add a valid email for every signatory before sending the Tender — missing for: ${signersMissingEmail.join(", ")}.`,
    };
  }
  const owners = signers.map((signer, index) => {
    const own = (signer.signatory.email ?? "").trim();
    return {
      name: signer.signatory.name,
      // Primary may use the resolved customer email; others use their own
      // (validated above).
      email: index === 0 ? (isValidEmail(own) ? own : customerEmail) : own,
      capacity: signer.signatory.capacity,
      entityName: signer.entityName,
      entityAbn: signer.entityAbn,
    };
  });
  // Safety net: a snapshot with no owners still needs one customer signer so the
  // Tender's owner anchors receive a recipient.
  if (owners.length === 0) {
    owners.push({
      name: snapshot.job.clientNames,
      email: customerEmail,
      capacity: "Owner",
      entityName: null,
      entityAbn: null,
    });
  }

  // Atomically claim the send so two concurrent calls can't both create a
  // DocuSign envelope (double-send). Only the caller that flips the status off
  // TENDER_DRAFT/AGREED proceeds; the claim is released on envelope failure.
  const claim = await prisma.offer.updateMany({
    where: {
      id: offer.id,
      offerStatus: { in: [OfferStatus.TENDER_DRAFT, OfferStatus.AGREED] },
    },
    data: { offerStatus: OfferStatus.TENDER_SENT },
  });
  if (claim.count === 0) {
    return {
      ok: false,
      error: "The Tender is already being sent or has been sent.",
    };
  }

  let envelope;
  try {
    const context = await createDocusignContext(config);
    envelope = await createTenderEnvelope({
      context,
      config,
      pdfBase64,
      documentName: `Building-Tender-${reference}.pdf`,
      emailSubject: `Fixed Price Building Tender — ${reference}`,
      builder: {
        name: config.builderSignerName,
        email: config.builderSignerEmail,
      },
      owners,
    });
  } catch (error) {
    const reason = describeDocusignError(error);
    // Logged and recorded before the claim is released. The release puts the
    // offer back exactly where it was and the refusal reaches only whoever
    // clicked, so otherwise nothing showed that a send was tried and rejected.
    console.error(
      `[offer] tender envelope creation failed for offer ${offer.id}; claim released:`,
      reason,
      error,
    );
    await prisma.offerStatusEvent
      .create({
        data: {
          offerId: offer.id,
          fromStatus: offer.offerStatus,
          toStatus: offer.offerStatus,
          note: `DocuSign rejected the Tender envelope: ${reason}`,
          actorId: access.user.id,
        },
      })
      .catch((eventError) =>
        console.error(
          "[offer] recording the rejected tender envelope failed:",
          eventError,
        ),
      );
    // Release the claim so the builder can retry.
    await prisma.offer.updateMany({
      where: { id: offer.id, offerStatus: OfferStatus.TENDER_SENT },
      data: { offerStatus: offer.offerStatus },
    });
    return {
      ok: false,
      error: `DocuSign envelope failed: ${describeDocusignError(error)}`,
    };
  }

  // The render input the Tender was printed from, plus the payment terms on it:
  // the Contract and the project take the signed schedule and deposit from here.
  const documentData = JSON.parse(
    JSON.stringify(withTenderPaymentTerms(proposalInput)),
  );

  const stillClaimed = await prisma.$transaction(async (tx) => {
    const tender = await tx.tender.upsert({
      where: { offerId: offer.id },
      update: {
        version: offer.revisionNumber,
        documentData,
        // A new envelope replaces the document, so the last envelope's executed
        // PDF no longer describes it. The webhook files this one's on completion.
        executedPdfUrl: null,
      },
      create: {
        offerId: offer.id,
        version: offer.revisionNumber,
        documentData,
      },
    });
    await tx.envelope.create({
      data: {
        docType: EnvelopeDocType.TENDER,
        tenderId: tender.id,
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
    // Only over the status this send claimed, on the live revision. A recall or
    // Create revision that ran while DocuSign was creating the envelope has
    // moved the offer on, and writing TENDER_SENT back put a recalled offer out
    // for signature again. The envelope row is still written above, so the
    // envelope stays on the audit trail and can be cancelled.
    const stillSent = await tx.offer.updateMany({
      where: {
        id: offer.id,
        offerStatus: OfferStatus.TENDER_SENT,
        isActive: true,
      },
      data: { offerStatus: OfferStatus.TENDER_SENT },
    });
    if (stillSent.count === 0) {
      return false;
    }
    await tx.offerStatusEvent.create({
      data: {
        offerId: offer.id,
        fromStatus: offer.offerStatus,
        toStatus: OfferStatus.TENDER_SENT,
        actorId: access.user.id,
        // Record the ACTUAL customer recipients (every owner/director the envelope
        // routed to), not just the resolved customerEmail — which may not even be
        // the primary signer's address (PR #124 review).
        note: `DocuSign envelope ${envelope.envelopeId} sent to ${owners.map((owner) => owner.email).join(", ")}`,
      },
    });
    return true;
  })
    .catch((error) => {
      // The envelope is ALREADY with the client and cannot be un-sent, so this
      // must never release the claim (that would let a retry double-send a
      // contract-grade document). Surface the envelope id so the send is
      // recoverable: the offer stays TENDER_SENT but has no Tender/recipient
      // rows, which the completion webhook needs to correlate (PR #124 sweep —
      // this write was previously unguarded, mirroring the handoff finding).
      console.error(
        `[offer] tender envelope ${envelope.envelopeId} sent but persisting it failed:`,
        error,
      );
      return { unrecorded: (error as Error).message } as const;
    });

  // Returned rather than raised: Next replaces a Server Action's thrown
  // message with a generic one in production, and the estimator needs the
  // envelope id and the instruction not to resend.
  if (typeof stillClaimed === "object") {
    return {
      ok: false,
      error: `The Tender was sent (DocuSign envelope ${envelope.envelopeId}) but recording it failed: ${stillClaimed.unrecorded}. Do not resend — reconcile this envelope before continuing.`,
    };
  }

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
