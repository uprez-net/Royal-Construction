"use client";

import { webMcpError } from "@/components/webmcp/tool-result";
import type { WebMcpToolConfig } from "@/hooks/use-webmcp-tool";
import type {
    OfferScopeAmountType,
    OfferScopeItemCategory,
    OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";

import type { OfferToolDeps } from "./deps";
import { addScopeItemArgs, removeScopeItemArgs, updateScopeItemArgs } from "./schemas";
import {
    FieldErrors,
    Patch,
    gate,
    presentKeys,
    readNonNegative,
    readText,
    writeResult,
} from "./write-helpers";

const CATEGORIES: readonly OfferScopeItemCategory[] = [
    "prime_cost",
    "provisional_sum",
    "owner_selection",
    "exclusion",
    "other",
];

const AMOUNT_TYPES: readonly OfferScopeAmountType[] = [
    "fixed_amount",
    "rate_per_sqm",
    "included_note",
];

const TEXT_FIELDS = ["label", "description", "unit", "variationRule"] as const;

type ScopeList = "allowance" | "exclusion";

function readList(input: Record<string, unknown>): ScopeList | null {
    const raw = typeof input.type === "string" ? input.type.trim() : "";
    return raw === "allowance" || raw === "exclusion" ? raw : null;
}

const unknownList = (value: unknown) =>
    webMcpError(
        `type must be "allowance" or "exclusion" (got ${JSON.stringify(value)}). Allowances are PC and provisional sums; exclusions are what the price does not cover.`,
    );

export function createScopeTools(deps: OfferToolDeps): WebMcpToolConfig[] {
    const itemsFor = (list: ScopeList) =>
        list === "allowance" ? deps.allowances : deps.exclusions;

    /** Reads the shared item fields into a patch, recording any bad values. */
    const readPatch = (input: Record<string, unknown>, errors: FieldErrors) => {
        const patch: Patch<OfferWorkspaceScopeItem> = {};

        for (const field of presentKeys(input, TEXT_FIELDS)) {
            const value = readText(input[field], field, errors);
            if (value !== null) (patch as Record<string, unknown>)[field] = value;
        }

        if (input.category !== undefined) {
            const value = String(input.category);
            if (!CATEGORIES.includes(value as OfferScopeItemCategory)) {
                errors.add("category", `must be one of ${CATEGORIES.join(", ")}.`);
            } else {
                patch.category = value as OfferScopeItemCategory;
            }
        }

        if (input.amountType !== undefined) {
            const value = String(input.amountType);
            if (!AMOUNT_TYPES.includes(value as OfferScopeAmountType)) {
                errors.add("amountType", `must be one of ${AMOUNT_TYPES.join(", ")}.`);
            } else {
                patch.amountType = value as OfferScopeAmountType;
            }
        }

        if (input.amount !== undefined) {
            const value = readNonNegative(input.amount, "amount", errors);
            if (value !== null) patch.amount = value;
        }

        if (input.includedInOfferDocument !== undefined) {
            if (typeof input.includedInOfferDocument !== "boolean") {
                errors.add("includedInOfferDocument", "must be true or false.");
            } else {
                patch.includedInOfferDocument = input.includedInOfferDocument;
            }
        }

        return patch;
    };

    return [
        {
            name: "add_scope_item",
            title: "Add a scope item",
            description:
                "Adds a prime-cost or provisional-sum allowance, or an exclusion, to the offer's scope. Set includedInOfferDocument to true for it to print on the customer-facing document; an item that is not shown still exists internally but the customer never sees it.",
            inputSchema: addScopeItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "scope");
                if (blocked) return blocked;

                const list = readList(input);
                if (!list) return unknownList(input.type);

                const errors = new FieldErrors();
                const label = readText(input.label, "label", errors);
                if (label !== null && label.trim().length === 0) {
                    errors.add("label", "cannot be empty.");
                }
                const patch = readPatch(input, errors);
                if (errors.any) return errors.toResult();

                const before = new Set(itemsFor(list).map((item) => item.id));
                if (list === "allowance") deps.addAllowance();
                else deps.addExclusion();

                const created = itemsFor(list).find((item) => !before.has(item.id));
                if (!created) {
                    // The append is a setState and has not rendered yet, so the
                    // new item's id is not knowable on this call.
                    return writeResult(deps, {
                        added: true,
                        type: list,
                        label,
                        pending: true,
                        nextActions: [
                            'Call get_offer_section_data with section "scope" for the new item id, then update_scope_item to fill it in.',
                        ],
                    });
                }

                const apply = list === "allowance" ? deps.updateAllowance : deps.updateExclusion;
                apply(created.id, { ...patch, label: label ?? "" });
                return writeResult(deps, { added: true, type: list, id: created.id, label });
            },
        },
        {
            name: "update_scope_item",
            title: "Update a scope item",
            description:
                "Changes one allowance or exclusion, found by the id from get_offer_section_data. Pass the same type the item is in — an allowance id is not found in the exclusions list.",
            inputSchema: updateScopeItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "scope");
                if (blocked) return blocked;

                const list = readList(input);
                if (!list) return unknownList(input.type);

                const errors = new FieldErrors();
                const id = readText(input.id, "id", errors);
                if (id === null) return errors.toResult();

                const item = itemsFor(list).find((entry) => entry.id === id);
                if (!item) {
                    const otherList = list === "allowance" ? "exclusion" : "allowance";
                    const inOther = itemsFor(otherList).some((entry) => entry.id === id);
                    return webMcpError(
                        inOther
                            ? `${id} is an ${otherList}, not an ${list}. Call again with type: "${otherList}".`
                            : `No ${list} ${id} on this offer. Call get_offer_section_data with section "scope" for the current ids.`,
                    );
                }

                const patch = readPatch(input, errors);
                if (errors.any) return errors.toResult();
                if (Object.keys(patch).length === 0) {
                    return webMcpError(
                        `Name at least one field to change. This tool writes: ${[...TEXT_FIELDS, "category", "amountType", "amount", "includedInOfferDocument"].join(", ")}.`,
                    );
                }

                const apply = list === "allowance" ? deps.updateAllowance : deps.updateExclusion;
                apply(id, patch);
                return writeResult(deps, { type: list, id, updated: Object.keys(patch) });
            },
        },
        {
            name: "remove_scope_item",
            title: "Remove a scope item",
            description:
                "Deletes an allowance or an exclusion. Removing an exclusion widens what the fixed price is taken to cover, so confirm with the user first. To take an item off the customer-facing document without deleting it, set includedInOfferDocument to false with update_scope_item instead.",
            inputSchema: removeScopeItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "scope");
                if (blocked) return blocked;

                const list = readList(input);
                if (!list) return unknownList(input.type);

                const errors = new FieldErrors();
                const id = readText(input.id, "id", errors);
                if (id === null) return errors.toResult();

                const item = itemsFor(list).find((entry) => entry.id === id);
                if (!item) {
                    return webMcpError(
                        `No ${list} ${id} on this offer. Call get_offer_section_data with section "scope" for the current ids.`,
                    );
                }

                if (list === "allowance") deps.removeAllowance(id);
                else deps.removeExclusion(id);

                return writeResult(deps, {
                    removed: id,
                    type: list,
                    label: item.label,
                    ...(list === "exclusion"
                        ? {
                              warning:
                                  "An exclusion is gone, so the fixed price now reads as covering this work. Tell the user plainly.",
                          }
                        : {}),
                });
            },
        },
    ];
}
