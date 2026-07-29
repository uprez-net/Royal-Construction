import { z } from "zod";
import type { ContractTabValue } from "@/lib/docusign/contract-envelope";

// ── Contract particulars (issue #98) ────────────────────────────────────────
// The BC4 contract is an MBA template whose builder used to fill a set of
// unlocked fields *during* their signing session (contract-template-spec.md:60).
// To route the contract to the customer first (matching the tender, issue #89),
// those particulars must be captured in-app BEFORE the envelope is created and
// sent as locked tabs — otherwise the customer would sign a contract with the
// builder's fields still blank.
//
// The keys here are 1:1 with the template's unlocked tab labels, so a filled
// field maps to a locked text tab of the same name with no translation layer.
export type ContractParticulars = {
  readonly ownerAddress: string;
  readonly ownerPhone: string;
  readonly ownerMobile: string;
  readonly commencementDate: string;
  readonly constructionDays: string;
  readonly hbcfCost: string;
  readonly interestRate: string;
  readonly paymentDays: string;
  readonly preContractCosts: string;
  readonly lendingAuthority: string;
  readonly fundingOwner: string;
  readonly demolitionMaterials: string;
  readonly specialConditions: string;
};

export type ContractParticularKey = keyof ContractParticulars;

export const EMPTY_CONTRACT_PARTICULARS: ContractParticulars = {
  ownerAddress: "",
  ownerPhone: "",
  ownerMobile: "",
  commencementDate: "",
  constructionDays: "",
  hbcfCost: "",
  interestRate: "",
  paymentDays: "",
  preContractCosts: "",
  lendingAuthority: "",
  fundingOwner: "",
  demolitionMaterials: "",
  specialConditions: "",
};

export const CONTRACT_PARTICULAR_MAX_LENGTH = 10_000;
export const CONTRACT_PARTICULAR_TOTAL_MAX_LENGTH = 50_000;

type ContractParticularDefaultSource = {
  readonly currentLocation: string;
  readonly ownerPhone: string;
  readonly hbcfPremium: number;
};

const DERIVED_CONTRACT_PARTICULAR_KEYS = [
  "ownerAddress",
  "ownerPhone",
  "hbcfCost",
] as const satisfies readonly ContractParticularKey[];

const MANUAL_OVERRIDES_KEY = "_manualOverrides";

const AUD_CURRENCY_WITH_CENTS = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function deriveContractParticularDefaults({
  currentLocation,
  ownerPhone,
  hbcfPremium,
}: ContractParticularDefaultSource): ContractParticulars {
  return {
    ...EMPTY_CONTRACT_PARTICULARS,
    ownerAddress: currentLocation.trim(),
    ownerPhone: ownerPhone.trim(),
    hbcfCost:
      Number.isFinite(hbcfPremium) && hbcfPremium > 0
        ? AUD_CURRENCY_WITH_CENTS.format(hbcfPremium)
        : "",
  };
}

export function reconcileContractParticularDefaults(
  particulars: ContractParticulars,
  nextDefaults: ContractParticulars,
  manualOverrides: readonly ContractParticularKey[],
): ContractParticulars {
  const overridden = new Set(manualOverrides);
  let next = particulars;
  for (const key of DERIVED_CONTRACT_PARTICULAR_KEYS) {
    const hasManualValue =
      overridden.has(key) && particulars[key].trim().length > 0;
    if (!hasManualValue && particulars[key] !== nextDefaults[key]) {
      next = { ...next, [key]: nextDefaults[key] };
    }
  }
  return next;
}

export type ContractParticularGroup =
  | "owner"
  | "timing"
  | "financial"
  | "funding"
  | "terms";

export type ContractParticularField = {
  readonly key: ContractParticularKey;
  readonly label: string;
  readonly hint: string;
  readonly group: ContractParticularGroup;
  // Rendered as a multi-line textarea rather than a single-line input.
  readonly multiline?: boolean;
  // Recommended before send: legal/financial or timing values that read as
  // broken if the customer receives them blank. Never a hard block — a blank
  // one simply stays an unlocked template tab for the builder to complete
  // (see contractParticularsToLockedTabs). Surfaced as a soft advisory.
  readonly recommendedBeforeSend?: boolean;
};

// Order here is the render order in the particulars form. Grouped for the UI;
// the `group` label copy lives in the component.
export const CONTRACT_PARTICULAR_FIELDS: readonly ContractParticularField[] = [
  {
    key: "ownerAddress",
    label: "Owner postal address",
    hint: "The owner's contact/postal address for the contract cover.",
    group: "owner",
  },
  {
    key: "ownerPhone",
    label: "Owner phone",
    hint: "Owner contact phone.",
    group: "owner",
  },
  {
    key: "ownerMobile",
    label: "Owner mobile",
    hint: "Owner contact mobile.",
    group: "owner",
  },
  {
    key: "commencementDate",
    label: "Commencement date",
    hint: "When construction is scheduled to start.",
    group: "timing",
    recommendedBeforeSend: true,
  },
  {
    key: "constructionDays",
    label: "Construction period (days)",
    hint: "Working days allowed for the build (excludes the days listed as excluded).",
    group: "timing",
    recommendedBeforeSend: true,
  },
  {
    key: "hbcfCost",
    label: "HBCF premium",
    hint: "Auto-populated from the HBCF premium in Pricing; editable for this contract.",
    group: "financial",
    recommendedBeforeSend: true,
  },
  {
    key: "interestRate",
    label: "Interest rate on overdue amounts",
    hint: "Contract interest rate (e.g. \"10% p.a.\") — entered per job by the estimator.",
    group: "financial",
    recommendedBeforeSend: true,
  },
  {
    key: "paymentDays",
    label: "Payment terms (days)",
    hint: "Days the owner has to pay a progress claim — entered per job by the estimator.",
    group: "financial",
    recommendedBeforeSend: true,
  },
  {
    key: "preContractCosts",
    label: "Pre-contract costs",
    hint: "Any pre-contract / preliminary costs to record on the contract.",
    group: "financial",
  },
  {
    key: "lendingAuthority",
    label: "Lending authority",
    hint: "The owner's lender / financier, if the build is financed.",
    group: "funding",
  },
  {
    key: "fundingOwner",
    label: "Funding owner",
    hint: "Who is funding the works (owner-funded, or the financing party).",
    group: "funding",
  },
  {
    key: "demolitionMaterials",
    label: "Demolition materials",
    hint: "Materials to be demolished/removed, if any.",
    group: "terms",
  },
  {
    key: "specialConditions",
    label: "Special conditions",
    hint: "Any special conditions to append to the standard BC4 terms.",
    group: "terms",
    multiline: true,
  },
];

