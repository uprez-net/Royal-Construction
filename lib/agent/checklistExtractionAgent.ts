import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
} from "ai";
import { z } from "zod";

import { MAPPABLE_DOCUMENT_TYPES } from "@/constants/complianceDocuments";
import { gateway } from "@/lib/model";
import type {
  ChecklistDocumentDetail,
  ChecklistItemDetail,
} from "@/types/compliance";

/**
 * One line of the certifier's checklist.
 *
 * `order` is still not part of this: it is the array's index, which is one less
 * thing the model can get wrong, and it is materialised by the caller. What did
 * become part of it is everything around the line — the sentence explaining what
 * the item is, the amendments the file has to satisfy, the standards it cites.
 * A checklist line without them reads as "Architectural Plans" and gets sent
 * back for a correction that was written on the page all along.
 */
const checklistItemSchema = z.object({
  label: z
    .string()
    .describe(
      "The item itself, in the certifier's own words, with its leading number or letter removed.",
    ),
  clause: z
    .string()
    .optional()
    .describe(
      'The leading number or letter exactly as written — "4a", "2", "14". Omit if the item is not numbered.',
    ),
  group: z
    .string()
    .optional()
    .describe(
      'The heading this item sits under, if it sits under one — "Design Documentation".',
    ),
  description: z
    .string()
    .optional()
    .describe(
      "The certifier's own sentence explaining what this item is, where the label alone does not say. Copy it; never compose one. Omit it rather than restating the label.",
    ),
  requirements: z
    .array(z.string())
    .default([])
    .describe(
      "Conditions, amendments and corrections attached to this item, verbatim and in the order written. Empty unless the certifier listed some.",
    ),
  references: z
    .array(z.string())
    .default([])
    .describe(
      "Standards, code clauses, and named external documents this item cites. Verbatim. Empty unless the certifier named some.",
    ),
  mapsToType: z
    .enum(MAPPABLE_DOCUMENT_TYPES)
    .optional()
    .describe(
      "The kind of document this item is asking for, if it is one of these. Omit when the item asks for something not on the list — do not force a match.",
    ),
});

/**
 * The extracted checklist.
 *
 * `document` is the second half of the answer and did not exist before: a
 * checklist carries a header block and a trailing note that belong to no single
 * item, and the old contract's only way to handle them was to throw them away.
 */
export const checklistExtractionSchema = z.object({
  items: z
    .array(checklistItemSchema)
    .default([])
    .describe(
      "Every item the certifier lists as required, in the order they appear on the document. Return an empty array if the document is not a checklist — never invent items to fill out a short list.",
    ),
  document: z
    .object({
      header: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .default([])
        .describe(
          "The header block, as label/value pairs — project number, reference, site address, scope of works, who it is from and when.",
        ),
      notes: z
        .array(z.string())
        .default([])
        .describe(
          "Notes that apply to the checklist as a whole rather than to one item, verbatim.",
        ),
    })
    .default({ header: [], notes: [] })
    .describe(
      "What the document says about itself, rather than about an item.",
    ),
});

export type ChecklistExtractionData = z.infer<typeof checklistExtractionSchema>;

export type ChecklistExtractionAgentInput = {
  system: string;
  prompt: string;
};

export type ExtractedChecklistItem = {
  label: string;
  order: number;
  /**
   * Null rather than an empty object when the line carried nothing extra, so a
   * row with no detail is indistinguishable from one written before this
   * existed and every consumer needs one emptiness check rather than two.
   */
  detail: ChecklistItemDetail | null;
};

export type ChecklistExtractionAgentResult = {
  items: ExtractedChecklistItem[];
  document: ChecklistDocumentDetail | null;
  message: string;
  ok: boolean;
};

// A checklist with more entries than this is not a checklist — it is a whole
// specification the model has mistaken for one, and turning it into that many
// tracked rows would make the tab unusable. Truncated rather than rejected so
// the admin still gets something to work with.
const MAX_CHECKLIST_ITEMS = 100;

