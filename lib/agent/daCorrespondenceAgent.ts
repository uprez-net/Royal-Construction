import { generateText, Output } from "ai";
import { z } from "zod";

import { gateway } from "@/lib/model";
import { stripEmailThread, stripHtml } from "@/utils/formatters";

/**
 * Reads what a consent authority has come back with on a development
 * application.
 *
 * A DA is not assessed off the pack alone. Weeks after lodgement the council
 * writes and asks for a shadow diagram, or says the stormwater drawings are
 * unacceptable and names the two sheets it wants redrawn, or sends the notice of
 * determination. All three arrive as prose in an email, in whatever house style
 * that council's assessment officer writes in, and before this there was nowhere
 * for any of them to land: the DA list is a fixed set of types, and a request
 * for anything outside it had to be remembered by whoever read the message.
 *
 * Three answers rather than one, because they cause three different things and
 * the file has to be able to say which happened:
 *
 *  - `requested` — new things being asked for, which become DA_ITEM rows.
 *  - `rejected` — documents already supplied that will not do, each carrying
 *    the objection in the council's own words so it lands on the right row.
 *  - `determined` — the application has been decided.
 *
 * Every one of these is deliberately conservative in the same direction. A
 * missed request is a row somebody adds by hand off a thread that is on screen;
 * an invented one is a job chasing a consultant for a document the council never
 * asked for. So the prompt is told, repeatedly, that returning nothing is a
 * normal answer — most mail from a council is an acknowledgement.
 */

const daCorrespondenceSchema = z.object({
  requested: z
    .array(
      z.object({
        label: z
          .string()
          .describe(
            "What is being asked for, in the council's own words, as a short title a person would recognise on a list. Not a sentence.",
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
      "Documents or information the authority is asking for that they have not been given. Empty is the normal answer.",
    ),
  rejected: z
    .array(
      z.object({
        documentName: z
          .string()
          .describe(
            "The document they are refusing, named as closely as possible to how they name it — 'stormwater drawings', 'the BASIX certificate', 'drawing A03'.",
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
      "Documents already submitted that the authority says are unacceptable and must be revised. Empty is the normal answer.",
    ),
  determined: z
    .boolean()
    .default(false)
    .describe(
      "True only if this message states the application has been determined, approved, or consent granted.",
    ),
});

export type DaCorrespondence = z.infer<typeof daCorrespondenceSchema>;

const INSTRUCTION = `You read one email sent to an Australian residential builder by a consent authority — a NSW council, or the NSW Planning Portal — about a development application that has already been lodged. You decide what, if anything, the message is asking the builder to do.

Return three things.

"requested": documents or information the authority is asking for and has not been given. Typical examples are a shadow diagram, a waste management plan, an arborist report, a survey of an adjoining wall, a BASIX certificate, written owners' consent. Each is one entry, titled the way a person would recognise it on a checklist. A request for several things in one sentence is several entries.

"rejected": documents that were already submitted and that the authority says will not do. The message will say something is not acceptable, does not comply, is illegible, is superseded, or has to be amended and resubmitted. Name the document as closely to their wording as you can, and quote why.

"determined": true only if the message states that the application has been determined, approved, or that consent has been granted. A message that merely mentions determination timeframes, or says the application is progressing towards determination, is not a determination.

Rules that matter more than completeness:

- Returning empty lists and false is a correct and very common answer. Most mail from a council is an acknowledgement, a receipt, a fee notice, or a note that the application has been referred somewhere. None of those asks for anything.
- Only report what THIS message asks for. A council quoting its own earlier letter, or listing what has already been provided, is not making a new request.
- Never invent a document because it is one a DA usually needs. If they did not ask for it, it is not here.
- Never turn one request into two by splitting a document from its own conditions. "An amended waste management plan addressing clause 5.3" is one item, not a plan and a clause.
- A reason must be the authority's own words. A consultant redoing work has only that to go on, and a paraphrase is how the wrong thing gets redone.
- When you cannot tell whether something is a request or background, leave it out. A missed request is a row somebody adds by hand from a thread that is on screen; an invented one sends a builder off to commission a report nobody wanted.`;

/**
 * What one inbound council message asks for.
 *
 * Returns an empty result on any failure. This runs behind a reply that has
 * already been stored and is already visible on the thread, and failing the
 * caller because a model call timed out would lose the message to report a
 * request somebody can read for themselves.
 */
export async function readDaCorrespondence(params: {
  subject: string;
  body: string;
}): Promise<DaCorrespondence> {
  const nothing: DaCorrespondence = {
    requested: [],
    rejected: [],
    determined: false,
  };

  try {
    // The latest message only. A council thread quotes its own history, and on
    // round three that history contains every request from rounds one and two —
    // re-reading it would recreate rows that have already been answered.
    const clean = stripHtml(stripEmailThread(params.body)).trim();
    if (!clean) {
      return nothing;
    }

    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      system: INSTRUCTION,
      prompt: `Subject: ${params.subject}\n\n${clean}`,
      experimental_output: Output.object({ schema: daCorrespondenceSchema }),
    });

    return {
      // Trimmed and emptied here rather than trusted, because both lists are
      // written straight to rows a person then works from: a blank label is a
      // checklist line nobody can action, and a rejection with no reason is a
      // row that says a document was refused and cannot say why.
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
        .filter((item) => item.documentName.length > 0 && item.reason.length > 0),
      determined: output.determined,
    };
  } catch (error) {
    console.error("Could not read the council's message", error);
    return nothing;
  }
}
