import { ComplianceAlertType, CompliancePartyType } from "@prisma/client";
import { generateText, Output } from "ai";
import { z } from "zod";

import { gateway } from "@/lib/model";
import { stripEmailThread, stripHtml } from "@/utils/formatters";

/**
 * Reads a party's reply for conditions that change the rest of the file.
 *
 * One of them today: an architect saying the proposal cannot go through as a
 * CDC. It arrives as a sentence rather than as a document — "on these setbacks
 * you'll need a DA" — so nothing in the document pipeline would ever notice it,
 * and it changes what the file needs from that moment on.
 *
 * A stale title search is deliberately NOT read here, though it looks like the
 * same kind of thing. The register lags settlement, so a surveyor orders a
 * search in good faith and what comes back names the vendors — and they cannot
 * tell us it is wrong, because they never knew who bought the place. Waiting to
 * be told would be waiting for a message nobody is able to send. Only we hold
 * the contract that says whose job this is, so that one is checked against the
 * document itself in lib/compliance/verify-title-search.ts.
 *
 * Deliberately narrow. It answers "did they say this thing", not "summarise the
 * email": an open-ended extraction here would raise alerts nobody can close, on
 * a screen whose whole value is that an open alert means something is genuinely
 * outstanding.
 */

const alertDetectionSchema = z.object({
  alerts: z
    .array(
      z.object({
        type: z
          .enum([ComplianceAlertType.DA_APPROVAL_REQUIRED])
          .describe("The condition the message raises."),
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

const INSTRUCTION = `You read one email from an architect working on an Australian residential building job, and decide whether it raises exactly one condition. Most emails raise none. Returning an empty list is the correct and most common answer.

DA_APPROVAL_REQUIRED — the architect says the proposal cannot proceed as complying development / a CDC, and needs a Development Application or development consent from the council. Phrases include "won't meet the CDC criteria", "will need a DA", "requires development consent", "falls outside complying development". Do NOT raise this for a general mention of council, of a DA that has already been obtained, or of a DA as a hypothetical the sender is ruling out.

Rules:
- Raise the condition only when the sender states it about THIS job. A general remark, a question, or a condition the sender is explicitly discounting is not a statement.
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
  // Only an architect can raise the one condition this reads for. A surveyor's
  // covering note and a portal notification have nothing in them to find, and
  // skipping before the model call rather than filtering after it means neither
  // costs a round trip.
  if (params.party !== CompliancePartyType.ARCHITECT) {
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

    return (output as z.infer<typeof alertDetectionSchema>).alerts;
  } catch (error) {
    console.error("  Failed to read compliance alerts off the message:", error);
    return [];
  }
}
