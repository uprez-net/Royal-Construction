import { generateText, Output } from "ai";
import { z } from "zod";

import { gateway } from "@/lib/model";
import { stripEmailThread, stripHtml } from "@/utils/formatters";

/**
 * Reads what an assessing body has come back with, mid-assessment.
 *
 * Two bodies assess this job and both behave the same way once they hold the
 * pack. A council writes weeks after lodgement asking for a shadow diagram, or
 * says the stormwater drawings are unacceptable and names the sheets it wants
 * redrawn. A certifier writes after the checklist evidence has gone back, saying
 * item 7 will not do and the BASIX certificate has expired. Both arrive as prose
 * in whatever house style that officer writes in, and before this neither had
 * anywhere to land — a request outside the fixed list, or a refusal of a row
 * already on it, had to be remembered by whoever read the message.
 *
 * One extraction for both, parameterised only by who wrote it. The two differ in
 * vocabulary and in what they assess against; they do not differ in what the
 * reader has to work out, which is what is being asked for and what is being
 * refused. Two prompts for that would be two prompts to keep in step.
 *
 * Three answers rather than one, because they cause three different things and
 * the file has to be able to say which happened:
 *
 *  - `requested` — new things being asked for, which become their own rows.
 *  - `rejected` — documents already supplied that will not do, each carrying
 *    the objection in the sender's own words so it lands on the right row.
 *  - `determined` — the application has been decided, or the certificate
 *    issued.
 *
 * Every one of these is deliberately conservative in the same direction. A
 * missed request is a row somebody adds by hand off a thread that is on screen;
 * an invented one is a job chasing a consultant for a document nobody asked for.
 * So the prompt is told, repeatedly, that returning nothing is a normal answer —
 * most mail from either body is an acknowledgement.
 */

/** Which body wrote the message being read. */
export type AssessorKind = "council" | "certifier";

const assessorCorrespondenceSchema = z.object({
  requested: z
    .array(
      z.object({
        label: z
          .string()
          .describe(
            "What is being asked for, in the sender's own words, as a short title a person would recognise on a list. Not a sentence.",
          ),
        description: z
          .string()
          .default("")
          .describe(
            "The rest of what they said about this item — the conditions it has to satisfy, the standard it must meet. Quoted, not summarised. Empty when they only named it.",
          ),
      }),
    )
    .default([])
    .describe(
      "Documents or information the sender is asking for that they have not been given. Empty is the normal answer.",
    ),
  rejected: z
    .array(
      z.object({
        documentName: z
          .string()
          .describe(
            "The document they are refusing, named as closely as possible to how they name it — 'stormwater drawings', 'the BASIX certificate', 'drawing A03', 'item 7'.",
          ),
        reason: z
          .string()
          .describe(
            "Why it will not do, quoted from the message as written. Never your own summary.",
          ),
      }),
    )
    .default([])
    .describe(
      "Documents already submitted that the sender says are unacceptable and must be revised. Empty is the normal answer.",
    ),
  determined: z
    .boolean()
    .default(false)
    .describe(
      "True only if this message states the assessment is finished — the application determined or consent granted, or the construction certificate issued.",
    ),
});

export type AssessorCorrespondence = z.infer<
  typeof assessorCorrespondenceSchema
>;

/**
 * What each body is, in the terms the model needs to read them.
 *
 * Only the framing differs. Everything after it — the three fields, the rules,
 * and the insistence that nothing is the common answer — is shared, because it
 * is the same reading task either way.
 */
const ASSESSOR_FRAMING: Readonly<Record<AssessorKind, string>> = {
  council:
    "You read one email sent to an Australian residential builder by a consent authority — a NSW council, or the NSW Planning Portal — about a development application that has already been lodged.",
  certifier:
    "You read one email sent to an Australian residential builder by the principal certifier assessing their job, after the builder has sent back evidence against the certifier's own checklist. The certifier is deciding whether each item they asked for has been satisfied.",
};

const INSTRUCTION = (assessor: AssessorKind) =>
  `${ASSESSOR_FRAMING[assessor]} You decide what, if anything, the message is asking the builder to do.

Return three things.

"requested": documents or information the sender is asking for and has not been given. Typical examples are a shadow diagram, a waste management plan, an arborist report, a survey of an adjoining wall, a BASIX certificate, written owners' consent. Each is one entry, titled the way a person would recognise it on a checklist. A request for several things in one sentence is several entries.

"rejected": documents that were already submitted and that the sender says will not do. The message will say something is not acceptable, does not comply, is illegible, is superseded, has expired, or has to be amended and resubmitted. Name the document as closely to their wording as you can, and quote why.

"determined": true only if the message states that the assessment is finished — the application determined or approved, consent granted, or the construction certificate issued. A message that merely mentions timeframes, or says the assessment is progressing, is not a determination.

Rules that matter more than completeness:

- Returning empty lists and false is a correct and very common answer. Most mail from either body is an acknowledgement, a receipt, a fee notice, or a note that the matter has been referred somewhere. None of those asks for anything.
- Only report what THIS message asks for. A sender quoting their own earlier letter, or listing what has already been provided, is not making a new request.
- Never invent a document because it is one an assessment usually needs. If they did not ask for it, it is not here.
- Never turn one request into two by splitting a document from its own conditions. "An amended waste management plan addressing clause 5.3" is one item, not a plan and a clause.
- A reason must be the sender's own words. A consultant redoing work has only that to go on, and a paraphrase is how the wrong thing gets redone.
- When you cannot tell whether something is a request or background, leave it out. A missed request is a row somebody adds by hand from a thread that is on screen; an invented one sends a builder off to commission a report nobody wanted.`;

/**
 * What one inbound message from an assessing body asks for.
 *
 * Returns an empty result on any failure. This runs behind a reply that has
 * already been stored and is already visible on the thread, and failing the
 * caller because a model call timed out would lose the message to report a
 * request somebody can read for themselves.
 */
export async function readAssessorCorrespondence(params: {
  assessor: AssessorKind;
  subject: string;
  body: string;
}): Promise<AssessorCorrespondence> {
  const nothing: AssessorCorrespondence = {
    requested: [],
    rejected: [],
    determined: false,
  };

  try {
    // The latest message only. These threads quote their own history, and on
    // round three that history contains every request from rounds one and two —
    // re-reading it would recreate rows that have already been answered.
    const clean = stripHtml(stripEmailThread(params.body)).trim();
    if (!clean) {
      return nothing;
    }

    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      system: INSTRUCTION(params.assessor),
      prompt: `Subject: ${params.subject}\n\n${clean}`,
      output: Output.object({
        schema: assessorCorrespondenceSchema,
      }),
    });

    return {
      // Trimmed and emptied here rather than trusted, because both lists are
      // written straight to rows a person then works from: a blank label is a
      // line nobody can action, and a rejection with no reason is a row that
      // says a document was refused and cannot say why.
      requested: output.requested
        .map((item) => ({
          label: item.label.trim(),
          description: item.description.trim(),
        }))
        .filter((item) => item.label.length > 0),
      rejected: output.rejected
        .map((item) => ({
          documentName: item.documentName.trim(),
          reason: item.reason.trim(),
        }))
        .filter(
          (item) => item.documentName.length > 0 && item.reason.length > 0,
        ),
      determined: output.determined,
    };
  } catch (error) {
    console.error(`Could not read the ${params.assessor}'s message`, error);
    return nothing;
  }
}