// Every particular is an optional free-text string. Unknown keys are dropped and
// missing keys default to "", so an older/partial persisted blob still parses.
export const contractParticularsSchema = z
  .object({
    ownerAddress: z.string().default(""),
    ownerPhone: z.string().default(""),
    ownerMobile: z.string().default(""),
    commencementDate: z.string().default(""),
    constructionDays: z.string().default(""),
    hbcfCost: z.string().default(""),
    interestRate: z.string().default(""),
    paymentDays: z.string().default(""),
    preContractCosts: z.string().default(""),
    lendingAuthority: z.string().default(""),
    fundingOwner: z.string().default(""),
    demolitionMaterials: z.string().default(""),
    specialConditions: z.string().default(""),
  })
  .strip();

// Parse a persisted JSON blob into ContractParticulars, tolerating null/garbage
// (an offer that never had particulars saved) by returning the empty set.
export function parseContractParticulars(raw: unknown): ContractParticulars {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return EMPTY_CONTRACT_PARTICULARS;
  }
  const result = contractParticularsSchema.safeParse(raw);
  return result.success ? result.data : EMPTY_CONTRACT_PARTICULARS;
}

function isContractParticularKey(
  value: unknown,
): value is ContractParticularKey {
  return (
    typeof value === "string" &&
    CONTRACT_PARTICULAR_FIELDS.some((field) => field.key === value)
  );
}

export function parseContractParticularOverrides(
  raw: unknown,
): readonly ContractParticularKey[] {
  if (typeof raw !== "object" || raw === null) {
    return [];
  }
  const stored = (raw as Record<string, unknown>)[MANUAL_OVERRIDES_KEY];
  if (Array.isArray(stored)) {
    const particulars = parseContractParticulars(raw);
    return [
      ...new Set(
        stored.filter(
          (key): key is ContractParticularKey =>
            isContractParticularKey(key) &&
            particulars[key].trim().length > 0,
        ),
      ),
    ];
  }
  const particulars = parseContractParticulars(raw);
  return DERIVED_CONTRACT_PARTICULAR_KEYS.filter(
    (key) => particulars[key].trim().length > 0,
  );
}

// Normalize for persistence: trim every value. Keeps the stored blob canonical
// so a whitespace-only entry counts as blank everywhere downstream.
export function normalizeContractParticulars(
  particulars: ContractParticulars,
): ContractParticulars {
  const out = { ...EMPTY_CONTRACT_PARTICULARS } as Record<string, string>;
  const source =
    particulars && typeof particulars === "object"
      ? (particulars as unknown as Record<string, unknown>)
      : {};
  for (const field of CONTRACT_PARTICULAR_FIELDS) {
    const value = source[field.key];
    out[field.key] = typeof value === "string" ? value.trim() : "";
  }
  return out as unknown as ContractParticulars;
}

export function serializeContractParticulars(
  particulars: ContractParticulars,
  manualOverrides: readonly ContractParticularKey[],
): Record<string, unknown> {
  const normalized = normalizeContractParticulars(particulars);
  const overrides = Array.isArray(manualOverrides)
    ? manualOverrides.slice(0, CONTRACT_PARTICULAR_FIELDS.length)
    : [];
  return {
    ...normalized,
    [MANUAL_OVERRIDES_KEY]: [
      ...new Set(
        overrides.filter(
          (key) =>
            isContractParticularKey(key) &&
            normalized[key].length > 0,
        ),
      ),
    ],
  };
}

// Only FILLED particulars become locked tabs. A blank field is intentionally
// omitted so it stays the template's own unlocked tab — the builder (who now
// counter-signs at routingOrder 2) can still complete anything the estimator
// left blank, rather than the customer receiving a permanently-empty locked box.
export function contractParticularsToLockedTabs(
  particulars: ContractParticulars,
): ContractTabValue[] {
  const normalized = normalizeContractParticulars(particulars);
  const tabs: ContractTabValue[] = [];
  for (const field of CONTRACT_PARTICULAR_FIELDS) {
    const value = normalized[field.key];
    if (value.length > 0) {
      tabs.push({ tabLabel: field.key, value, locked: true });
    }
  }
  return tabs;
}

// The recommended (legal/financial/timing) fields still blank — surfaced to the
// operator as a soft pre-send advisory. Never blocks the send.
export function missingRecommendedParticulars(
  particulars: ContractParticulars,
): readonly ContractParticularField[] {
  const normalized = normalizeContractParticulars(particulars);
  return CONTRACT_PARTICULAR_FIELDS.filter(
    (field) => field.recommendedBeforeSend && normalized[field.key].length === 0,
  );
}
