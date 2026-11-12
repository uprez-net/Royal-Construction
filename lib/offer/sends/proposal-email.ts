import { collectExtraCostIssues } from "@/lib/offer/extra-costs";
import { randomBytes } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import { generatePDF } from "@/lib/pdf/generate-pdf";
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
import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { getGraphConfig } from "@/lib/graph/config";
import { createGraphContext } from "@/lib/graph/client";
import {
  canEmailOfferProposal,
  PROPOSAL_STAGE_PASSED_ERROR,
} from "@/lib/offer/offer-send-guards";
import {
  OfferProposalSendError,
  sendOfferProposal,
} from "@/lib/domain/offers/proposal-send";
import { userPrincipal } from "@/lib/domain/principal";
import { readOfferForSend } from "@/lib/domain/offers/envelope-send";
import type { User } from "@prisma/client";
import type { TransactionalDomainDb } from "@/lib/domain/db";
import type { OfferSendEffects } from "@/lib/offer/sends/effects";

// Moved out of lib/data/offer-send.ts so the app and Eve run one send.
// The caller authorizes the user against the offer first; effects carry
// the post-write work only a caller can do (cache expiry, the lead-stage
// sync).

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
      console.error(
        `[offer] MX lookup for "${domain}" timed out; allowing the send`,
      );
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

export type OfferProposalEmailResult =
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
export async function emailOfferProposal(
  user: User,
  input: {
    offerId: string;
    recipientEmail: string;
    secondaryRecipientEmail?: string | null;
    sendAttemptId: string;
  },
  db: TransactionalDomainDb,
  effects: OfferSendEffects,
): Promise<OfferProposalEmailResult> {
  const offer = await readOfferForSend(db, input.offerId);
  // Before any recipient lookup or PDF render: past the negotiation window the
  // proposal would quote a workspace the Tender or Contract no longer matches.
  if (!canEmailOfferProposal(offer.offerStatus)) {
    return { ok: false, error: PROPOSAL_STAGE_PASSED_ERROR };
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

  // Same gate as marking the offer sent: an extra switched on but not priceable
  // adds $0, so the client would receive a total that silently leaves it out.
  const extraCostIssues = collectExtraCostIssues(snapshot.extraCosts);
  if (extraCostIssues.length > 0) {
    return {
      ok: false,
      error: `Finish the additional cost items before sending: ${extraCostIssues.join(" ")}`,
    };
  }

  const totalAreaSqm = getAreaBasisTotalSqm(
    offerAreaBasisFromJob(snapshot.job),
  );
  if (totalAreaSqm <= 0) {
    return {
      ok: false,
      error: "Enter floor areas in Job setup before sending the proposal.",
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

  let messages: Awaited<ReturnType<typeof buildMessage>>[];
  try {
    messages = await Promise.all(
      sends.map((send) =>
        buildMessage(send, proposalInput, reference, pdfBase64),
      ),
    );
  } catch (error) {
    return {
      ok: false,
      error: `Failed to prepare the offer email: ${(error as Error).message}`,
    };
  }

  const client = await createGraphContext(getGraphConfig());
  let deliveredEmails: readonly string[] = [];
  try {
    const result = await sendOfferProposal(
      userPrincipal(user),
      {
        attemptId: input.sendAttemptId,
        offerFileVersion: offer.revisionNumber,
        offerId: offer.id,
        recipients: messages,
      },
      db,
      {
        send: (message) =>
          client.sendMail({
            ...message,
            attachments: message.attachments.map((attachment) => ({
              ...attachment,
            })),
          }),
      },
    );
    deliveredEmails = result.deliveredEmails;
  } catch (error) {
    const partial =
      error instanceof OfferProposalSendError ? error.deliveredEmails : [];
    let message = `Failed to send the email: ${(error as Error).message}`;
    if (partial.length > 0) {
      message += ` Delivered to ${partial.join(", ")} before the failure — the offer is marked Sent; use a new resend to reach the rest.`;
    }
    return { ok: false, error: message };
  }

  async function buildMessage(
    send: { recipientEmail: string; token: string },
    template: ReturnType<typeof buildProposalInput>,
    offerReference: string,
    attachment: string,
  ) {
    const body = await render(
      createElement(
        QuotationEmail,
        buildOfferQuotationEmailProps({
          template,
          reference: offerReference,
          recipientEmail: send.recipientEmail,
        }),
      ),
    );
    return {
      email: send.recipientEmail,
      token: send.token,
      message: {
        attachments: [
          {
            name: `Building-Proposal-${offerReference}.pdf`,
            contentType: "application/pdf",
            contentBytes: attachment,
          },
        ],
        body,
        subject: `Your Building Proposal — ${offerReference} [${send.token}]`,
        to: send.recipientEmail,
      },
    };
  }

  // The mail is away and the status is committed, so nothing past this point
  // may reject: the caller would report the send as failed while the offer is
  // durably SENT, and the workspace would keep an editable "pending" view until
  // the next reload silently locked it. Cache invalidation is best-effort.
  try {
    effects.offerChanged(offer.id);
  } catch (error) {
    console.error("[offer] revalidate after send failed:", error);
  }
  return {
    ok: true,
    reference,
    recipients: deliveredEmails,
  };
}
