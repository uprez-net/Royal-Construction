import { createHash } from "node:crypto";
import { format } from "date-fns";
import type { LeadEmails } from "@prisma/client";

import type { DomainDb } from "@/lib/domain/db";
import {
  authorizeLeadEmail,
  sendLeadEmailOnce,
} from "@/lib/domain/leads/email";
import type { DomainPrincipal } from "@/lib/domain/principal";
import { sanitizeLeadNotesHtml } from "@/lib/rich-text/lead-notes";
import {
  EMAIL_FOOTER_HTML,
  EMAIL_HEADER_HTML,
} from "@/constants/email-artifacts";
import { getAllEmailThreads } from "@/utils/email-parser";
import { normalizeEmailAddress } from "@/utils/formatters";
import { generateEmailChecksum } from "@/utils/generator";

// Emailing a client from a lead: compose, send once, record the thread.
//
// The lead page's composer and Eve's send_lead_email both come through here.
// Who may send and to which address, and the once-only key, are
// lib/domain/leads/email.ts; this is the part that used to live inline in the
// Server Action, where nothing outside a Next request could reach it. What a
// caller still decides for itself is the name that signs the message, because
// the app reads it off the Clerk session and Eve off its actor.

export type LeadEmailPorts = {
  /** Deliver one message from the business mailbox. */
  readonly sendMail: (message: {
    to: string;
    subject: string;
    body: string;
  }) => Promise<unknown>;
  /** A short subject line for a new thread. */
  readonly generateSubject: (bodyHtml: string) => Promise<string>;
};

export type ComposedLeadEmail = {
  readonly leadId: number;
  /** Appended to a new thread's subject, as the composer always has. */
  readonly location: string;
  readonly body: string;
  readonly to: string;
  readonly senderName: string;
  /** The message this replies to; its subject is kept with a "Re:". */
  readonly replyingTo?: Pick<LeadEmails, "subject"> | null;
};

export type LeadEmailSendOutcome = {
  readonly email: LeadEmails;
  /** True when this exact message already went out and was not sent again. */
  readonly alreadySent: boolean;
};

function normalizeEmailBody(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function hasHtmlMarkup(value: string) {
  return /<[a-z][\s\S]*>/i.test(value);
}

function markdownToHtml(value: string) {
  const paragraphs = normalizeEmailBody(value)
    .split(/\n\s*\n/)
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "";
  }

  return paragraphs
    .map((paragraph) => {
      const formattedParagraph = paragraph
        .split("\n")
        .map((line) =>
          escapeEmailHtml(line).replace(
            /\*\*(.+?)\*\*/g,
            "<strong>$1</strong>",
          ),
        )
        .join("<br>");

      return `<p>${formattedParagraph}</p>`;
    })
    .join("");
}

function buildLeadEmailHtml(body: string, name: string) {
  const normalizedBody = normalizeEmailBody(body);
  const bodyHtml = hasHtmlMarkup(normalizedBody)
    ? sanitizeLeadNotesHtml(normalizedBody)
    : markdownToHtml(normalizedBody);

  return `${bodyHtml}<p style="margin:16px 0 0;">Thanks &amp; Regards, <br>${escapeEmailHtml(name)} <br>Royal Constructions.</p>`;
}

/**
 * Escapes HTML-sensitive characters to prevent HTML injection when embedding
 * user-provided values inside email templates.
 *
 * @param value - Raw string to escape.
 * @returns The escaped HTML-safe string.
 */
export function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Send one composed message to a lead and record it on the lead's thread.
 *
 * Throws a domain refusal when the caller may not email the lead or the
 * address is not one of the lead's own, before anything is sent.
 */
