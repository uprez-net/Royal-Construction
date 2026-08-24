"use server";

import { revalidateTag } from "next/cache";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import { randomBytes } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import { OfferStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { generatePDF } from "@/lib/utils/generatePDF";
import { createElement } from "react";
import { render } from "@react-email/components";
import QuotationEmail from "@/lib/graph/Email/quotation-email";
import { buildOfferQuotationEmailProps } from "@/lib/offer/offer-quotation-email";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import {
  collectOfferSigners,
  collectOwnerIssues,
} from "@/lib/offer/workspace-model";
import {
  deserializeWorkspace,
  parseWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import { getGraphConfig } from "@/lib/graph/config";
import { createGraphContext } from "@/lib/graph/client";
import { authorizeOfferAccess } from "@/lib/data/offer-access";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A DNS answer that positively establishes the domain cannot receive mail, as
// opposed to the resolver merely being unreachable.
const UNDELIVERABLE_DNS_CODES = new Set(["ENOTFOUND", "NXDOMAIN", "ENODATA"]);

// Bound the lookup: a stalled resolver must not hold up the send.
const MX_LOOKUP_TIMEOUT_MS = 5_000;

// Graph accepts any syntactically valid recipient and reports success without
// checking that the domain exists — "gmail.coz" is queued exactly like
// "gmail.com", and the failure only comes back minutes later as a bounce. By
// then the offer is already committed as SENT and the Offer-build steps are
// locked, so a typo'd domain both locks the offer and never reaches the client.
// Confirm the domain can receive mail before we commit to sending.
//
// Fails OPEN on resolver trouble (timeout, SERVFAIL): blocking real sends
// because our DNS blipped is worse than letting one bounce through. Only a
// definitive "this domain does not accept mail" blocks the send.
async function recipientDomainAcceptsMail(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const undeliverable = {
    ok: false as const,
    error: `"${domain}" is not set up to receive email — check the address for a typo.`,
  };

  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), MX_LOOKUP_TIMEOUT_MS),
      ),
    ]);
    if (records === null) {
      console.error(`[offer] MX lookup for "${domain}" timed out; allowing the send`);
      return { ok: true };
    }
    // A domain with no usable MX host cannot take delivery.
    return records.some((record) => record.exchange.trim().length > 0)
      ? { ok: true }
      : undeliverable;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && UNDELIVERABLE_DNS_CODES.has(code)) {
      return undeliverable;
    }
    console.error(
      `[offer] MX lookup for "${domain}" failed (${code ?? "unknown"}); allowing the send`,
      error,
    );
    return { ok: true };
  }
}

type SendResult =
  | { ok: true; reference: string; recipients: readonly string[] }
  | { ok: false; error: string };

