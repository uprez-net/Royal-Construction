"use client";

/**
 * Input schemas for the offers tools.
 *
 * Module-level `as const` for the same reason as
 * components/leads/detail/lead-detail-screen.tsx:19 — `useWebMcpTools` hashes
 * the declarations to decide whether to re-register, so a schema rebuilt each
 * render would churn the agent's tool list on every keystroke in the workspace.
 */

/** The five Offer-build sections an agent can read or write. */
export const WRITABLE_SECTIONS = [
    "job-setup",
    "cost-schedule",
    "pricing",
    "scope",
    "offer-document",
] as const;

/** Everything `get_offer_section_data` and `open_offer_section` accept. */
export const READABLE_SECTIONS = [
    ...WRITABLE_SECTIONS,
    "send",
    "tender-access",
    "tender",
    "contract",
    "project",
] as const;

export const noArgs = {
    type: "object",
    properties: {},
    additionalProperties: false,
} as const;

export const sectionArg = {
    type: "object",
    properties: {
        section: {
            type: "string",
            enum: [...READABLE_SECTIONS],
            description: "Which of the ten workspace sections.",
        },
    },
    required: ["section"],
    additionalProperties: false,
} as const;

export const prefillArgs = {
    type: "object",
    properties: {
        force: {
            type: "boolean",
            description:
                "Overwrite fields that already have a value. Without this the tool refuses rather than replacing work someone has done.",
        },
    },
    additionalProperties: false,
} as const;

export const updateJobSetupArgs = {
    type: "object",
    properties: {
        buildType: { type: "string", description: "e.g. Double storey." },
        facade: { type: "string" },
        siteAddress: { type: "string", description: "The site location." },
        siteCouncil: { type: "string" },
        lotAreaSqm: { type: "number" },
        dpNumber: { type: "string", description: "Deposited plan number." },
        zoning: { type: "string" },
        validUntil: { type: "string", description: "Offer validity date, YYYY-MM-DD." },
        preparedBy: { type: "string" },
        buildScope: {
            type: "array",
            items: { type: "string" },
            description: "Scope lines, one per entry.",
        },
        groundFloorSqm: { type: "number" },
        firstFloorSqm: { type: "number" },
        voidSqm: { type: "number" },
        garageSqm: { type: "number" },
        alfrescoPorchSqm: { type: "number" },
        porchSqm: { type: "number" },
        balconySqm: { type: "number" },
        grannyFlatSqm: { type: "number" },
        bedrooms: { type: "number" },
        bathrooms: { type: "number" },
        garageSpaces: { type: "number" },
    },
    additionalProperties: false,
} as const;

export const updateCostRequirementsArgs = {
    type: "object",
    properties: {
        dropEdgeBeamSurfaceArea: { type: "number" },
        numberOfTrucks: { type: "number" },
        steel: { type: "number" },
        installer: { type: "number" },
        eaves: { type: "number" },
        bricksGroundFloor: { type: "number" },
        bricksFirstFloor: { type: "number" },
        bricksPillar: { type: "number" },
        tieCost: { type: "number" },
        tilesGroundFloor: { type: "number" },
        tilesBathroom: { type: "number" },
        tilesSteps: { type: "number" },
    },
    additionalProperties: false,
} as const;

export const addWorkbookItemArgs = {
    type: "object",
    properties: {
        itemName: { type: "string", description: "The task or phase name." },
        offerTenderLineItem: {
            type: "string",
            description: "How the line reads on the Offer and Tender documents.",
        },
        costExGst: { type: "number", description: "Value excluding GST." },
        tradeOrVendor: { type: "string" },
        includedInContract: { type: "boolean" },
    },
    required: ["itemName"],
    additionalProperties: false,
} as const;

export const updateWorkbookItemArgs = {
    type: "object",
    properties: {
        id: { type: "string", description: "Row id, from get_cost_schedule." },
        itemName: { type: "string" },
        offerTenderLineItem: { type: "string" },
        costExGst: { type: "number" },
        tradeOrVendor: { type: "string" },
        includedInContract: { type: "boolean" },
    },
    required: ["id"],
    additionalProperties: false,
} as const;

