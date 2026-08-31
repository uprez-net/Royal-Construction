"use client";

import { webMcpError } from "@/components/webmcp/tool-result";
import type { WebMcpToolConfig } from "@/hooks/use-webmcp-tool";
import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";

import type { OfferToolDeps } from "./deps";
import {
    addWorkbookItemArgs,
    removeWorkbookItemArgs,
    updateCostRequirementsArgs,
    updateWorkbookItemArgs,
} from "./schemas";
import {
    FieldErrors,
    Patch,
    gate,
    nothingToWrite,
    presentKeys,
    readNonNegative,
    readText,
    writeResult,
} from "./write-helpers";

/** The area-calculator inputs. Every calculator OUTPUT is derived from these. */
const REQUIREMENT_FIELDS = [
    "dropEdgeBeamSurfaceArea",
    "numberOfTrucks",
    "steel",
    "installer",
    "eaves",
    "bricksGroundFloor",
    "bricksFirstFloor",
    "bricksPillar",
    "tieCost",
    "tilesGroundFloor",
    "tilesBathroom",
    "tilesSteps",
] as const;

const ROW_TEXT_FIELDS = ["itemName", "offerTenderLineItem", "tradeOrVendor"] as const;
const ROW_FIELDS = [...ROW_TEXT_FIELDS, "costExGst", "includedInContract"] as const;

