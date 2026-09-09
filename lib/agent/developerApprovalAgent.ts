import { ComplianceApprovalDecision } from "@prisma/client";
import { generateText, Output } from "ai";
import { z } from "zod";

import { gateway } from "@/lib/model";
import { stripEmailThread, stripHtml } from "@/utils/formatters";

/**
 * Reads an estate developer's reply for their verdict on the bushfire report.
 *
 * The one inbound message on a compliance file that carries a decision rather
 * than a document. Every other party answers with an attachment, and the
 * pipeline that classifies attachments is what records their answer; a
 * developer writes "approved, thanks" and attaches nothing at all, so without
 * this the file waits eleven working days and then chases somebody who has
 * already replied.
 *
 * Deliberately three-valued, and the third value is the important one.
 * `undecided` is what most replies are — an acknowledgement, a question about
 * the setbacks, an out-of-office from the approvals desk — and returning it is
 * a success rather than a failure. The screen is designed around an admin being
 * able to record the verdict by hand, so a miss costs a click; a wrong
 * `approved` puts a job past a covenant gate on the strength of a sentence
 * nobody read.
 *
 * That asymmetry is the whole design of the prompt below. It is told to answer
 * only where the sender has actually decided, and reminded that saying nothing
 * is the ordinary answer.
 */

const developerVerdictSchema = z.object({
  decision: z
    .enum(["approved", "rejected", "undecided"])
    .describe(
      "The sender's verdict on the bushfire report. 'undecided' unless they have plainly given one.",
    ),
  reason: z
    .string()
    .default("")
    .describe(
      "On a rejection, what they say has to change — quoted from the message as written, never paraphrased. Empty on anything else.",
    ),
});

export type DeveloperVerdict = {
  decision: ComplianceApprovalDecision | null;
  reason: string;
};

const INSTRUCTION = `You read one email from the developer of an Australian residential land estate. We sent them a bushfire attack level assessment for a house being built on a lot in their estate, and asked whether they approve it. You decide whether this message actually gives that answer.

Return one of three decisions:

- "approved" — the sender plainly says the assessment is approved, accepted, endorsed, satisfactory, or that we may proceed to lodge. It must be their decision about this report, not a description of a process ("approvals usually take two weeks") and not a conditional ("we would approve it if…").
- "rejected" — the sender plainly says it is not approved, is rejected, does not comply, or has to be changed before they will approve it. A message asking for changes to the report IS a rejection, because the report as sent will not do.
- "undecided" — anything else. An acknowledgement, a question, a request for more documents, an out-of-office, a note that it is with their consultant, or a message you cannot confidently read as either of the above.

"undecided" is the ordinary answer and returning it is never a failure. A person will read this thread and record the answer by hand if you do not, so a missed verdict costs somebody a click. A wrong verdict puts a house past a covenant gate on the strength of a sentence nobody checked, or sends a consultant off to redo a report that was never refused.

On a rejection, "reason" must be the sender's own words about what has to change, quoted from the message. Never summarise, never compress, never write your own explanation of the problem. Those words are sent verbatim to the consultant who has to redo the report. If they rejected it without saying why, return the sentence in which they rejected it. On "approved" and "undecided", return an empty string.`;

/**
 * The developer's verdict, or nothing.
 *
 * Returns `{ decision: null }` on any failure. The reply has already been
 * recorded on the thread and is already on screen by the time this runs, and
 * failing the caller because a model call timed out would lose the message to
 * report a flag that a person can set in one click.
 */
export async function detectDeveloperVerdict(params: {
  subject: string;
  body: string;
}): Promise<DeveloperVerdict> {
  const nothing: DeveloperVerdict = { decision: null, reason: "" };

  try {
    // The latest message only. The quoted history below it contains our own
    // request — "could you let us know whether you approve it" — and on a long
    // thread, our own previous summary of what they said last time. Reading
    // either would have this answering a question about a message we wrote.
    const clean = stripHtml(stripEmailThread(params.body)).trim();
    if (!clean) {
      return nothing;
    }

    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      system: INSTRUCTION,
      prompt: `Subject: ${params.subject}\n\n${clean}`,
      experimental_output: Output.object({ schema: developerVerdictSchema }),
    });

    if (output.decision === "approved") {
      return { decision: ComplianceApprovalDecision.APPROVED, reason: "" };
    }

    if (output.decision === "rejected") {
      const reason = output.reason.trim();
      // A rejection with no words behind it is not actionable, and recording it
      // would open a revision round whose mail says the developer refused the
      // report and cannot say why. Better to leave the verdict for a person who
      // can read the thread — the alert stays open and the block still offers
      // both buttons.
      if (!reason) {
        return nothing;
      }
      return { decision: ComplianceApprovalDecision.REJECTED, reason };
    }

    return nothing;
  } catch (error) {
    console.error("Could not read the developer's verdict off their reply", error);
    return nothing;
  }
}