export const removeWorkbookItemArgs = {
    type: "object",
    properties: {
        id: { type: "string", description: "Row id, from get_cost_schedule." },
    },
    required: ["id"],
    additionalProperties: false,
} as const;

export const updatePricingInputsArgs = {
    type: "object",
    properties: {
        royalConstructionOverheadPct: {
            type: "number",
            description: "Overhead lever as a fraction: 0.1 is 10%. Must be between 0 and 1.",
        },
        royalConstructionFeePct: {
            type: "number",
            description: "Fee lever as a fraction: 0.1 is 10%. Must be between 0 and 1.",
        },
        hbcfTotalContractValue: {
            type: "number",
            description:
                "Contract value the HBCF premium is derived from. The premium itself is calculated, not set.",
        },
        impactFeeFixed: { type: "number" },
    },
    additionalProperties: false,
} as const;

export const setCustomerPriceArgs = {
    type: "object",
    properties: {
        selectedPrice: {
            type: "number",
            description:
                "The fixed price inc GST actually being offered. Pass 0 to clear it and fall back to the calculated build-up.",
        },
        standardPrice: {
            type: "number",
            description: "The standard price inc GST, for showing a saving.",
        },
        priceAdjustmentLabel: { type: "string" },
        overrideReason: {
            type: "string",
            description:
                "Why the price differs from the calculated build-up. Required whenever selectedPrice differs from it.",
        },
    },
    additionalProperties: false,
} as const;

const scopeItemType = {
    type: "string",
    enum: ["allowance", "exclusion"],
    description: "Which list the item belongs to.",
} as const;

export const addScopeItemArgs = {
    type: "object",
    properties: {
        type: scopeItemType,
        label: { type: "string" },
        description: { type: "string" },
        category: {
            type: "string",
            description: "Scope category. Read the current values from get_offer_section_data.",
        },
        amountType: { type: "string", description: "e.g. fixed, rate_per_sqm, included_note." },
        amount: { type: "number" },
        unit: { type: "string" },
        variationRule: { type: "string" },
        includedInOfferDocument: {
            type: "boolean",
            description: "Whether the item prints on the customer-facing Offer document.",
        },
    },
    required: ["type", "label"],
    additionalProperties: false,
} as const;

export const updateScopeItemArgs = {
    type: "object",
    properties: {
        id: { type: "string", description: "Item id, from get_offer_section_data." },
        type: scopeItemType,
        label: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        amountType: { type: "string" },
        amount: { type: "number" },
        unit: { type: "string" },
        variationRule: { type: "string" },
        includedInOfferDocument: { type: "boolean" },
    },
    required: ["type", "id"],
    additionalProperties: false,
} as const;

export const removeScopeItemArgs = {
    type: "object",
    properties: {
        id: { type: "string", description: "Item id, from get_offer_section_data." },
        type: scopeItemType,
    },
    required: ["type", "id"],
    additionalProperties: false,
} as const;

export const updateOfferDocumentArgs = {
    type: "object",
    properties: {
        headline: { type: "string" },
        introText: { type: "string" },
        inclusionHighlights: { type: "array", items: { type: "string" } },
        exclusionBullets: { type: "array", items: { type: "string" } },
        termsSummary: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const addInclusionItemArgs = {
    type: "object",
    properties: {
        spec: { type: "string", description: "The inclusion line as the customer reads it." },
    },
    required: ["spec"],
    additionalProperties: false,
} as const;

export const updateInclusionItemArgs = {
    type: "object",
    properties: {
        index: {
            type: "number",
            description:
                "Zero-based position in the inclusion schedule, from get_offer_section_data.",
        },
        spec: { type: "string" },
    },
    required: ["index", "spec"],
    additionalProperties: false,
} as const;

export const removeInclusionItemArgs = {
    type: "object",
    properties: {
        index: { type: "number", description: "Zero-based position in the inclusion schedule." },
    },
    required: ["index"],
    additionalProperties: false,
} as const;
