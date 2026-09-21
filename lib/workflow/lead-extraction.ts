import { FatalError } from "workflow";
import { signBookConsultationToken } from "@/lib/leads/book-consultation-token";

import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import {
  collectLeadAttachments,
  hydrateLeadAttachments,
  type LeadAttachmentReport,
} from "@/lib/graph/lead-attachments";
import {
  extractLeadFromMessage,
  type LeadExtraction,
} from "@/lib/graph/lead-extractor";
import { archiveLeadAttachments } from "@/lib/leads/archive-lead-attachments";
import { checkLeadPresentWithEmailPhone } from "@/lib/leads/existing-lead";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { isOwnMailbox, resolveLeadEmail } from "@/lib/graph/mailbox";
import prisma from "@/lib/prisma";

/**
 * The message, flattened to what the extraction actually needs.
 *
 * Passed in whole rather than re-fetched: the caller has already read it from
 * Graph to decide this is a lead at all, and everything here is a plain string.
 */
export interface InboundLeadMessage {
  messageId: string;
  subject: string;
  body: string;
  from: string;
}

export type InboundLeadOutcome =
  | { status: "created"; leadId: number; archived: number }
  | { status: "duplicate"; leadId: number }
  | { status: "already-a-lead" }
  | { status: "spam" }
  | { status: "not-extracted" };

// ---------------------------------------------------------------------------
// Steps — each one is retried on its own and its result is persisted, so a
// crash between two of them resumes at the boundary rather than from the top.
// ---------------------------------------------------------------------------

/**
 * The Graph client is rebuilt inside each step rather than passed between them.
 * It holds a credential and a token cache — neither serializable, and neither
 * something to persist into an event log.
 */
async function graphClient() {
  return createGraphContext(getGraphConfig());
}

/**
 * Downloads and reads the attachments. The expensive step: every download and
 * every OCR call happens here, once, and what comes back is a description
 * rather than the bytes.
 */
async function readAttachments(
  messageId: string,
): Promise<LeadAttachmentReport> {
  "use step";
  const client = await graphClient();
  const report = await collectLeadAttachments(client, messageId);

  if (report.names.length > 0) {
    console.log(
      `Attachments on ${messageId}: ${report.files.length} read, ` +
        `${report.skipped.length} skipped` +
        (report.skipped.length > 0
          ? ` — ${report.skipped.map((item) => `${item.name}: ${item.reason}`).join("; ")}`
          : ""),
    );
  }

  return report;
}

/**
 * The model call. Retried like any other step, which is the point: a rate limit
 * or a gateway blip used to be the end of that lead.
 */
async function extractLead(
  message: InboundLeadMessage,
  report: LeadAttachmentReport,
): Promise<LeadExtraction | null> {
  "use step";
  const client = await graphClient();
  const attachments = await hydrateLeadAttachments(
    report,
    client,
    message.messageId,
  );

  return extractLeadFromMessage(message.subject, message.body, attachments);
}

/**
 * Writes the lead.
 *
 * Idempotent through `MicrosoftmessageId`, which is unique: a retry after a
 * write that landed but whose result was lost finds the existing row instead of
 * creating a second lead for the same email. That property is what makes the
 * rest of this workflow safe to retry.
 */
async function saveLead(
  message: InboundLeadMessage,
  extracted: LeadExtraction,
): Promise<{ leadId: number; created: boolean } | null> {
  "use step";

  const existing = await prisma.lead.findUnique({
    where: { MicrosoftmessageId: message.messageId },
    select: { id: true },
  });
  if (existing) {
    console.log(
      `Lead for message ${message.messageId} already exists (${existing.id}).`,
    );
    return { leadId: existing.id, created: false };
  }

  // The envelope is preferred for a direct enquiry, where the mail system has
  // verified it; it falls back to what the model read from the body only when
  // the sender is our own mailbox — a website form notification is sent by
  // that mailbox to itself, so the envelope names us rather than the client.
  const leadEmail = resolveLeadEmail(message.from, extracted.Email);
  const phoneVal = extracted.ContactNo ?? "";

  // Only reachable when the sender is our own mailbox and the model found no
  // address in the body. Logged distinctly rather than treated as a reason to
  // drop the enquiry: the phone and notes may still be a reachable lead.
  if (!leadEmail) {
    console.warn(
      `No client email resolved for message ${message.messageId}; saving lead without one.`,
    );
  }

  // The same person writing in from a second address, or a form that fires
  // twice. Checked against what the model read rather than the envelope, which
  // is why it cannot happen before extraction.
  if (await checkLeadPresentWithEmailPhone(leadEmail, [], phoneVal)) {
    console.log(
      `Lead with Email: ${leadEmail} or ContactNo: ${phoneVal} already exists. Aborting save.`,
    );
    return null;
  }

  const lead = await prisma.lead.create({
    data: {
      name: extracted.Name || "Unknown Lead",
      email: leadEmail,
      phone: phoneVal,
      location: extracted.Address || "",
      sourceDetail: "Website",
      stage: "CONTACTED",
      type: extracted.Type || [],
      notes: extracted.Info || "",
      MicrosoftmessageId: message.messageId,
    },
  });

  console.log(
    `Lead saved with ID ${lead.id} for message ${message.messageId}.`,
  );
  return { leadId: lead.id, created: true };
}

