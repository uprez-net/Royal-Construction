"use client";

import { webMcpError } from "@/components/webmcp/tool-result";
import type { WebMcpToolConfig } from "@/hooks/use-webmcp-tool";
import type { OfferDocumentDraft, OfferInclusionEntry } from "@/lib/offer/workspace-model";

import type { OfferToolDeps } from "./deps";
import {
    addInclusionItemArgs,
    removeInclusionItemArgs,
    updateInclusionItemArgs,
    updateOfferDocumentArgs,
} from "./schemas";
import {
    FieldErrors,
    Patch,
    gate,
    nothingToWrite,
    presentKeys,
    readText,
    writeResult,
} from "./write-helpers";

const TEXT_FIELDS = ["headline", "introText", "termsSummary"] as const;
const LIST_FIELDS = ["inclusionHighlights", "exclusionBullets"] as const;
const DOCUMENT_FIELDS = [...TEXT_FIELDS, ...LIST_FIELDS] as const;

/** Reads a zero-based schedule index, or records why it is unusable. */
function readIndex(
    value: unknown,
    length: number,
    errors: FieldErrors,
): number | null {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.add("index", "must be a whole number.");
        return null;
    }
    if (value < 0 || value >= length) {
        errors.add(
            "index",
            length === 0
                ? "is out of range — the inclusion schedule is empty."
                : `is out of range — the inclusion schedule has ${length} rows, so valid indexes are 0 to ${length - 1}.`,
        );
        return null;
    }
    return value;
}

export function createDocumentTools(deps: OfferToolDeps): WebMcpToolConfig[] {
    const schedule = () => deps.draft.inclusionSchedule;

    const writeSchedule = (next: readonly OfferInclusionEntry[]) => {
        deps.updateDraft({ inclusionSchedule: next });
    };

    return [
        {
            name: "update_offer_document_content",
            title: "Update the offer document's copy",
            description:
                "Changes the customer-facing wording on the offer document: the headline, the intro, the selling list beside the price, the exclusion bullets and the terms summary. Partial. The selling list (inclusionHighlights) is not the contractual schedule — use the inclusion tools for that.",
            inputSchema: updateOfferDocumentArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "offer-document");
                if (blocked) return blocked;

                const errors = new FieldErrors();

                if (input.inclusionSchedule !== undefined) {
                    errors.add(
                        "inclusionSchedule",
                        "is not written here — it is the contractual schedule. Use add_inclusion_item, update_inclusion_item or remove_inclusion_item.",
                    );
                }

                const patch: Patch<OfferDocumentDraft> = {};

                for (const field of presentKeys(input, TEXT_FIELDS)) {
                    const value = readText(input[field], field, errors);
                    if (value !== null) (patch as Record<string, unknown>)[field] = value;
                }

                for (const field of presentKeys(input, LIST_FIELDS)) {
                    const raw = input[field];
                    if (!Array.isArray(raw) || raw.some((line) => typeof line !== "string")) {
                        errors.add(field, "must be an array of strings.");
                        continue;
                    }
                    (patch as Record<string, unknown>)[field] = raw as string[];
                }

                if (errors.any) return errors.toResult();
                if (Object.keys(patch).length === 0) return nothingToWrite(DOCUMENT_FIELDS);

                deps.updateDraft(patch);
                return writeResult(deps, {
                    updated: Object.keys(patch),
                    // updateDraft clears them, and the agent should know a check
                    // it may have just run no longer holds.
                    note: "Editing the document clears any consistency-check result on it; re-run the check from the UI if it matters.",
                });
            },
        },
        {
            name: "add_inclusion_item",
            title: "Add an inclusion",
            description:
                "Appends a row to the contractual inclusion schedule — the list of what the build actually includes, printed on the offer and the tender. This is contract text: write what the estimator has committed to, not a selling line.",
            inputSchema: addInclusionItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "offer-document");
                if (blocked) return blocked;

                const errors = new FieldErrors();
                const spec = readText(input.spec, "spec", errors);
                if (spec === null) return errors.toResult();
                if (spec.trim().length === 0) {
                    return webMcpError("spec cannot be empty — an inclusion row needs wording.");
                }

                const next = [...schedule(), { spec }];
                writeSchedule(next);
                return writeResult(deps, { added: true, index: next.length - 1, spec });
            },
        },
        {
            name: "update_inclusion_item",
            title: "Update an inclusion",
            description:
                "Rewrites one row of the contractual inclusion schedule, found by its zero-based index from get_offer_section_data. Indexes shift when a row is removed, so re-read before a second change.",
            inputSchema: updateInclusionItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "offer-document");
                if (blocked) return blocked;

                const current = schedule();
                const errors = new FieldErrors();
                const index = readIndex(input.index, current.length, errors);
                const spec = readText(input.spec, "spec", errors);
                if (errors.any) return errors.toResult();
                if (index === null || spec === null) return errors.toResult();
                if (spec.trim().length === 0) {
                    return webMcpError("spec cannot be empty — remove the row instead.");
                }

                const previous = current[index];
                writeSchedule(
                    current.map((entry, position) =>
                        position === index
                            ? // draftedByAi is dropped on purpose: the row has now
                              // been written deliberately, so the "unreviewed AI
                              // text" marking no longer applies.
                              { ...entry, spec, draftedByAi: false }
                            : entry,
                    ),
                );

                return writeResult(deps, { index, spec, replaced: previous.spec });
            },
        },
        {
            name: "remove_inclusion_item",
            title: "Remove an inclusion",
            description:
                "Deletes a row from the contractual inclusion schedule. This is what the customer is told they are getting, so confirm with the user before calling it. Removing a row shifts every later index down by one.",
            inputSchema: removeInclusionItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "offer-document");
                if (blocked) return blocked;

                const current = schedule();
                const errors = new FieldErrors();
                const index = readIndex(input.index, current.length, errors);
                if (index === null) return errors.toResult();

                const removed = current[index];
                writeSchedule(current.filter((_, position) => position !== index));

                return writeResult(deps, {
                    removed: removed.spec,
                    index,
                    remaining: current.length - 1,
                    warning:
                        "The customer-facing inclusion schedule is shorter. Later indexes have shifted down by one.",
                });
            },
        },
    ];
}