// Email the offer PDF to EVERY customer signatory — each individual owner and
// each company director, in collectOfferSigners order, not just a primary +
// secondary. Every recipient receives the proposal as a separate email carrying
// its own [RCOFR-…] tracking token, persisted as its own OfferDocumentSend
// record, so the inbound Graph reply tracker can attribute each reply to the
// correct sender (see recordOfferReply: the recipient guard already checks the
// matching send's recipientEmail). This mirrors how the Tender/Contract DocuSign
// envelopes fan out to each owner/director as a distinct recipient. The
// caller-supplied recipientEmail/secondaryRecipientEmail are only a fallback for
// legacy/in-memory offers whose owners carry no email.
export async function sendOfferDocument(input: {
  offerId: string;
  recipientEmail: string;
  secondaryRecipientEmail?: string | null;
}): Promise<SendResult> {
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
    },
  });
  if (!offer) {
    return { ok: false, error: "Offer not found." };
  }
  if (!offer.workspaceState) {
    return { ok: false, error: "Add and save offer content before sending." };
  }

  // Parse the saved workspace ONCE, guarded, so a malformed/legacy blob returns
  // the normal SendResult error instead of throwing an unhandled server-action
  // rejection (PR #124). Reused for the recipients, the owner gate and the PDF.
  let snapshot: ReturnType<typeof deserializeWorkspace>;
  try {
    snapshot = deserializeWorkspace(parseWorkspaceState(offer.workspaceState));
  } catch (error) {
    return {
      ok: false,
      error: `Couldn't read the saved offer: ${(error as Error).message}`,
    };
  }

  // Server-side owner gate: re-check owner completeness (names, Current Location,
  // unique valid signer emails) so the offer can't be sent + locked via any path.
  const ownerIssues = collectOwnerIssues(snapshot.job.owners);
  if (ownerIssues.length > 0) {
    return {
      ok: false,
      error: `Complete the owner details before sending: ${ownerIssues.join(" ")}`,
    };
  }

  // Recipients = EVERY customer signatory (individual owners + company
  // directors), not just primary + secondary. The old flat projection dropped
  // every email past the second owner's first signer, so a third owner or a
  // company's extra directors — all required to supply an email — never got the
  // proposal or a tracking link. Build the list straight from collectOfferSigners
  // (the same ordered signer set the Tender/Contract sign against), de-duped
  // case-insensitively and preserving first-seen order.
  const recipients: string[] = [];
  const seenRecipients = new Set<string>();
  for (const signer of collectOfferSigners(snapshot.job.owners)) {
    const addr = signer.signatory.email.trim();
    const key = addr.toLowerCase();
    if (EMAIL_RE.test(addr) && !seenRecipients.has(key)) {
      seenRecipients.add(key);
      recipients.push(addr);
    }
  }
  // Fall back to the caller-supplied recipient(s) only for legacy/in-memory
  // offers whose owners carry no usable email. collectOwnerIssues already blocks
  // the normal path from reaching here without valid signer emails.
  if (recipients.length === 0) {
    const primary = input.recipientEmail.trim();
    if (!EMAIL_RE.test(primary)) {
      return { ok: false, error: "Enter a valid recipient email address." };
    }
    recipients.push(primary);
    seenRecipients.add(primary.toLowerCase());
    const secondary = (input.secondaryRecipientEmail ?? "").trim();
    if (secondary.length > 0 && !seenRecipients.has(secondary.toLowerCase())) {
      if (!EMAIL_RE.test(secondary)) {
        return {
          ok: false,
          error: "Enter a valid secondary recipient email address.",
        };
      }
      recipients.push(secondary);
    }
  }

  // Checked before the PDF is built so a typo costs a DNS lookup, not a render.
  for (const addr of recipients) {
    const deliverable = await recipientDomainAcceptsMail(addr);
    if (!deliverable.ok) {
      return { ok: false, error: deliverable.error };
    }
  }

  let pdfBase64: string;
  // Retained past the PDF block: the branded email body is rendered from the
  // same job + customer-price data, so it can never quote a different figure
  // than the attachment.
  let proposalInput: ReturnType<typeof buildProposalInput>;
  try {
    proposalInput = buildProposalInput(snapshot);
    // A manual price override without a stated reason must not be emailed —
    // mirror the client-side "Send offer"/"Mark sent" guard server-side.
    if (proposalInput.customerPrice.needsOverrideReason) {
      return {
        ok: false,
        error:
          "Add a reason for the manual price override before sending the offer.",
      };
    }
    const html = buildProposalHtml(proposalInput, snapshot.images);
    pdfBase64 = await generatePDF({ html });
  } catch (error) {
    return {
      ok: false,
      error: `Failed to generate the proposal PDF: ${(error as Error).message}`,
    };
  }

  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;
  // One tracked token per recipient so each signer's inbound reply correlates to
  // their own OfferDocumentSend record (recordOfferReply matches by recipient).
  const sends = recipients.map((recipientEmail) => ({
    recipientEmail,
    token: `RCOFR-${randomBytes(6).toString("hex").toUpperCase()}`,
  }));

  const isFirstSend = offer.offerStatus === OfferStatus.PENDING;

  // An Offer document may be sent REPEATEDLY (PR #124 review, finding #1): every
  // call emails ALL recipients. No per-recipient dedupe — that made an explicit
  // Resend reject itself once everyone already had the current version.
  //
  // The offer stays PENDING throughout delivery and is flipped to SENT only AFTER
  // an email is actually accepted (finding #2). The previous design flipped to
  // SENT up front to use the status as a concurrency lock, but that let another
  // tab reload, observe SENT and advance the offer (e.g. Mark agreed) while
  // delivery was still in flight — and if delivery then failed, the revert (which
  // only matched SENT) couldn't undo an already-agreed offer nobody received.
  const deliveredEmails: string[] = [];
  let sendError: string | null = null;
  try {
    const client = await createGraphContext(getGraphConfig());
    // One email per signatory — same PDF, each with its own tracking token so
    // replies correlate to the right send record. Persist each OfferDocumentSend
    // the moment its email is ACCEPTED (never before, never batched), so a mid-loop
    // failure records exactly who received it and leaves no phantom rows.
    for (const send of sends) {
      // The branded React Email template, rendered per recipient so the
      // greeting names that signatory. The tracking token stays in the SUBJECT
      // (where the inbound reply tracker reads it from), so the template needs
      // no slot for it.
      const body = await render(
        createElement(
          QuotationEmail,
          buildOfferQuotationEmailProps({
            template: proposalInput,
            reference,
            recipientEmail: send.recipientEmail,
          }),
        ),
      );
      await client.sendMail({
        to: send.recipientEmail,
        subject: `Your Building Proposal — ${reference} [${send.token}]`,
        body,
        attachments: [
          {
            name: `Building-Proposal-${reference}.pdf`,
            contentType: "application/pdf",
            contentBytes: pdfBase64,
          },
        ],
      });
      await prisma.offerDocumentSend.create({
        data: {
          offerId: offer.id,
          offerFileVersion: offer.revisionNumber,
          recipientEmail: send.recipientEmail,
          trackedLinkToken: send.token,
        },
      });
      deliveredEmails.push(send.recipientEmail);
    }
  } catch (error) {
    sendError = `Failed to send the email: ${(error as Error).message}`;
    // Name who DID receive it. A partial send still flips the offer to SENT below,
    // so an error that only said "sending failed" left the estimator unable to tell
    // whether anyone got the proposal (PR #124 review).
    if (deliveredEmails.length > 0) {
      sendError += ` Delivered to ${deliveredEmails.join(", ")} before the failure — the offer is marked Sent; resend to reach the rest.`;
    }
  }

  // Flip PENDING→SENT only AFTER at least one email was accepted, and only on a
  // first send. The conditional match on PENDING makes the transition + its audit
  // event exactly-once: a concurrent sender that already flipped it (or a Mark
  // agreed that moved it on) leaves count 0, so no duplicate event is written.
  // Concurrent first sends each still email (consistent with repeatable sends);
  // only the status audit is deduplicated. A zero-delivery send never flips, so
  // the offer simply stays PENDING and is retryable — no revert needed.
  if (isFirstSend && deliveredEmails.length > 0) {
    const flip = await prisma.offer.updateMany({
      where: { id: offer.id, offerStatus: OfferStatus.PENDING },
      data: { offerStatus: OfferStatus.SENT, sentAt: new Date() },
    });
    if (flip.count === 1) {
      await prisma.offerStatusEvent
        .create({
          data: {
            offerId: offer.id,
            fromStatus: OfferStatus.PENDING,
            toStatus: OfferStatus.SENT,
            note: `Emailed to ${deliveredEmails.join(", ")}`,
          },
        })
        .catch((error) =>
          console.error("[offer] status event after send failed:", error),
        );
      await syncLeadStageForOffer(offer.id);
    }
  }

  if (sendError) {
    return { ok: false, error: sendError };
  }

  // The mail is away and the status is committed, so nothing past this point
  // may reject: the caller would report the send as failed while the offer is
  // durably SENT, and the workspace would keep an editable "pending" view until
  // the next reload silently locked it. Cache invalidation is best-effort.
  try {
    revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  } catch (error) {
    console.error("[offer] revalidate after send failed:", error);
  }
  return {
    ok: true,
    reference,
    recipients: deliveredEmails,
  };
}