export function createCostScheduleTools(deps: OfferToolDeps): WebMcpToolConfig[] {
    const findRow = (id: string) => deps.lines.find((line) => line.id === id);

    return [
        {
            name: "update_cost_requirements",
            title: "Update the cost schedule's measurements",
            description:
                "Changes the area-calculator inputs the calculated cost lines resolve from — truck counts, brick counts, tile areas, steel and installer rates. Every slab, frame, brick and tile total recomputes from these; none of those totals can be written directly. Returns the new direct total so you can see the effect.",
            inputSchema: updateCostRequirementsArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "cost-schedule");
                if (blocked) return blocked;

                const errors = new FieldErrors();
                const patch: Record<string, number> = {};

                for (const field of presentKeys(input, REQUIREMENT_FIELDS)) {
                    const value = readNonNegative(input[field], field, errors);
                    if (value !== null) patch[field] = value;
                }

                if (errors.any) return errors.toResult();
                if (Object.keys(patch).length === 0) return nothingToWrite(REQUIREMENT_FIELDS);

                const before = deps.directTotal;
                deps.updateAreaCalculator(patch);

                return writeResult(deps, {
                    updated: Object.keys(patch),
                    directTotalBefore: before,
                    // Read after the mutator, but React has not re-rendered yet,
                    // so this is still the old value. Point at the read tool
                    // rather than report a number that is about to change.
                    recomputed:
                        "The calculated cost lines and the price build-up recompute from these. Call get_cost_schedule or get_pricing_summary for the new totals.",
                });
            },
        },
        {
            name: "add_workbook_item",
            title: "Add a cost line",
            description:
                "Appends a manual line to the cost workbook. Giving it a value above zero marks it as included in the contract, which is what the grid does. Use update_cost_requirements instead when the number you want comes out of a measurement.",
            inputSchema: addWorkbookItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "cost-schedule");
                if (blocked) return blocked;

                const errors = new FieldErrors();
                const itemName = readText(input.itemName, "itemName", errors);
                if (itemName !== null && itemName.trim().length === 0) {
                    errors.add("itemName", "cannot be empty — the row needs a task name.");
                }

                const patch: Patch<OfferWorkspaceCostLine> = {};
                if (input.costExGst !== undefined) {
                    const cost = readNonNegative(input.costExGst, "costExGst", errors);
                    if (cost !== null) {
                        patch.costExGst = cost;
                        // Mirrors the grid: pricing a row includes it, because a
                        // priced line excluded from the contract is almost always
                        // a mistake rather than an intention.
                        if (cost > 0) patch.includedInContract = true;
                    }
                }
                for (const field of presentKeys(input, ["offerTenderLineItem", "tradeOrVendor"])) {
                    const value = readText(input[field], field, errors);
                    if (value !== null) (patch as Record<string, unknown>)[field] = value;
                }
                if (input.includedInContract !== undefined) {
                    if (typeof input.includedInContract !== "boolean") {
                        errors.add("includedInContract", "must be true or false.");
                    } else {
                        patch.includedInContract = input.includedInContract;
                    }
                }

                if (errors.any) return errors.toResult();

                // addLine appends a blank row; the id is the one it just made.
                const before = new Set(deps.lines.map((line) => line.id));
                deps.addLine();
                const created = deps.lines.find((line) => !before.has(line.id));

                if (!created) {
                    // The append is a setState, so the new row is not visible on
                    // this render. Patch on the next call rather than guess an id.
                    return writeResult(deps, {
                        added: true,
                        itemName,
                        pending: true,
                        nextActions: [
                            "Call get_cost_schedule to get the new row's id, then update_workbook_item to set its remaining fields.",
                        ],
                    });
                }

                deps.updateLine(created.id, { ...patch, itemName: itemName ?? "" });
                return writeResult(deps, { added: true, id: created.id, itemName });
            },
        },
        {
            name: "update_workbook_item",
            title: "Update a cost line",
            description:
                "Changes one cost-workbook row, found by the id from get_cost_schedule. A row whose source is \"formula\" resolves its value from the job's measurements, so its cost cannot be set here — change the measurement instead. The row's labels and its included flag stay editable either way.",
            inputSchema: updateWorkbookItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "cost-schedule");
                if (blocked) return blocked;

                const errors = new FieldErrors();
                const id = readText(input.id, "id", errors);
                if (id === null) return errors.toResult();

                const row = findRow(id);
                if (!row) {
                    return webMcpError(
                        `No cost line ${id} on this offer. Call get_cost_schedule for the current ids.`,
                    );
                }

                const patch: Patch<OfferWorkspaceCostLine> = {};

                for (const field of presentKeys(input, ROW_TEXT_FIELDS)) {
                    const value = readText(input[field], field, errors);
                    if (value === null) continue;
                    (patch as Record<string, unknown>)[field] = value;
                    // The grid writes both from one textarea, so the two fields
                    // cannot diverge from the UI. A tool that let them diverge
                    // would create a state no click can produce or repair.
                    if (field === "offerTenderLineItem") patch.notesOrSpec = value;
                }

                if (input.costExGst !== undefined) {
                    if (row.formula) {
                        errors.derived(
                            `costExGst on row ${id}`,
                            `the formula "${row.formula}" over the job's measurements — change those with update_cost_requirements or update_job_setup`,
                        );
                    } else {
                        const cost = readNonNegative(input.costExGst, "costExGst", errors);
                        if (cost !== null) {
                            patch.costExGst = cost;
                            if (cost > 0 && input.includedInContract === undefined) {
                                patch.includedInContract = true;
                            }
                        }
                    }
                }

                if (input.includedInContract !== undefined) {
                    if (typeof input.includedInContract !== "boolean") {
                        errors.add("includedInContract", "must be true or false.");
                    } else {
                        patch.includedInContract = input.includedInContract;
                    }
                }

                if (errors.any) return errors.toResult();
                if (Object.keys(patch).length === 0) return nothingToWrite(ROW_FIELDS);

                deps.updateLine(id, patch);
                return writeResult(deps, { id, updated: Object.keys(patch) });
            },
        },
        {
            name: "remove_workbook_item",
            title: "Remove a cost line",
            description:
                "Deletes a row from the cost workbook. This lowers the quoted price, so confirm with the user before calling it rather than after. Setting includedInContract to false with update_workbook_item takes the row out of the price while keeping it on the sheet, which is usually what is wanted.",
            inputSchema: removeWorkbookItemArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "cost-schedule");
                if (blocked) return blocked;

                const errors = new FieldErrors();
                const id = readText(input.id, "id", errors);
                if (id === null) return errors.toResult();

                const row = findRow(id);
                if (!row) {
                    return webMcpError(
                        `No cost line ${id} on this offer. Call get_cost_schedule for the current ids.`,
                    );
                }

                deps.removeLine(id);
                return writeResult(deps, {
                    removed: id,
                    itemName: row.itemName,
                    costExGst: row.costExGst,
                    recomputed:
                        "The direct total and the price build-up have changed. Call get_pricing_summary for the new figures.",
                });
            },
        },
    ];
}
