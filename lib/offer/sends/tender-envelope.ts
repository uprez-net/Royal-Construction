import { EnvelopeDocType, OfferStatus } from "@prisma/client";
import { generatePDF } from "@/lib/pdf/generate-pdf";
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
import {
  buildTenderEnvelopeRecipientRecords,
  createTenderEnvelope,
} from "@/lib/docusign/tender-envelope";
import { resolveEnvelopeCreateError } from "@/lib/docusign/envelope-send-attempt";
import { randomUUID } from "node:crypto";
import { withTenderPaymentTerms } from "@/lib/offer/contract-payment-source";
import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { cancelRacedSend } from "@/lib/docusign/cancel-raced-send";
import {
  beginEnvelopeSendAttempt,
  claimEnvelopeSend,
  persistSentEnvelope,
  readOfferForSend,
  recordEnvelopeSendEvent,
  releaseEnvelopeSendClaim,
  resolveEnvelopeSendAttempt,
  writeTenderEnvelopeDocument,
} from "@/lib/domain/offers/envelope-send";
import { userPrincipal } from "@/lib/domain/principal";
import type { EnvelopeSendPort } from "@/lib/domain/ports/envelope-send";
import type { User } from "@prisma/client";
import type { TransactionalDomainDb } from "@/lib/domain/db";
import type { OfferSendEffects } from "@/lib/offer/sends/effects";

// Moved out of lib/data/offer-tender-sign.ts so the app and Eve run one send.
// The caller authorizes the user against the offer first; effects carry
// the post-write work only a caller can do (cache expiry, the lead-stage
// sync).

export type TenderSendResult =
  | { ok: true; reference: string; envelopeId: string }
  | { ok: false; error: string; status?: "TENDER_SENT" };

const tenderEnvelopePort: EnvelopeSendPort<
  Parameters<typeof createTenderEnvelope>[0],
  Awaited<ReturnType<typeof createTenderEnvelope>>
> = { send: createTenderEnvelope };

