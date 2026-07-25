"use server";

import { revalidateTag } from "next/cache";
import { randomBytes } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import { OfferStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { generatePDF } from "@/lib/utils/generatePDF";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import { collectOwnerIssues } from "@/lib/offer/workspace-model";
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
  | { ok: true; reference: string; token: string; secondaryToken?: string }
  | { ok: false; error: string };

// Email the offer PDF to the client(s). When a secondary recipient is
// provided, BOTH clients receive the proposal as separate emails — each carries
// its own [RCOFR-…] tracking token, persisted as its own OfferDocumentSend
// record, so the inbound Graph reply tracker can attribute each reply to the
// correct sender (see recordOfferReply: the recipient guard already checks the
// matching send's recipientEmail). This mirrors how the Tender/Contract DocuSign
// envelopes fan out to each owner as a distinct recipient. A single client
// receive a single email, byte-for-byte identical to the pre-secondary-client
// behaviour.
export async function sendOfferDocument(input: {
  offerId: string;
  recipientEmail: string;
  secondaryRecipientEmail?: string | null;
}): Promise<SendResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  const email = input.recipientEmail.trim();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid recipient email address." };
  }
  const secondaryRaw = (input.secondaryRecipientEmail ?? "").trim();
  const hasSecondary = secondaryRaw.length > 0 && secondaryRaw !== email;
  const secondaryEmail = hasSecondary ? secondaryRaw : "";
  if (hasSecondary && !EMAIL_RE.test(secondaryEmail)) {
    return {
      ok: false,
      error: "Enter a valid secondary recipient email address.",
    };
  }

  // Checked before the PDF is built so a typo costs a DNS lookup, not a render.
  const deliverable = await recipientDomainAcceptsMail(email);
  if (!deliverable.ok) {
    return { ok: false, error: deliverable.error };
  }
  if (hasSecondary) {
    const secondaryDeliverable = await recipientDomainAcceptsMail(secondaryEmail);
    if (!secondaryDeliverable.ok) {
      return { ok: false, error: secondaryDeliverable.error };
    }
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

  // Server-side owner gate (codex #1): the client blocks send on incomplete
  // owner data, but re-check here so the offer can't be sent + locked with a
  // missing owner name / Current Location / signatory email via any other path.
  const gateSnapshot = deserializeWorkspace(
    parseWorkspaceState(offer.workspaceState),
  );
  const ownerIssues = collectOwnerIssues(gateSnapshot.job.owners);
  if (ownerIssues.length > 0) {
    return {
      ok: false,
      error: `Complete the owner details before sending: ${ownerIssues.join(" ")}`,
    };
  }

  let pdfBase64: string;
  try {
    const snapshot = deserializeWorkspace(
      parseWorkspaceState(offer.workspaceState),
    );
    const proposalInput = buildProposalInput(snapshot);
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
  const token = `RCOFR-${randomBytes(6).toString("hex").toUpperCase()}`;
  const secondaryToken = hasSecondary
    ? `RCOFR-${randomBytes(6).toString("hex").toUpperCase()}`
    : undefined;

  try {
    const client = await createGraphContext(getGraphConfig());
    // Primary recipient — always sent.
    await client.sendMail({
      to: email,
      subject: `Your Building Proposal — ${reference} [${token}]`,
      body: buildEmailBody(reference, token),
      attachments: [
        {
          name: `Building-Proposal-${reference}.pdf`,
          contentType: "application/pdf",
          contentBytes: pdfBase64,
        },
      ],
    });
    // Secondary recipient — a separate email with its own tracking token so
    // each client's replies correlate to their own send record. The same PDF
    // body is reused; only the subject/body token differs.
    if (hasSecondary && secondaryToken) {
      await client.sendMail({
        to: secondaryEmail,
        subject: `Your Building Proposal — ${reference} [${secondaryToken}]`,
        body: buildEmailBody(reference, secondaryToken),
        attachments: [
          {
            name: `Building-Proposal-${reference}.pdf`,
            contentType: "application/pdf",
            contentBytes: pdfBase64,
          },
        ],
      });
    }
  } catch (error) {
    return {
      ok: false,
      error: `Failed to send the email: ${(error as Error).message}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.offerDocumentSend.create({
      data: {
        offerId: offer.id,
        offerFileVersion: offer.revisionNumber,
        recipientEmail: email,
        trackedLinkToken: token,
      },
    });
    if (hasSecondary && secondaryToken) {
      await tx.offerDocumentSend.create({
        data: {
          offerId: offer.id,
          offerFileVersion: offer.revisionNumber,
          recipientEmail: secondaryEmail,
          trackedLinkToken: secondaryToken,
        },
      });
    }
    if (offer.offerStatus === OfferStatus.PENDING) {
      await tx.offer.update({
        where: { id: offer.id },
        data: { offerStatus: OfferStatus.SENT, sentAt: new Date() },
      });
      const recipients = hasSecondary
        ? `${email} and ${secondaryEmail}`
        : email;
      await tx.offerStatusEvent.create({
        data: {
          offerId: offer.id,
          fromStatus: offer.offerStatus,
          toStatus: OfferStatus.SENT,
          note: `Emailed to ${recipients}`,
        },
      });
    }
  });

  // The mail is away and the status is committed, so nothing past this point
  // may reject: the caller would report the send as failed while the offer is
  // durably SENT, and the workspace would keep an editable "pending" view until
  // the next reload silently locked it. Cache invalidation is best-effort.
  try {
    revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  } catch (error) {
    console.error("[offer] revalidate after send failed:", error);
  }
  return { ok: true, reference, token, secondaryToken };
}

function buildEmailBody(reference: string, token: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.55;">
    <p>Hi,</p>
    <p>Please find attached your Building Proposal (<strong>${reference}</strong>) from Royal Constructions Pty Ltd.</p>
    <p>Everything is fixed into the price shown in the proposal. If you have any questions or changes, simply <strong>reply to this email</strong> and we'll take care of the rest.</p>
    <p>Kind regards,<br/>Royal Constructions Pty Ltd<br/>Lic. 383992C | MBA Accredited</p>
    <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;" />
    <p style="font-size:11px;color:#999;">Proposal reference: ${token}. Please keep this reference in the subject line when replying so we can track your response.</p>
  </div>`;
}
