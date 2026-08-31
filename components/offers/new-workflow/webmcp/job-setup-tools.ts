"use client";

import { webMcpError } from "@/components/webmcp/tool-result";
import type { WebMcpToolConfig } from "@/hooks/use-webmcp-tool";
import type { OfferWorkspaceJob } from "@/lib/offer/workspace-model";

import type { OfferToolDeps } from "./deps";
import { prefillArgs, updateJobSetupArgs } from "./schemas";
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

/** Text fields written straight through. */
const TEXT_FIELDS = [
    "buildType",
    "facade",
    "siteAddress",
    "siteCouncil",
    "dpNumber",
    "zoning",
    "validUntil",
    "preparedBy",
] as const;

/** Numeric fields, all of which must be at or above zero. */
const NUMBER_FIELDS = [
    "lotAreaSqm",
    "groundFloorSqm",
    "firstFloorSqm",
    "voidSqm",
    "garageSqm",
    "alfrescoPorchSqm",
    "porchSqm",
    "balconySqm",
    "grannyFlatSqm",
    "bedrooms",
    "bathrooms",
    "garageSpaces",
] as const;

const WRITABLE = [...TEXT_FIELDS, ...NUMBER_FIELDS, "buildScope"] as const;

/**
 * Fields projected from the owners list by `deriveOwnerProjection`.
 *
 * Writing one directly is the bug this map exists to prevent: the value would
 * stick until the next owner edit and then silently revert, and in between the
 * offer would print a name nobody entered.
 */
const OWNER_PROJECTED: Record<string, string> = {
    clientNames: "the owners list",
    secondaryCustomerName: "the owners list",
    clientEmail: "the owners list",
    secondaryCustomerEmail: "the owners list",
    clientPhone: "the owners list",
    currentLocation: "the owners list",
};

/** Fields the offer owns rather than the estimator. */
const NOT_WRITABLE: Record<string, string> = {
    ...OWNER_PROJECTED,
    reference: "the offer's server-assigned reference",
    revision: "the offer's revision number",
};

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export function createJobSetupTools(deps: OfferToolDeps): WebMcpToolConfig[] {
    return [
        {
            name: "update_job_setup",
            title: "Update the offer's job setup",
            description:
                "Changes the build details, site details and floor areas on the offer currently open. Partial: name only the fields you are changing. Floor areas feed the cost schedule and the price, so changing one changes both. Owner and signatory details are NOT written here — they are edited in the Owners panel, and the client name, email and location fields are projected from them.",
            inputSchema: updateJobSetupArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "job-setup");
                if (blocked) return blocked;

                const errors = new FieldErrors();

                // Named before anything else: a caller reaching for one of these
                // has the wrong model of how owners work, and telling it which
                // field to use instead is the whole correction.
                for (const [field, upstream] of Object.entries(NOT_WRITABLE)) {
                    if (input[field] !== undefined) errors.derived(field, upstream);
                }

                const patch: Patch<OfferWorkspaceJob> = {};

                for (const field of presentKeys(input, TEXT_FIELDS)) {
                    const value = readText(input[field], field, errors);
                    if (value === null) continue;
                    if (field === "validUntil" && !YYYY_MM_DD.test(value.trim())) {
                        errors.add("validUntil", "must be a date as YYYY-MM-DD.");
                        continue;
                    }
                    (patch as Record<string, unknown>)[field] = value;
                }

                for (const field of presentKeys(input, NUMBER_FIELDS)) {
                    const value = readNonNegative(input[field], field, errors);
                    if (value === null) continue;
                    (patch as Record<string, unknown>)[field] = value;
                }

                if (input.buildScope !== undefined) {
                    const raw = input.buildScope;
                    if (!Array.isArray(raw) || raw.some((line) => typeof line !== "string")) {
                        errors.add("buildScope", "must be an array of strings.");
                    } else {
                        patch.buildScope = raw as string[];
                    }
                }

                if (errors.any) return errors.toResult();
                if (Object.keys(patch).length === 0) return nothingToWrite(WRITABLE);

                deps.updateJob(patch);

                const touchedAreas = presentKeys(input, NUMBER_FIELDS).some((field) =>
                    field.endsWith("Sqm"),
                );
                return writeResult(deps, {
                    updated: Object.keys(patch),
                    // The agent has no other way to know a floor-area change just
                    // moved the price out from under it.
                    ...(touchedAreas
                        ? {
                              recomputed:
                                  "Floor areas changed, so the area-calculated cost lines and the whole price build-up have been recomputed. Call get_pricing_summary for the new figures.",
                          }
                        : {}),
                });
            },
        },
        {
            name: "prefill_job_setup_from_lead",
            title: "Pre-fill job setup from the lead",
            description:
                "Fills the offer's job setup from the lead record, the same as the Pre-Fill With Lead button. Refuses by default if it would overwrite fields that already have a value; pass force: true to overwrite once the user has agreed. Prefer update_job_setup for a single field.",
            inputSchema: prefillArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "job-setup");
                if (blocked) return blocked;

                if (deps.leadId === undefined) {
                    return webMcpError(
                        "This offer is not attached to a lead yet, so there is nothing to pre-fill from.",
                    );
                }

                const force = input.force === true;
                if (!force) {
                    // Only the fields the prefill actually targets. Refusing over
                    // a field it would never touch would make `force` look
                    // mandatory when it is not.
                    const filled = ["siteAddress", "siteCouncil", "buildType", "zoning"].filter(
                        (field) => {
                            const value = (deps.job as unknown as Record<string, unknown>)[field];
                            return typeof value === "string" && value.trim().length > 0;
                        },
                    );
                    if (filled.length > 0) {
                        return webMcpError(
                            `Pre-filling would overwrite ${filled.join(", ")}, which already have values. Ask the user whether to replace them, then call again with force: true. To change one field on its own, use update_job_setup.`,
                        );
                    }
                }

                const result = await deps.prefillFromLead();
                if (!result.ok) return webMcpError(result.message);

                return writeResult(deps, { prefilled: true, detail: result.message });
            },
        },
    ];
}
