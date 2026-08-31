"use client";

import type { WebMcpToolConfig } from "@/hooks/use-webmcp-tool";
import type { OfferWorkspacePricingSettings } from "@/lib/offer/workspace-pricing";

import type { OfferToolDeps } from "./deps";
import { setCustomerPriceArgs, updatePricingInputsArgs } from "./schemas";
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

/** The two markup levers, held as fractions (0.1 is 10%). */
const PERCENT_FIELDS = ["royalConstructionOverheadPct", "royalConstructionFeePct"] as const;
/** Money inputs. */
const MONEY_FIELDS = ["hbcfTotalContractValue", "impactFeeFixed"] as const;
const PRICING_FIELDS = [...PERCENT_FIELDS, ...MONEY_FIELDS] as const;

const CUSTOMER_PRICE_FIELDS = [
    "selectedPrice",
    "standardPrice",
    "priceAdjustmentLabel",
    "overrideReason",
] as const;

export function createPricingTools(deps: OfferToolDeps): WebMcpToolConfig[] {
    return [
        {
            name: "update_pricing_inputs",
            title: "Update the pricing inputs",
            description:
                "Changes the four values the price build-up is calculated from: the overhead and fee markup levers, the contract value the HBCF premium is derived from, and the fixed impact fee. Everything else on the pricing step is calculated and cannot be written — including the HBCF premium itself. Percentages are fractions: 0.1 is 10%.",
            inputSchema: updatePricingInputsArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "pricing");
                if (blocked) return blocked;

                const errors = new FieldErrors();

                // The one calculated field an agent is most likely to reach for,
                // because every read reports it beside the inputs.
                if (input.homeWarrantyHbcfFixed !== undefined) {
                    errors.derived(
                        "homeWarrantyHbcfFixed",
                        "hbcfTotalContractValue, the HBCF rate and the admin loading charge — set hbcfTotalContractValue instead",
                    );
                }

                const patch: Patch<OfferWorkspacePricingSettings> = {};

                for (const field of presentKeys(input, PERCENT_FIELDS)) {
                    const value = readNonNegative(input[field], field, errors);
                    if (value === null) continue;
                    // The UI guards its percent inputs at 100 for the same
                    // reason: a 20% markup entered as 20 rather than 0.2 would
                    // quote a job at twenty times cost and read as plausible.
                    if (value > 1) {
                        errors.add(
                            field,
                            "is a fraction, not a percentage — 0.1 means 10%. Values above 1 are refused.",
                        );
                        continue;
                    }
                    (patch as Record<string, unknown>)[field] = value;
                }

                for (const field of presentKeys(input, MONEY_FIELDS)) {
                    const value = readNonNegative(input[field], field, errors);
                    if (value !== null) (patch as Record<string, unknown>)[field] = value;
                }

                if (errors.any) return errors.toResult();
                if (Object.keys(patch).length === 0) return nothingToWrite(PRICING_FIELDS);

                deps.updatePricingSettings(patch);
                return writeResult(deps, {
                    updated: Object.keys(patch),
                    recomputed:
                        "The whole build-up recomputes from these. Call get_pricing_summary for the new contract value and margin.",
                });
            },
        },
        {
            name: "set_customer_price",
            title: "Set the customer-facing price",
            description:
                "Sets the fixed price inc GST the customer is actually offered, overriding the calculated build-up, plus the standard price and adjustment label used to show a saving. An override away from the calculated value needs overrideReason in the same call — without one the offer cannot be sent. Pass selectedPrice: 0 to clear the override and go back to the calculated price.",
            inputSchema: setCustomerPriceArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const blocked = gate(deps, "pricing");
                if (blocked) return blocked;

                const errors = new FieldErrors();
                const named = presentKeys(input, CUSTOMER_PRICE_FIELDS);
                if (named.length === 0) return nothingToWrite(CUSTOMER_PRICE_FIELDS);

                let selectedPrice: number | null = null;
                if (input.selectedPrice !== undefined) {
                    selectedPrice = readNonNegative(input.selectedPrice, "selectedPrice", errors);
                }

                let standardPrice: number | null = null;
                if (input.standardPrice !== undefined) {
                    standardPrice = readNonNegative(input.standardPrice, "standardPrice", errors);
                }

                let overrideReason: string | null = null;
                if (input.overrideReason !== undefined) {
                    overrideReason = readText(input.overrideReason, "overrideReason", errors);
                }

                let adjustmentLabel: string | null = null;
                if (input.priceAdjustmentLabel !== undefined) {
                    adjustmentLabel = readText(
                        input.priceAdjustmentLabel,
                        "priceAdjustmentLabel",
                        errors,
                    );
                }

                if (errors.any) return errors.toResult();

                // Refuse the override that would leave the offer unsendable,
                // rather than accepting it and reporting the blocker later.
                if (selectedPrice !== null && selectedPrice > 0) {
                    const computed = deps.customerPrice.computedContractValueIncGst;
                    const differs = Math.round(selectedPrice) !== Math.round(computed);
                    const reason = (overrideReason ?? deps.overrideReason).trim();
                    if (differs && reason.length === 0) {
                        const missing = new FieldErrors();
                        missing.add(
                            "overrideReason",
                            `is required. ${selectedPrice} differs from the calculated ${computed}, and an offer carrying an unexplained override cannot be sent. Pass the commercial reason in the same call.`,
                        );
                        return missing.toResult();
                    }
                }

                if (selectedPrice !== null) {
                    deps.setSelectedPriceInput(selectedPrice > 0 ? String(selectedPrice) : "");
                }
                if (standardPrice !== null) {
                    deps.setStandardPriceInput(standardPrice > 0 ? String(standardPrice) : "");
                }
                if (overrideReason !== null) deps.setOverrideReason(overrideReason);
                if (adjustmentLabel !== null) deps.setPriceAdjustmentLabel(adjustmentLabel);

                return writeResult(deps, {
                    updated: named,
                    ...(selectedPrice !== null && selectedPrice === 0
                        ? { cleared: "selectedPrice — the offer falls back to the calculated build-up." }
                        : {}),
                    recomputed:
                        "Call get_pricing_summary for the resulting variance and effective margin.",
                });
            },
        },
    ];
}
