"use server";

import { revalidateTag } from "next/cache";
import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import { EnvelopeDocType, OfferStatus } from "@prisma/client";
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
import {
  buildOfferAcceptanceRecipientRecords,
  createOfferAcceptanceEnvelope,
} from "@/lib/docusign/offer-envelope";
import { resolveEnvelopeCreateError } from "@/lib/docusign/envelope-send-attempt";
import { randomUUID } from "node:crypto";
import { describeAcceptanceSendBlock } from "@/lib/offer/offer-acceptance-guard";
import { cancelRacedSend } from "@/lib/docusign/cancel-raced-send";
import {
  beginEnvelopeSendAttempt,
  claimEnvelopeSend,
  persistSentEnvelope,
  readOfferForSend,
  recordEnvelopeSendEvent,
  releaseEnvelopeSendClaim,
  resolveEnvelopeSendAttempt,
} from "@/lib/domain/offers/envelope-send";
import { userPrincipal } from "@/lib/domain/principal";
import type { EnvelopeSendPort } from "@/lib/domain/ports/envelope-send";

type OfferAcceptanceSendResult =
  | { ok: true; reference: string; envelopeId: string }
  | { ok: false; error: string };

const acceptanceEnvelopePort: EnvelopeSendPort<
  Parameters<typeof createOfferAcceptanceEnvelope>[0],
  Awaited<ReturnType<typeof createOfferAcceptanceEnvelope>>