export async function sendComposedLeadEmail(
  principal: DomainPrincipal,
  input: ComposedLeadEmail,
  db: DomainDb,
  ports: LeadEmailPorts,
): Promise<LeadEmailSendOutcome> {
  // Who may send, and to whom. The recipient used to come straight from the
  // browser and was never checked against the lead, so an authorised caller
  // could send an arbitrary body to an arbitrary address from Royal's
  // mailbox.
  const authorized = await authorizeLeadEmail(
    principal,
    { leadId: input.leadId, to: input.to },
    db,
  );
  const to = authorized.to;
  const { leadId, location } = input;

  const signedBody = `
    <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; outline: none; }
    .rc-hover-toolbar {
      position: absolute;
      background: rgba(12,24,41,0.95);
      color: white;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 9999;
      display: none;
      pointer-events: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      max-width: 90%;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .rc-hover-toolbar span { font-weight: 600; white-space: nowrap; }
    .rc-hover-toolbar input {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      font-size: 12px;
      width: 300px;
      max-width: 55vw;
      padding: 3px 8px;
      border-radius: 4px;
      outline: none;
      font-family: monospace;
    }
    .rc-hover-toolbar input:focus {
      border-color: #c6923a;
      background: rgba(255,255,255,0.15);
    }
  </style>
</head>
<body>
  <div style="background-color:#f7f6f2;margin:0;padding:0">
    ${EMAIL_HEADER_HTML}
    <p>Hi ${escapeEmailHtml(authorized.leadName)},</p>
    ${buildLeadEmailHtml(input.body, input.senderName)}
    ${EMAIL_FOOTER_HTML}
  </div>
</body>
</html>
    `;

  // A reply keeps its thread's subject. A new thread's is generated, and only
  // once a send is actually going to happen.
  const replySubject = input.replyingTo
    ? `Re: ${input.replyingTo.subject}`
    : null;
  const siteSuffix = location.trim();

  // The send and the thread record are one durable effect, keyed on the lead,
  // the recipient and the body. A double-click, or a retry after a slow Graph
  // call, used to send the client the same message twice. The key holds only
  // what the caller sent: the generated subject differs on every call, so
  // keying on it let a retry through as a new message.
  const { alreadySent, result } = await sendLeadEmailOnce(
    authorized,
    {
      bodyFingerprint: createHash("sha256")
        .update(
          `${replySubject === null ? "new" : `reply:${replySubject}`}\u0000${location}\u0000${signedBody}`,
        )
        .digest("hex"),
    },
    db,
    async () => {
      // One subject for the message and every record of it. A reply's never
      // carried the site; a new thread's does when the lead has one.
      let subject = replySubject;
      if (subject === null) {
        const aiSubject = await ports.generateSubject(
          escapeEmailHtml(signedBody),
        );
        subject = siteSuffix ? `${aiSubject} - ${siteSuffix}` : aiSubject;
      }
      await ports.sendMail({
        to,
        subject,
        body: signedBody,
      });
      const strippedEmailBody = getAllEmailThreads(signedBody, {
        from: normalizeEmailAddress(
          process.env.BUSINESS_EMAIL ?? "info@royalconstructions.com.au",
        ),
        to: normalizeEmailAddress(to),
        subject,
        sentAt: format(new Date(), "yyyy-MM-dd'T'HH:mm:ssXXX"),
      });
      let lastId: string | null = null;
      for (const thread of strippedEmailBody) {
        const checksum = await generateEmailChecksum(
          thread.subject,
          thread.body,
          normalizeEmailAddress(thread.from),
          normalizeEmailAddress(thread.to),
        );
        const emailRecord = await db.leadEmails.create({
          data: {
            leadId,
            subject,
            body: thread.body,
            emailTo: normalizeEmailAddress(thread.to),
            emailFrom: normalizeEmailAddress(thread.from),
            checksum,
            sentAt: new Date(),
          },
        });
        console.log(
          `[Lead ${leadId}] Email sent and recorded with ID: ${emailRecord.id}`,
        );
        lastId = emailRecord.id;
      }
      if (!lastId) throw new Error("Failed to record email");
      // Only the id goes in the intent; a replay reads the row back rather
      // than reconstructing a stored copy of the message.
      return { emailId: lastId };
    },
  );

  const recordedEmail = await db.leadEmails.findUnique({
    where: { id: result.emailId },
  });
  if (!recordedEmail) {
    throw new Error("Failed to record email");
  }
  if (alreadySent) {
    console.log(
      `[Lead ${leadId}] This message already went out today; nothing was sent again.`,
    );
  }

  return { alreadySent, email: recordedEmail };
}
