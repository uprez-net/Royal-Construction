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
  Building2,
  Fan,
  Paintbrush,
  ShieldAlert,
  Plug,
  Droplets,
  HardHat,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Section metadata (icon + description) — mirrors the Project Overview tab
// ---------------------------------------------------------------------------

const SECTION_META: Record<ProjectExtractionSectionKey, { description: string; icon: React.ElementType }> = {
  projectOverview: { description: "Project identity and headline summary", icon: FileText },
  legalAdministration: { description: "Site details, ownership and sign-off", icon: ScrollText },
  commercialsAndClaims: { description: "Contract sum, GST and payment schedule", icon: Landmark },
  subStructureAndGround: { description: "Slab, termite and drainage specification", icon: Layers },
  shellAndExternal: { description: "Ceilings, roofing, brick and window allowances", icon: Building2 },
  mechanicalDetails: { description: "Air conditioning, lighting and power", icon: Fan },
  internalFitOutAndFinishes: { description: "Doors, stone, tiles and tapware", icon: Paintbrush },
  exclusionsAndRisks: { description: "Items excluded, owner risk and variation triggers", icon: ShieldAlert },
  utilityInfrastructure: { description: "Electrical, gas and comms provisioning", icon: Plug },
  wetAreaCompliance: { description: "Waterproofing and shower compliance", icon: Droplets },
  safetyAndSiteLogistics: { description: "Site safety, sediment control and clean-up", icon: HardHat },
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
  "exclusionsAndRisksOwnerResponsibility",
  "exclusionsAndRisksVariationRequired",
]);

const CURRENCY_FIELDS = new Set([
  "commercialsAndClaimsTotalContractSum",
  "commercialsAndClaimsTenderTotalPrice",
  "commercialsAndClaimsContractPrice",
  "commercialsAndClaimsGstAmount",
  "commercialsAndClaimsDepositValue",
  "commercialsAndClaimsClaimStageSlabDollarValue",
  "commercialsAndClaimsVariationAdminFee",
  "shellAndExternalBrickAllowance",
  "shellAndExternalSelectedBrickPrice",
  "internalFitOutAndFinishesTileAllowance",
  "internalFitOutAndFinishesSelectedTilePrice",
]);

const PERCENT_FIELDS = new Set([
  "commercialsAndClaimsClaimStageSlabPercentage",
  "commercialsAndClaimsLatePenaltyRate",
]);

const NUMBER_UNITS: Record<string, string> = {
  subStructureAndGroundConcreteStrengthMpa: "MPa",
  shellAndExternalFloorAreaM2: "m²",
  mechanicalDetailsAcRequiredCapacityKw: "kW",
  mechanicalDetailsAcInstalledCapacityKw: "kW",
  internalFitOutAndFinishesWetAreaSizeM2: "m²",
};

const NUMERIC_FIELDS = new Set([
  ...CURRENCY_FIELDS,
  ...PERCENT_FIELDS,
  ...Object.keys(NUMBER_UNITS),
  "shellAndExternalBrickCount",
  "mechanicalDetailsLightingCount",
  "mechanicalDetailsTenderLightingCount",
  "mechanicalDetailsPowerPointCount",
  "wetAreaComplianceTiledNicheCount",
  "wetAreaComplianceShowerCount",
]);

const LARGE_TEXT_FIELDS = new Set(["summary", "legalAdministrationSiteAddress"]);

const SPAN_TWO_FIELDS = new Set(["summary", "legalAdministrationSiteAddress"]);

type FieldType = "text" | "textarea" | "number" | "currency" | "percent" | "boolean" | "array";

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
const FIELD_GROUPS: { id: string; heading: string; caption: string; fields: string[] }[] = [
  {
    id: "ownerContacts",
    heading: "Owner Contacts",
    caption: "Names, emails and phone numbers on file for the owner",
    fields: ["legalAdministrationOwnerNames", "legalAdministrationOwnerEmails", "legalAdministrationOwnerPhones"],
  },
  {
    id: "riskAllocation",
    heading: "Risk Allocation",
    caption: "Items flagged as owner responsibility versus variation triggers",
    fields: ["exclusionsAndRisksOwnerResponsibility", "exclusionsAndRisksVariationRequired"],
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
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join("");

  const titlePrefixWithAnd = title
    .split(" ")
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join("");

  return fieldName
    .replace(new RegExp(`^(${titlePrefix}|${titlePrefixWithAnd})`), "");
};

// ---------------------------------------------------------------------------
// Value coercion helpers
// ---------------------------------------------------------------------------

export function normalizeString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
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

function FieldShell({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {unit ? <span className="ml-1 font-normal normal-case text-slate-400">({unit})</span> : null}
      </label>
      {children}
    </div>
  );
}

function TextControl({ label, value, onChange, multiline }: { label: string; value: unknown; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <FieldShell label={label}>
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

function NumberControl({ label, value, onChange, unit }: { label: string; value: unknown; onChange: (v: string) => void; unit?: string }) {
  return (
    <FieldShell label={label} unit={unit}>
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

function CurrencyControl({ label, value, onChange }: { label: string; value: unknown; onChange: (v: string) => void }) {
  return (
    <FieldShell label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
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

function PercentControl({ label, value, onChange }: { label: string; value: unknown; onChange: (v: string) => void }) {
  return (
    <FieldShell label={label}>
      <div className="relative">
        <Input
          type="number"
          value={displayValue(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="h-9 rounded-lg border-slate-200 bg-white pr-7 text-sm"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
      </div>
    </FieldShell>
  );
}

function BooleanControl({ label, value, onChange }: { label: string; value: unknown; onChange: (v: string) => void }) {
  const current = value === true ? "true" : value === false ? "false" : "";
  return (
    <FieldShell label={label}>
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

function TagListControl({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return (
    <FieldShell label={label}>
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
      return <NumberControl label={label} value={value} onChange={emit} unit={NUMBER_UNITS[field]} />;
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
      return <TextControl label={label} value={value} onChange={emit} multiline />;
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
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</p>
        <p className="text-xs text-slate-400">{caption}</p>
      </div>
      <div className={cn("grid gap-4", fields.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {fields.map((field) => (
          <ExtractionField key={field} field={removeTitleFromFieldName(title, field)} value={values[field as keyof ProjectExtractionData]} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function countFilledFields(values: ProjectExtractionData, fields: readonly string[]) {
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

  const activeGroups = FIELD_GROUPS.filter((group) => group.fields.every((field) => fields.includes(field)));
  const groupedFieldsInSection = new Set(activeGroups.flatMap((group) => group.fields));
  const standaloneFields = fields.filter((field) => !groupedFieldsInSection.has(field));

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
            <p className="text-xs text-slate-400">{description ?? meta.description}</p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-full border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            filledCount === fields.length && fields.length > 0 ? "border-teal-200 bg-teal-50 text-teal-700" : "text-slate-500",
          )}
        >
          {filledCount}/{fields.length} filled
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {standaloneFields.map((field) => (
          <div key={field} className={SPAN_TWO_FIELDS.has(field) ? "md:col-span-2 xl:col-span-2" : undefined}>
            <ExtractionField field={removeTitleFromFieldName(title, field)} value={values[field as keyof ProjectExtractionData]} onChange={onChange} />
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
  return projectExtractionSections.find((section) => section.key === sectionKey)?.fields ?? [];
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