> = { send: createOfferAcceptanceEnvelope };

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

  const offer = await readOfferForSend(prisma, input.offerId);
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

  // Same gate as the proposal and the Tender. A document that tells the client
  // their home is 0 m2 must not reach them, and this is the last place that can
  // refuse before the envelope is created.
  const totalAreaSqm = getAreaBasisTotalSqm(
    offerAreaBasisFromJob(snapshot.job),
  );
  if (totalAreaSqm <= 0) {
    return {
      ok: false,
      error: "Enter floor areas in Job setup before sending for signature.",
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

  // Atomically claim the send so two concurrent calls can't both create a
  // DocuSign envelope. The refusal re-reads rather than assuming why: another
  // tab may have forked a revision (SUPERSEDED), marked the offer agreed, or
  // taken it further down the lifecycle, and naming OFFER_SENT would tell an
  // estimator whose revision had just been superseded to "create a revision to
  // replace it".
  const claim = await claimEnvelopeSend(prisma, {
    fromStatuses: [OfferStatus.SENT],
    offerId: offer.id,
    previousStatus: offer.offerStatus,
    toStatus: OfferStatus.OFFER_SENT,
  });
  if (claim.kind === "refused") {
    if (claim.currentStatus === null) {
      return { ok: false, error: "This offer no longer exists." };
    }
    return {
      ok: false,
      error:
        describeAcceptanceSendBlock(claim.currentStatus) ??
        // Back at SENT already: the other send failed and released its claim
        // between our attempt and this read.
        "Someone else was sending this offer for signature just now. Try again.",
    };
  }

  const sendAttemptId = `${offer.id}.${randomUUID()}`;
  const attemptStarted = new Date();
  // Before the send, not after it goes wrong (issue #321). Written in the
  // catch instead, a failed write left nothing blocking a recall, so a resend
  // could put a second live document in front of the customer — the exact
  // thing this record exists to prevent. Writing it first also covers the case
  // no catch can reach: the process dying mid-send.
  const sendAttemptRecordId = await beginEnvelopeSendAttempt(prisma, {
    attemptStarted,
    docType: EnvelopeDocType.OFFER,
    offerId: offer.id,
    sendAttemptId,
  });
  if (sendAttemptRecordId === null) {
    // Give the claim back, exactly as the rejection path does — nothing was
    // sent, so the offer must not sit at *_SENT. Refusing a send is
    // recoverable; sending with nothing to block a later recall is not.
    await releaseEnvelopeSendClaim(prisma, {
      claimedStatus: OfferStatus.OFFER_SENT,
      offerId: offer.id,
      previousStatus: offer.offerStatus,
    });
    return {
      ok: false,
      error:
        "Could not record the send attempt, so the Offer was not sent. Try again.",
    };
  }
  let envelope;
  let docusignContext: Awaited<
    ReturnType<typeof createDocusignContext>
  > | null = null;
  try {
    docusignContext = await createDocusignContext(config);
    envelope = await acceptanceEnvelopePort.send({
      context: docusignContext,
      config,
      pdfBase64,
      documentName: `Offer-Acceptance-${reference}.pdf`,
      emailSubject: `Offer acceptance — Royal Constructions ${reference}`,
      owners,
      sendAttemptId,
    });
  } catch (error) {
    const recovery = await resolveEnvelopeCreateError({
      error,
      context: docusignContext,
      sendAttemptId,
      attemptStarted,
    });
    if (recovery.kind === "reconciled") {
      // Deliberately NOT settled here. The envelope exists, but nothing yet
      // records it — the success transaction below writes the Envelope row
      // AND settles this attempt together. Settling now would leave a real,
      // live envelope with nothing blocking a recall if that transaction then
      // failed, which is the same fail-open this record exists to close.
      envelope = {
        envelopeId: recovery.envelopeId,
        recipients: buildOfferAcceptanceRecipientRecords(owners),
      };
    } else if (recovery.kind === "outcome-unknown") {
      await recordEnvelopeSendEvent(userPrincipal(access.user), prisma, {
        // offer.offerStatus, not a literal. It happens to be SENT today
        // because that is the only status the claim above accepts — but the
        // tender path proves what a literal costs when that list widens: it
        // accepts TENDER_DRAFT *or* AGREED, and recorded a transition that
        // never happened for every direct send from AGREED.
        fromStatus: offer.offerStatus,
        note: `DocuSign did not respond in time — checking whether the acceptance envelope was sent (${recovery.reason}). Do not resend until this is reconciled.`,
        offerId: offer.id,
        toStatus: OfferStatus.OFFER_SENT,
      });
      return {
        ok: false,
        error:
          "DocuSign did not confirm whether the acceptance envelope was sent. Do not resend — wait for reconciliation or check DocuSign before trying again.",
      };
    } else {
      const reason = recovery.reason;
      console.error(
        `[offer] acceptance envelope creation failed for offer ${offer.id}; claim released:`,
        reason,
        error,
      );
      await recordEnvelopeSendEvent(userPrincipal(access.user), prisma, {
        fromStatus: offer.offerStatus,
        note: `DocuSign rejected the offer acceptance envelope: ${reason}`,
        offerId: offer.id,
        toStatus: offer.offerStatus,
      });
      // Definitively refused, so nothing is out for signature and the attempt
      // must stop blocking a recall.
      await resolveEnvelopeSendAttempt(prisma, sendAttemptRecordId);
      await releaseEnvelopeSendClaim(prisma, {
        claimedStatus: OfferStatus.OFFER_SENT,
        offerId: offer.id,
        previousStatus: offer.offerStatus,
      });
      return {
        ok: false,
        error: `DocuSign envelope failed: ${reason}`,
      };
    }
  }

  const persisted = await persistSentEnvelope(
    userPrincipal(access.user),
    prisma,
    {
      claimedStatus: OfferStatus.OFFER_SENT,
      sendAttemptRecordId,
      // A new envelope replaces the acceptance, so the last envelope's executed
      // PDF no longer describes it. The webhook files this one's.
      clearOfferExecutedPdf: true,
      docType: EnvelopeDocType.OFFER,
      documentVersion: offer.revisionNumber,
      envelopeId: envelope.envelopeId,
      note: `DocuSign acceptance envelope ${envelope.envelopeId} sent to ${owners
        .map((owner) => owner.email)
        .join(", ")}`,
      offerId: offer.id,
      previousStatus: offer.offerStatus,
      recipients: envelope.recipients,
      // The acceptance hangs directly off the Offer (ADR 0004); there is no
      // separate document row to write.
      writeDocument: async () => ({ offer: { connect: { id: offer.id } } }),
    },
  );

  // Returned rather than raised: Next replaces a Server Action's thrown
  // message with a generic one in production, and the estimator needs the
  // envelope id and the instruction not to resend. The claim is deliberately
  // NOT released — the envelope is already with the client.
  if (persisted.kind === "unrecorded") {
    return {
      ok: false,
      error: `The offer was sent for signature (DocuSign envelope ${envelope.envelopeId}) but recording it failed. Do not resend — reconcile this envelope before continuing.`,
    };
  }

  // No *_SENT event and no lead sync: the offer is wherever the recall or
  // revision left it.
  if (persisted.kind === "raced") {
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
