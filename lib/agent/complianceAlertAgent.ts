import { ComplianceAlertSource, ComplianceAlertType } from "@prisma/client";
import { generateText, Output } from "ai";
import { z } from "zod";

import { gateway, TEXT_MODEL_ID } from "@/lib/model";
import { stripEmailThread, stripHtml } from "@/utils/formatters";

/**
 * Reads a party's reply for conditions that change the rest of the file.
 *
 * One of them today: the proposal cannot go through as a CDC and needs a DA. It
 * arrives as a sentence rather than as a document — "on these setbacks you'll
 * need a DA" — so nothing in the document pipeline would ever notice it, and it
 * changes what the file needs from that moment on.
 *
 * Read on two threads, not one. The architect is who normally says it, but the
 * certifier is who decides it — and a certifier telling us the proposal falls
 * outside complying development is very often the first anyone hears of it,
 * because the architect did not spot it. Missing that until somebody read the
 * email by hand is the case this is really for.
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

/** Who is in a position to say a job needs a DA. */
const ALERT_SOURCES: ReadonlySet<ComplianceAlertSource> = new Set([
  ComplianceAlertSource.ARCHITECT,
  ComplianceAlertSource.CERTIFIER,
]);

const INSTRUCTION = `You read one email or document from the architect or the principal certifier working on an Australian residential building job, and decide whether it raises exactly one condition. Most of them raise none. Returning an empty list is the correct and most common answer.

DA_APPROVAL_REQUIRED — the sender says the proposal cannot proceed as complying development / a CDC, and needs a Development Application or development consent from the council. Phrases include "won't meet the CDC criteria", "will need a DA", "requires development consent", "falls outside complying development". Do NOT raise this for a general mention of council, of a DA that has already been obtained, or of a DA as a hypothetical the sender is ruling out.

Rules:
- Raise the condition only when the sender states it about THIS job. A general remark, a question, or a condition the sender is explicitly discounting is not a statement.
- On a checklist, a line merely asking for a copy of a development consent is not the certifier saying one is needed — a job that already has consent still has that line. Raise it only where they say the proposal does not qualify as complying development.
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
  source: ComplianceAlertSource;
  subject: string;
  body: string;
  /**
   * What is being read, where it is not an email.
   *
   * "document" is the certifier's checklist, OCR'd. It is read for the same
   * condition and judged by the same rules — a certifier writing "this proposal
   * does not meet the complying development standards" on their checklist is
   * saying exactly what they would have said in a reply, and it is very often
   * where they say it first, because the checklist is the first thing they
   * produce after looking at the plans.
   *
   * Two things differ and both would corrupt the answer if left alone. Quoted
   * history has to be stripped from an email and must not be from a document,
   * where the stripper would cut at the first line that looks like a header.
   * And the framing sentence has to say what the model is looking at, or it
   * reads a twenty-item list as an email that has lost its greeting.
   */
  kind?: "email" | "document";
}): Promise<DetectedComplianceAlert[]> {
  // Only these two are in a position to say it. A surveyor's covering note and
  // a portal notification have nothing in them to find, and skipping before the
  // model call rather than filtering after it means neither costs a round trip.
  if (!ALERT_SOURCES.has(params.source)) {
    return [];
  }

  try {
    const isDocument = params.kind === "document";

    // The latest message only. The quoted history below it is what was said
    // before, and re-reading it every round raises the same alert on every
    // reply for the rest of the thread. A document has no history to quote, and
    // running the thread stripper over one truncates it at the first line that
    // happens to look like a mail header — which on a checklist is the address
    // block at the top.
    const clean = isDocument
      ? params.body.trim()
      : stripHtml(stripEmailThread(params.body)).trim();
    if (!clean) {
      return [];
    }

    const { output } = await generateText({
      model: gateway(TEXT_MODEL_ID),
      system: INSTRUCTION,
      prompt: (isDocument
        ? [
            `This is a document written by the ${params.source.toLowerCase()} on this job.`,
            `Document: ${params.subject}`,
            `Contents:\n${clean}`,
          ]
        : [
            `The sender is the ${params.source.toLowerCase()} on this job.`,
            `Subject: ${params.subject}`,
            `Email body:\n${clean}`,
          ]
      ).join("\n\n"),
      output: Output.object({ schema: alertDetectionSchema }),
    });

    return (output as z.infer<typeof alertDetectionSchema>).alerts;
  } catch (error) {
    console.error("  Failed to read compliance alerts off the message:", error);
    return [];
  }
}