async function archiveAttachments(
  leadId: number,
  messageId: string,
  report: LeadAttachmentReport,
): Promise<number> {
  "use step";
  const client = await graphClient();
  return archiveLeadAttachments(leadId, client, messageId, report);
}

/**
 * Sends the welcome email.
 *
 * Swallows its own failures, exactly as the inline version did, and so never
 * retries. That is deliberate: a retry here would land a second welcome email
 * in the client's inbox, and an unsent one is the smaller failure.
 */
async function sendWelcomeEmail(leadId: number): Promise<boolean> {
  "use step";

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    // isOwnMailbox is belt and braces over resolveLeadEmail: a welcome email
    // addressed to ourselves is both useless to the client and a fresh
    // inbound message for the notifications route to (mis)process.
    if (!lead?.email || !lead.name || isOwnMailbox(lead.email)) {
      return false;
    }

    const config = getGraphConfig();
    const client = await createGraphContext(config);

    // Minted here rather than inside renderEmailHtml: that function is a Server
    // Action and authorises the caller before it will mint, and this path has
    // no Clerk session. Without this the welcome email's booking link would go
    // out untokenised and the client would be refused on their own link.
    const htmlBody = await renderEmailHtml(
      "Welcome",
      {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        type: lead.type,
        location: lead.location,
        notes: lead.notes ?? undefined,
        budget: lead.budget ?? undefined,
      },
      signBookConsultationToken(lead.id),
    );

    if (!htmlBody) {
      console.warn("  ⚠️ Failed to render welcome email HTML. No email sent.");
      return false;
    }

    await client.sendMail({
      to: lead.email,
      subject:
        "Welcome to Royal Constructions — Your Home Building Journey Starts Here",
      body: htmlBody,
      cc: config.cc,
    });

    console.log(`  ✅ Welcome email successfully sent to ${lead.email}`);
    return true;
  } catch (error) {
    console.error("  ❌ Failed to send welcome email:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Turns one screened lead email into a lead.
 *
 * This used to run inline in the webhook, where a Graph timeout, a rate-limited
 * model call or a cold-start kill anywhere along the way lost the enquiry with
 * no trace and no second attempt — Graph had already been told 202. As a
 * workflow each step retries on its own and the run resumes at the last
 * boundary it cleared, so the failure modes cost minutes rather than a
 * customer.
 *
 * The caller has already decided this is a lead email. Everything screened out
 * upstream — offer replies, tradie mail, existing threads, wrong subjects,
 * spam — never reaches here.
 */
export const processInboundLead = async (
  message: InboundLeadMessage,
): Promise<InboundLeadOutcome> => {
  "use workflow";

  if (!message.messageId) {
    // Nothing downstream can be made idempotent without it, so this is not
    // worth retrying.
    throw new FatalError("processInboundLead requires a messageId.");
  }

  const report = await readAttachments(message.messageId);
  const extracted = await extractLead(message, report);

  if (!extracted) {
    console.log(
      `No lead could be extracted from message ${message.messageId}.`,
    );
    return { status: "not-extracted" };
  }

  console.log(`Extracted lead: ${JSON.stringify(extracted)}`);

  if (extracted.Status !== false) {
    console.log("  Lead Extracted Found as Spam, Ignoring the lead");
    return { status: "spam" };
  }

  const saved = await saveLead(message, extracted);

  if (!saved) {
    return { status: "already-a-lead" };
  }

  const { leadId, created } = saved;

  if (!created) {
    // A concurrent notification for the same message got there first. Its run
    // owns the attachments and the welcome email.
    return { status: "duplicate", leadId };
  }

  const archived =
    report.files.length > 0
      ? await archiveAttachments(leadId, message.messageId, report)
      : 0;

  await sendWelcomeEmail(leadId);

  return { status: "created", leadId, archived };
};