// Generate the Tender PDF from the frozen workspace snapshot and send it as a
// runtime DocuSign envelope (no template): signature tabs AutoPlace onto the
// anchor strings baked into the document. The owner(s) sign first, then the
// builder counter-signs (issue #89). Persists Tender + Envelope +
// EnvelopeSignature for the legal audit trail and moves the offer to TENDER_SENT.
export async function sendTenderEnvelope(
  user: User,
  input: {
    offerId: string;
  },
  db: TransactionalDomainDb,
  effects: OfferSendEffects,
): Promise<TenderSendResult> {
  const offer = await readOfferForSend(db, input.offerId);
  if (!offer.workspaceState) {
    return { ok: false, error: "Save the offer before sending the Tender." };
  }
  if (
    offer.offerStatus !== OfferStatus.TENDER_DRAFT
    && offer.offerStatus !== OfferStatus.AGREED
  ) {
    return {
      ok: false,
      error: `Tender can only be sent from an agreed offer (current status: ${offer.offerStatus}).`,
    };
  }

  const snapshot = deserializeWorkspace(
    parseWorkspaceState(offer.workspaceState),
  );

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

  const totalAreaSqm = getAreaBasisTotalSqm(
    offerAreaBasisFromJob(snapshot.job),
  );
  if (totalAreaSqm <= 0) {
    return {
      ok: false,
      error: "Enter floor areas in Job setup before sending the Tender.",
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
  const claim = await claimEnvelopeSend(db, {
    fromStatuses: [OfferStatus.TENDER_DRAFT, OfferStatus.AGREED],
    offerId: offer.id,
    previousStatus: offer.offerStatus,
    toStatus: OfferStatus.TENDER_SENT,
  });
  if (claim.kind === "refused") {
    return {
      ok: false,
      error:
        claim.currentStatus === null
          ? "This offer no longer exists."
          : `The Tender cannot be sent from ${claim.currentStatus}; reload the live offer revision.`,
    };
  }

  const sendAttemptId = `${offer.id}.${randomUUID()}`;
  const attemptStarted = new Date();
  // Before the send, not after it goes wrong (issue #321). Written in the
  // catch instead, a failed write left nothing blocking a recall, so a resend
  // could put a second live document in front of the customer — the exact
  // thing this record exists to prevent. Writing it first also covers the case
  // no catch can reach: the process dying mid-send.
  const sendAttemptRecordId = await beginEnvelopeSendAttempt(db, {
    attemptStarted,
    docType: EnvelopeDocType.TENDER,
    offerId: offer.id,
    sendAttemptId,
  });
  if (sendAttemptRecordId === null) {
    // Give the claim back, exactly as the rejection path does — nothing was
    // sent, so the offer must not sit at *_SENT. Refusing a send is
    // recoverable; sending with nothing to block a later recall is not.
    await releaseEnvelopeSendClaim(db, {
      claimedStatus: OfferStatus.TENDER_SENT,
      offerId: offer.id,
      previousStatus: offer.offerStatus,
    });
    return {
      ok: false,
      error:
        "Could not record the send attempt, so the Tender was not sent. Try again.",
    };
  }
  let envelope;
  let docusignContext: Awaited<
    ReturnType<typeof createDocusignContext>
  > | null = null;
  try {
    docusignContext = await createDocusignContext(config);
    envelope = await tenderEnvelopePort.send({
      context: docusignContext,
      config,
      pdfBase64,
      documentName: `Building-Tender-${reference}.pdf`,
      emailSubject: `Fixed Price Building Tender — ${reference}`,
      builder: {
        name: config.builderSignerName,
        email: config.builderSignerEmail,
      },
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
      console.warn(
        `[offer] tender envelope for offer ${offer.id} reconciled after transport failure: ${recovery.envelopeId}`,
      );
      envelope = {
        envelopeId: recovery.envelopeId,
        recipients: buildTenderEnvelopeRecipientRecords(
          {
            name: config.builderSignerName,
            email: config.builderSignerEmail,
          },
          owners,
        ),
      };
    } else if (recovery.kind === "outcome-unknown") {
      console.error(
        `[offer] tender envelope for offer ${offer.id} outcome unknown; claim kept:`,
        recovery.reason,
        error,
      );
      await recordEnvelopeSendEvent(userPrincipal(user), db, {
        fromStatus: offer.offerStatus,
        note: `DocuSign did not respond in time — checking whether the Tender envelope was sent (${recovery.reason}). Do not resend until this is reconciled.`,
        offerId: offer.id,
        toStatus: OfferStatus.TENDER_SENT,
      });
      // The claim already moved the offer to TENDER_SENT and the event above says
      // so, so the screen and the lead follow the stored status. Returning no
      // status left the screen on the pre-send one until a reload (#502).
      effects.offerChanged(offer.id);
      // Best effort. A failure here must not replace the "Do not resend"
      // answer below with a generic error the office cannot act on.
      try {
        await effects.statusChanged(offer.id);
      } catch (statusError) {
        console.error(
          `[offer] lead sync after an unconfirmed send failed for offer ${offer.id}:`,
          statusError,
        );
      }
      return {
        ok: false,
        status: OfferStatus.TENDER_SENT,
        error:
          "DocuSign did not confirm whether the Tender was sent. Do not resend — wait for reconciliation or check DocuSign before trying again.",
      };
    } else {
      const reason = recovery.reason;
      console.error(
        `[offer] tender envelope creation failed for offer ${offer.id}; claim released:`,
        reason,
        error,
      );
      await recordEnvelopeSendEvent(userPrincipal(user), db, {
        fromStatus: offer.offerStatus,
        note: `DocuSign rejected the Tender envelope: ${reason}`,
        offerId: offer.id,
        toStatus: offer.offerStatus,
      });
      // Definitively refused, so nothing is out for signature and the attempt
      // must stop blocking a recall.
      await resolveEnvelopeSendAttempt(db, sendAttemptRecordId);
      await releaseEnvelopeSendClaim(db, {
        claimedStatus: OfferStatus.TENDER_SENT,
        offerId: offer.id,
        previousStatus: offer.offerStatus,
      });
      return {
        ok: false,
        error: `DocuSign envelope failed: ${reason}`,
      };
    }
  }

  // The render input the Tender was printed from, plus the payment terms on it:
  // the Contract and the project take the signed schedule and deposit from here.
  const documentData = JSON.parse(
    JSON.stringify(withTenderPaymentTerms(proposalInput)),
  );

  const persisted = await persistSentEnvelope(userPrincipal(user), db, {
    claimedStatus: OfferStatus.TENDER_SENT,
    docType: EnvelopeDocType.TENDER,
    sendAttemptRecordId,
    documentVersion: offer.revisionNumber,
    envelopeId: envelope.envelopeId,
    note: `DocuSign envelope ${envelope.envelopeId} sent to ${owners
      .map((owner) => owner.email)
      .join(", ")}`,
    offerId: offer.id,
    previousStatus: offer.offerStatus,
    recipients: envelope.recipients,
    writeDocument: (tx, { claimed }) =>
      writeTenderEnvelopeDocument(tx, {
        claimed,
        documentData,
        offerId: offer.id,
        version: offer.revisionNumber,
      }),
  });

  // Returned rather than raised: Next replaces a Server Action's thrown
  // message with a generic one in production, and the estimator needs the
  // envelope id and the instruction not to resend.
  if (persisted.kind === "unrecorded") {
    // The claim moved the offer to TENDER_SENT in its own transaction
    // before DocuSign was called, and only the envelope transaction rolled
    // back. So the stored status did change: revalidate and bring the lead
    // with it, or the screen shows a stale status and the lead sits a stage
    // behind while the client already has the document.
    effects.offerChanged(offer.id);
    await effects.statusChanged(offer.id);
    return {
      ok: false,
      status: OfferStatus.TENDER_SENT,
      error: `The Tender was sent (DocuSign envelope ${envelope.envelopeId}) but recording it failed. Do not resend — reconcile this envelope before continuing.`,
    };
  }

  // No *_SENT event and no lead sync: the offer is wherever the recall or
  // revision left it.
  if (persisted.kind === "raced") {
    effects.offerChanged(offer.id);
    return cancelRacedSend(envelope.envelopeId);
  }

  effects.offerChanged(offer.id);
  // The status moved to *_SENT above; bring the lead with it. Best effort
  // and outside any transaction — see syncLeadStageForOffer.
  await effects.statusChanged(offer.id);
  return { ok: true, reference, envelopeId: envelope.envelopeId };
}