// The same instinct one level down. A checklist item can legitimately carry a
// dozen conditions — the document this was built against has nine on a single
// line — but an item that comes back with two hundred is a page of the spec
// vacuumed into one row, and it would push every other row off the screen
// behind a disclosure nobody can read.
const MAX_REQUIREMENTS_PER_ITEM = 25;
const MAX_REFERENCES_PER_ITEM = 15;
const MAX_HEADER_ENTRIES = 12;
const MAX_DOCUMENT_NOTES = 10;

/** Collapses case, punctuation and spacing so two wordings can be compared. */
function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanList(values: string[], limit: number): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, limit);
}

/**
 * Turns one extracted item into the blob stored on its row.
 *
 * Returns null when the line carried nothing beyond its name. That is the
 * common case for a plain checklist and it must stay cheap: a row holding an
 * empty object would make every consumer check twice.
 */
function toItemDetail(
  item: z.infer<typeof checklistItemSchema>,
  label: string,
): ChecklistItemDetail | null {
  const detail: ChecklistItemDetail = { version: 1 };

  const clause = item.clause?.trim();
  if (clause) detail.clause = clause;
  const group = item.group?.trim();
  if (group) detail.group = group;

  // A description that merely restates the label is noise on every row, and it
  // is exactly what a model produces when asked for one and given nothing to
  // copy.
  const description = item.description?.trim();
  if (description && comparable(description) !== comparable(label)) {
    detail.description = description;
  }

  const requirements = cleanList(item.requirements, MAX_REQUIREMENTS_PER_ITEM);
  if (requirements.length) detail.requirements = requirements;
  const references = cleanList(item.references, MAX_REFERENCES_PER_ITEM);
  if (references.length) detail.references = references;

  if (item.mapsToType) detail.mapsToType = item.mapsToType;

  // `version` alone is not content.
  return Object.keys(detail).length > 1 ? detail : null;
}

function toDocumentDetail(
  document: ChecklistExtractionData["document"],
): ChecklistDocumentDetail | null {
  const detail: ChecklistDocumentDetail = { version: 1 };

  const header = document.header
    .map((entry) => ({ label: entry.label.trim(), value: entry.value.trim() }))
    .filter((entry) => entry.label && entry.value)
    .slice(0, MAX_HEADER_ENTRIES);
  if (header.length) detail.header = header;

  const notes = cleanList(document.notes, MAX_DOCUMENT_NOTES);
  if (notes.length) detail.notes = notes;

  return Object.keys(detail).length > 1 ? detail : null;
}

/**
 * Reads a certifier's checklist out of its OCR markdown.
 *
 * Never throws for a model-side failure: a checklist the model cannot parse
 * degrades to an empty list with `ok: false`, so the workflow can report "no
 * items could be read" and leave the document in place for someone to work
 * through by hand. Anything else — a gateway outage, a bad key — is rethrown
 * so the step's retry sees it.
 */
export async function runChecklistExtraction(
  input: ChecklistExtractionAgentInput,
): Promise<ChecklistExtractionAgentResult> {
  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      temperature: 0.015,
      topK: 30,
      system: input.system,
      output: Output.object({ schema: checklistExtractionSchema }),
      prompt: input.prompt,
    });

    const parsed = checklistExtractionSchema.parse(output);

    const items = parsed.items
      .map((item) => ({ ...item, label: item.label.trim() }))
      .filter((item) => item.label.length > 0)
      .slice(0, MAX_CHECKLIST_ITEMS)
      .map((item, index) => ({
        label: item.label,
        order: index,
        detail: toItemDetail(item, item.label),
      }));

    return {
      items,
      document: toDocumentDetail(parsed.document),
      message: items.length
        ? `Read ${items.length} checklist item${items.length === 1 ? "" : "s"}.`
        : "No checklist items were found on the document.",
      ok: true,
    };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error)
      || TypeValidationError.isInstance(error)
      || NoOutputGeneratedError.isInstance(error)
    ) {
      return {
        items: [],
        document: null,
        message: `Checklist extraction was incomplete: ${error.message}`,
        ok: false,
      };
    }

    throw error;
  }
}
