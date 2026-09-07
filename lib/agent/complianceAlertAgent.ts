import { ComplianceAlertType, CompliancePartyType } from "@prisma/client";
import { generateText, Output } from "ai";
import { z } from "zod";

import { gateway } from "@/lib/model";
import { stripEmailThread, stripHtml } from "@/utils/formatters";

/**
 * Reads a party's reply for conditions that change the rest of the file.
 *
 * Two of them exist today and both are sentences rather than documents — "the
 * title search we pulled is dated before the transfer, we'll re-order it", "on
 * these setbacks this won't go through as a CDC, you'll need a DA". Neither
 * arrives as an attachment, so nothing in the document pipeline would ever
 * notice them, and both change what the file needs from that moment on.
 *
 * Deliberately narrow. It answers "did they say one of these two things", not
 * "summarise the email": an open-ended extraction here would raise alerts
 * nobody can close, on a screen whose whole value is that an open alert means
 * something is genuinely outstanding.
 */

const alertDetectionSchema = z.object({
  alerts: z
    .array(
      z.object({
        type: z
          .enum([
            ComplianceAlertType.STALE_TITLE_SEARCH,
            ComplianceAlertType.DA_APPROVAL_REQUIRED,
          ])
          .describe("Which of the two conditions the message raises."),
        detail: z
          .string()
          .describe(
            "The sentence from the message that says so, quoted as written. Never a paraphrase and never your own summary.",
          ),
      }),
    )
    .default([])
    .describe(
      "Every condition the message raises. Empty is the normal answer — most replies raise none.",
    ),
});

export type DetectedComplianceAlert = z.infer<
  typeof alertDetectionSchema
>["alerts"][number];

const INSTRUCTION = `You read one email from a surveyor or an architect working on an Australian residential building job, and decide whether it raises either of exactly two conditions. Most emails raise neither. Returning an empty list is the correct and most common answer.

STALE_TITLE_SEARCH — the surveyor says the title search or title document they supplied is out of date, was pulled before the property transfer settled, still shows a previous owner, or that they will need to re-order it once the land registry updates. Do NOT raise this merely because a title search is mentioned, attached, or discussed.

DA_APPROVAL_REQUIRED — the architect says the proposal cannot proceed as complying development / a CDC, and needs a Development Application or development consent from the council. Phrases include "won't meet the CDC criteria", "will need a DA", "requires development consent", "falls outside complying development". Do NOT raise this for a general mention of council, of a DA that has already been obtained, or of a DA as a hypothetical the sender is ruling out.

Rules:
- Raise a condition only when the sender states it about THIS job. A general remark, a question, or a condition the sender is explicitly discounting is not a statement.
- The detail must be a verbatim sentence from the message. Never invent, compress or paraphrase.
- When you cannot tell, return nothing. An alert nobody can close is worse than a missed one, because the missed one is still visible in the thread.`;

/**
 * Conditions raised by one inbound message.
 *
 * Returns an empty list on any failure. An alert is a courtesy on top of a
 * reply that has already been recorded, and failing the caller because a model
 * call timed out would lose the documents to report a missed flag.
 */
export async function detectComplianceAlerts(params: {
  party: CompliancePartyType;
  subject: string;
  body: string;
}): Promise<DetectedComplianceAlert[]> {
  // The council thread is never written to and only ever carries a certificate;
  // there is no sentence to read. Skipped before the model call rather than
  // after it, so a portal notification does not cost a round trip.
  if (params.party === CompliancePartyType.COUNCIL) {
    return [];
  }

  try {
    // The latest message only. The quoted history below it is what was said
    // before, and re-reading it every round raises the same alert on every
    // reply for the rest of the thread.
    const clean = stripHtml(stripEmailThread(params.body)).trim();
    if (!clean) {
      return [];
    }

    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      system: INSTRUCTION,
      temperature: 0,
      prompt: [
        `The sender is the ${params.party.toLowerCase()} on this job.`,
        `Subject: ${params.subject}`,
        `Email body:\n${clean}`,
      ].join("\n\n"),
      output: Output.object({ schema: alertDetectionSchema }),
    });

    const detected = (output as z.infer<typeof alertDetectionSchema>).alerts;

    // A surveyor cannot tell you the job needs a DA and an architect does not
    // pull title searches. Filtered rather than trusted: the party is the one
    // fact about the message that is certain, and it is a cheap guard against
    // a model that has read the quoted history despite being told not to.
    const allowed =
      params.party === CompliancePartyType.SURVEYOR
        ? ComplianceAlertType.STALE_TITLE_SEARCH
        : ComplianceAlertType.DA_APPROVAL_REQUIRED;

    return detected.filter((alert) => alert.type === allowed);
  } catch (error) {
    console.error("  Failed to read compliance alerts off the message:", error);
    return [];
  }
}
