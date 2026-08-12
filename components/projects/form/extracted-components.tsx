"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  createEmptyProjectExtractionData,
  projectExtractionSchema,
  projectExtractionSections,
  type ProjectExtractionData,
  type ProjectExtractionSectionKey,
} from "@/types/project-extraction";
import {
  FileText,
  ScrollText,
  Landmark,
  Layers,
  ShieldAlert,
  Plug,
  Droplets,
  HardHat,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Section metadata (icon + description) — mirrors the Project Overview tab
// ---------------------------------------------------------------------------

const SECTION_META: Record<
  ProjectExtractionSectionKey,
  { description: string; icon: React.ElementType }
> = {
  projectOverview: {
    description: "Project identity and headline summary",
    icon: FileText,
  },
  legalAdministration: {
    description: "Site details, ownership and sign-off",
    icon: ScrollText,
  },
  commercialsAndClaims: {
    description: "Contract sum, GST and payment schedule",
    icon: Landmark,
  },
  subStructureAndGround: {
    description: "Slab, termite and drainage specification",
    icon: Layers,
  },
  inclusionsAndExclusions: {
    description: "Items included and excluded from the tender scope",
    icon: ShieldAlert,
  },
  utilityInfrastructure: {
    description: "Electrical, gas and comms provisioning",
    icon: Plug,
  },
  wetAreaCompliance: {
    description: "Waterproofing and shower compliance",
    icon: Droplets,
  },
  safetyAndSiteLogistics: {
    description: "Site safety, sediment control and clean-up",
    icon: HardHat,
  },
};

// ---------------------------------------------------------------------------
// Field classification — which control + unit each schema key gets
// ---------------------------------------------------------------------------

const BOOLEAN_FIELDS = new Set(["commercialsAndClaimsGstIncluded"]);

const ARRAY_FIELDS = new Set([
  "legalAdministrationOwnerNames",
  "legalAdministrationOwnerEmails",
  "legalAdministrationOwnerPhones",
  "commercialsAndClaimsPaymentStages",
  "inclusionsAndExclusionsInclusions",
  "inclusionsAndExclusionsExclusions",
]);

const CURRENCY_FIELDS = new Set([
  "commercialsAndClaimsTotalContractSum",
  "commercialsAndClaimsTenderTotalPrice",
  "commercialsAndClaimsContractPrice",
  "commercialsAndClaimsGstAmount",
  "commercialsAndClaimsDepositValue",
  "commercialsAndClaimsClaimStageSlabDollarValue",
  "commercialsAndClaimsVariationAdminFee",
]);

const PERCENT_FIELDS = new Set([
  "commercialsAndClaimsClaimStageSlabPercentage",
  "commercialsAndClaimsLatePenaltyRate",
]);

const NUMBER_UNITS: Record<string, string> = {
  subStructureAndGroundConcreteStrengthMpa: "MPa",
};

const NUMERIC_FIELDS = new Set([
  ...CURRENCY_FIELDS,
  ...PERCENT_FIELDS,
  ...Object.keys(NUMBER_UNITS),
  "wetAreaComplianceTiledNicheCount",
  "wetAreaComplianceShowerCount",
]);

const LARGE_TEXT_FIELDS = new Set([
  "summary",
  "legalAdministrationSiteAddress",
]);

const SPAN_TWO_FIELDS = new Set(["summary", "legalAdministrationSiteAddress"]);

type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "percent"
  | "boolean"
  | "array";

function resolveFieldType(field: string): FieldType {
  if (BOOLEAN_FIELDS.has(field)) return "boolean";
  if (ARRAY_FIELDS.has(field)) return "array";
  if (CURRENCY_FIELDS.has(field)) return "currency";
  if (PERCENT_FIELDS.has(field)) return "percent";
  if (NUMERIC_FIELDS.has(field)) return "number";
  if (LARGE_TEXT_FIELDS.has(field)) return "textarea";
  return "text";
}

// Grouped array fields render together as a single composite panel, rather
// than as three/two separate boxes scattered through the grid.
const FIELD_GROUPS: {
  id: string;
  heading: string;
  caption: string;
  fields: string[];
}[] = [
  {
    id: "ownerContacts",
    heading: "Owner Contacts",
    caption: "Names, emails and phone numbers on file for the owner",
    fields: [
      "legalAdministrationOwnerNames",
      "legalAdministrationOwnerEmails",
      "legalAdministrationOwnerPhones",
    ],
  },
  {
    id: "inclusionsExclusions",
    heading: "Inclusions & Exclusions",
    caption: "Items included versus excluded from the tender scope",
    fields: [
      "inclusionsAndExclusionsInclusions",
      "inclusionsAndExclusionsExclusions",
    ],
  },
];

// const GROUPED_FIELD_SET = new Set(FIELD_GROUPS.flatMap((group) => group.fields));

// ---------------------------------------------------------------------------
// Label formatting
// ---------------------------------------------------------------------------

function fieldLabel(field: string) {
  const spaced = field.replace(/([A-Z])/g, " $1").trim();
  const titled = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  return titled
    .replace(/\bGst\b/g, "GST")
    .replace(/\bPca\b/g, "PCA")
    .replace(/\bAc\b/g, "AC")
    .replace(/\bKw\b/g, "kW")
    .replace(/\bMpa\b/g, "MPa")
    .replace(/\bM2\b/g, "m²");
}

const removeTitleFromFieldName = (title: string, fieldName: string) => {
  const titlePrefix = title
    .replace(/\s+and\s+/gi, " ") // handles "Legal and Administration" -> legalAdministration
    .split(" ")
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("");

  const titlePrefixWithAnd = title
    .split(" ")
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("");

  return fieldName.replace(
    new RegExp(`^(${titlePrefix}|${titlePrefixWithAnd})`),
    "",
  );
};

// ---------------------------------------------------------------------------
// Value coercion helpers
// ---------------------------------------------------------------------------

export function normalizeString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

/**
 * Normalizes a date string to YYYY-MM-DD.
 *
 * Supported formats:
 * - 2026-06-12
 * - 12/06/2026
 * - 12-06-2026
 * - 12.06.2026
 * - 12 June 2026
 * - 12th June 2026
 * - June 12, 2026
 * - June 12th, 2026
 * - 12th Day of June 2026
 * - 12th day of June, 2026
 * - the 12th day of June, 2026
 * - Signed this 12th day of June 2026
 * - Signed this 15 day of June 20 26
 * - 15 June 20 26
 *
 * Returns null if a valid date cannot be extracted.
 */
export function normalizeDateString(input: string): string | null {
  if (!input) return null;

  let text = input.trim();

  // Normalize whitespace
  text = text.replace(/\s+/g, " ");

  // Remove ordinal suffixes (12th -> 12)
  text = text.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");

  // OCR sometimes splits years:
  // 20 26 -> 2026
  // 19 98 -> 1998
  text = text.replace(/\b(19|20)\s+(\d{2})\b/g, "$1$2");

  // Remove commas
  text = text.replace(/,/g, "");

  // Remove periods after abbreviated months (Jun. -> Jun)
  text = text.replace(
    /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\./gi,
    "$1",
  );

  const monthMap: Record<string, number> = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };

  const format = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return date.toISOString().slice(0, 10);
  };

  let m: RegExpMatchArray | null;

  // YYYY-MM-DD
  m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return format(+m[1], +m[2], +m[3]);

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  m = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (m) return format(+m[3], +m[2], +m[1]);

  // Month Day Year
  // June 15 2026
  m = text.match(/\b([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\b/i);
  if (m) {
    const month = monthMap[m[1].toLowerCase()];
    if (month) return format(+m[3], month, +m[2]);
  }

  // Day Month Year
  // 15 June 2026
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/i);
  if (m) {
    const month = monthMap[m[2].toLowerCase()];
    if (month) return format(+m[3], month, +m[1]);
  }

  // Contract/legal language
  // 15 day of June 2026
  // 15 Day of June 2026
  // the 15 day of June 2026
  // Signed this 15 day of June 2026
  // Executed this 15 day of June 2026
  m = text.match(
    /\b(?:the\s+)?(?:(?:signed|executed|dated)\s+this\s+)?(\d{1,2})\s*(?:day\s+of\s+)?([A-Za-z]+)\s+(\d{4})\b/i,
  );

  if (m) {
    const month = monthMap[m[2].toLowerCase()];
    if (month) return format(+m[3], month, +m[1]);
  }

  // Extremely forgiving fallback
  const parsed = new Date(text);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceFieldValue(field: string, rawValue: string) {
  const type = resolveFieldType(field);
  if (type === "array") {
    return rawValue
      .split(/\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (type === "boolean") {
    if (!rawValue.trim()) return null;
    return rawValue === "true";
  }
  if (type === "number" || type === "currency" || type === "percent") {
    return parseNumber(rawValue);
  }
  return rawValue;
}

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

function FieldShell({
  label,
  unit,
  isEmpty,
  children,
}: {
  label: string;
  unit?: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wide text-slate-500",
          isEmpty && "text-red-500",
        )}
      >
        {label}
        {unit ? (
          <span className="ml-1 font-normal normal-case text-slate-400">
            ({unit})
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function TextControl({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <FieldShell
      label={label}
      isEmpty={
        value === null || value === undefined || String(value).trim() === ""
      }
    >
      {multiline ? (
        <Textarea
          value={displayValue(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Not specified"
          className="min-h-20 resize-none rounded-lg border-slate-200 bg-white text-sm"
        />
      ) : (
        <Input
          value={displayValue(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Not specified"
          className="h-9 rounded-lg border-slate-200 bg-white text-sm"
        />
      )}
    </FieldShell>
  );
}

function NumberControl({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  unit?: string;
}) {
  return (
    <FieldShell
      label={label}
      unit={unit}
      isEmpty={
        value === null || value === undefined || String(value).trim() === ""
      }
    >
      <Input
        type="number"
        value={displayValue(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="h-9 rounded-lg border-slate-200 bg-white text-sm"
      />
    </FieldShell>
  );
}

function CurrencyControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell
      label={label}
      isEmpty={
        value === null || value === undefined || String(value).trim() === ""
      }
    >
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
          $
        </span>
        <Input
          type="number"
          value={displayValue(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className="h-9 rounded-lg border-slate-200 bg-white pl-6 text-sm"
        />
      </div>
    </FieldShell>
  );
}

function PercentControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell
      label={label}
      isEmpty={
        value === null || value === undefined || String(value).trim() === ""
      }
    >
      <div className="relative">
        <Input
          type="number"
          value={displayValue(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="h-9 rounded-lg border-slate-200 bg-white pr-7 text-sm"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
          %
        </span>
      </div>
    </FieldShell>
  );
}

function BooleanControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
}) {
  const current = value === true ? "true" : value === false ? "false" : "";
  return (
    <FieldShell
      label={label}
      isEmpty={
        value === null || value === undefined || String(value).trim() === ""
      }
    >
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
      >
        <option value="">Unknown</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </FieldShell>
  );
}

function TagListControl({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <FieldShell
      label={label}
      isEmpty={values.length === 0 || values.every((v) => v.trim() === "")}
    >
      <Textarea
        value={values.join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
          )
        }
        placeholder="One per line"
        className="min-h-16 resize-none rounded-lg border-slate-200 bg-white text-sm"
      />
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {values.map((entry, i) => (
            <Badge
              key={`${label}-${i}`}
              variant="outline"
              className="rounded-full border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-normal text-slate-600"
            >
              {entry}
            </Badge>
          ))}
        </div>
      ) : null}
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Single field renderer
// ---------------------------------------------------------------------------

export function ExtractionField({
  field,
  value,
  onChange,
}: {
  field: string;
  value: unknown;
  onChange: (field: string, value: unknown) => void;
}) {
  const label = fieldLabel(field);
  const type = resolveFieldType(field);
  const emit = (raw: string) => onChange(field, coerceFieldValue(field, raw));

  switch (type) {
    case "currency":
      return <CurrencyControl label={label} value={value} onChange={emit} />;
    case "percent":
      return <PercentControl label={label} value={value} onChange={emit} />;
    case "number":
      return (
        <NumberControl
          label={label}
          value={value}
          onChange={emit}
          unit={NUMBER_UNITS[field]}
        />
      );
    case "boolean":
      return <BooleanControl label={label} value={value} onChange={emit} />;
    case "array":
      return (
        <TagListControl
          label={label}
          values={Array.isArray(value) ? (value as string[]) : []}
          onChange={(values) => onChange(field, values)}
        />
      );
    case "textarea":
      return (
        <TextControl label={label} value={value} onChange={emit} multiline />
      );
    default:
      return <TextControl label={label} value={value} onChange={emit} />;
  }
}

// ---------------------------------------------------------------------------
// Grouped composite panel (owner contacts / risk allocation)
// ---------------------------------------------------------------------------

function FieldGroupPanel({
  title,
  heading,
  caption,
  fields,
  values,
  onChange,
}: {
  title: string;
  heading: string;
  caption: string;
  fields: string[];
  values: ProjectExtractionData;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {heading}
        </p>
        <p className="text-xs text-slate-400">{caption}</p>
      </div>
      <div
        className={cn(
          "grid gap-4",
          fields.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2",
        )}
      >
        {fields.map((field) => (
          <ExtractionField
            key={field}
            field={removeTitleFromFieldName(title, field)}
            value={values[field as keyof ProjectExtractionData]}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function countFilledFields(
  values: ProjectExtractionData,
  fields: readonly string[],
) {
  return fields.reduce((count, field) => {
    const value = values[field as keyof ProjectExtractionData];
    const isFilled = Array.isArray(value)
      ? value.length > 0
      : typeof value === "number"
        ? Number.isFinite(value)
        : typeof value === "string"
          ? value.trim().length > 0
          : value !== null && value !== undefined;
    return isFilled ? count + 1 : count;
  }, 0);
}

export function ExtractionSectionCard({
  sectionKey,
  title,
  description,
  fields,
  values,
  onChange,
}: {
  sectionKey: ProjectExtractionSectionKey;
  title: string;
  description?: string;
  fields: readonly string[];
  values: ProjectExtractionData;
  onChange: (field: string, value: unknown) => void;
}) {
  const meta = SECTION_META[sectionKey];
  const Icon = meta.icon;
  const filledCount = countFilledFields(values, fields);

  const activeGroups = FIELD_GROUPS.filter((group) =>
    group.fields.every((field) => fields.includes(field)),
  );
  const groupedFieldsInSection = new Set(
    activeGroups.flatMap((group) => group.fields),
  );
  const standaloneFields = fields.filter(
    (field) => !groupedFieldsInSection.has(field),
  );

  console.log("Standalone fields:", standaloneFields);
  console.log("Active groups:", activeGroups);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-700">{title}</p>
            <p className="text-xs text-slate-400">
              {description ?? meta.description}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-full border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            filledCount === fields.length && fields.length > 0
              ? "border-teal-200 bg-teal-50 text-teal-700"
              : "text-slate-500",
          )}
        >
          {filledCount}/{fields.length} filled
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {standaloneFields.map((field) => (
          <div
            key={field}
            className={
              SPAN_TWO_FIELDS.has(field)
                ? "md:col-span-2 xl:col-span-2"
                : undefined
            }
          >
            <ExtractionField
              field={removeTitleFromFieldName(title, field)}
              value={values[field as keyof ProjectExtractionData]}
              onChange={onChange}
            />
          </div>
        ))}
      </div>

      {activeGroups.length > 0 ? (
        <div className="mt-4 space-y-3">
          {activeGroups.map((group) => (
            <FieldGroupPanel
              key={group.id}
              title={title}
              heading={group.heading}
              caption={group.caption}
              fields={group.fields}
              values={values}
              onChange={onChange}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// State helpers (unchanged behaviour, kept for compatibility)
// ---------------------------------------------------------------------------

export function emptyExtractionState(): ProjectExtractionData {
  return createEmptyProjectExtractionData();
}

export function sectionFields(sectionKey: ProjectExtractionSectionKey) {
  return (
    projectExtractionSections.find((section) => section.key === sectionKey)
      ?.fields ?? []
  );
}

export function updateExtractionField(
  current: ProjectExtractionData,
  field: keyof ProjectExtractionData,
  value: unknown,
): ProjectExtractionData {
  return projectExtractionSchema.parse({
    ...current,
    [field]: value,
  } as never);
}
