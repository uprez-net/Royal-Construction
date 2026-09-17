"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  hasExplicitStagePercentage,
  paymentStagesFromLabels,
  withStagePercentage,
} from "@/lib/projects/payment-stages";
import { currency } from "@/utils/formatters";
import { fieldElementId } from "@/lib/projects/create-project-errors";
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
  X,
  Plus,
  AlertCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

// Rendered by its own composite control (below the field grid), not by the
// generic array/text primitives — a claim schedule needs label + % + $ per row.
const PAYMENT_STAGES_FIELD = "commercialsAndClaimsPaymentStages";

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
  lotSize: "m²",
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

/** Field key -> message. Shared by the section card, groups and fields. */
export type FieldErrorMap = Readonly<Record<string, string | undefined>>;

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

// `normalizeDateString` now lives in `utils/date.ts` as the single,
// framework-agnostic parser shared by display components and server code.
// Re-exported here so the existing import in `create-project-modal.tsx`
// keeps working without a wide rename.
export { normalizeDateString } from "@/utils/date";

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
  label: React.ReactNode;
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

interface TagRowProps {
  value: string;
  icon?: React.ReactNode;
  onCommit: (newValue: string) => void;
  onRemove: () => void;
}

interface TagListControlProps {
  label: React.ReactNode;
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** Optional leading icon rendered on every row (e.g. a <Check /> for "inclusions"). Omitted by default. */
  icon?: React.ReactNode;
  /** Max height of the scrollable list before it scrolls instead of growing the page. Default "30vh". */
  maxHeight?: string;
}

/* --------------------------------- TagRow --------------------------------- */
/* A single row in the list. Click the text to edit in place. Enter/blur     */
/* commits, Escape cancels, clearing the text removes the row. The ×         */
/* removes without entering edit mode. Text truncates on one line with a     */
/* native title tooltip for the full value.                                  */

function TagRow({
  value,
  icon,
  onCommit,
  onRemove,
}: TagRowProps): React.JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = (): void => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed) {
      onRemove();
    } else if (trimmed !== value) {
      onCommit(trimmed);
    }
  };

  if (editing) {
    return (
      <li className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5">
        {icon}
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setDraft(e.target.value)
          }
          onBlur={commit}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          className="h-5 flex-1 border-none bg-transparent p-0 text-xs font-medium text-foreground shadow-none outline-none focus-visible:ring-0"
        />
      </li>
    );
  }

  return (
    <li className="group inline-flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground">
      {icon}
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="min-w-0 flex-1 cursor-text truncate text-left"
        title={value}
      >
        {value}
      </button>

      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        aria-label={`Remove ${value}`}
      >
        <X className="h-3 w-3" />
      </button>
    </li>
  );
}

/* ---------------------------- TagListControl ----------------------------- */
/*                                                                            *
 * - Rows are the source of truth for editing/removing existing entries.     *
 * - The list itself is height-capped and scrolls (`no-scrollbar`) once it   *
 *   overflows, instead of growing the page indefinitely.                    *
 * - The add-input lives OUTSIDE the scroll region, so it's always reachable *
 *   no matter how long the list gets or where it's scrolled to.             *
 * - Enter (or comma) commits, paste of multi-line/comma text bulk-adds,     *
 *   Backspace on an empty input pops the last row.                         *
 * - A local `draft` string holds in-progress typing so parent re-renders    *
 *   don't fight the caret; `values` itself stays fully controlled via       *
 *   `onChange`.                                                             *
 *                                                                            */

function TagListControl({
  label,
  values,
  onChange,
  icon,
  maxHeight = "30vh",
}: TagListControlProps): React.JSX.Element {
  const [draft, setDraft] = useState<string>("");

  const addFromText = (text: string): void => {
    const parts: string[] = text
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter((v): v is string => v.length > 0);

    if (parts.length === 0) return;

    const next: string[] = [...values];
    for (const part of parts) {
      if (!next.includes(part)) next.push(part);
    }
    onChange(next);
  };

  const commitDraft = (): void => {
    if (!draft.trim()) return;
    addFromText(draft);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData("text");
    if (/[\n,]/.test(text)) {
      e.preventDefault();
      addFromText(text);
    }
  };

  const updateAt = (index: number, newValue: string): void => {
    const next: string[] = [...values];
    // if the edit collides with an existing entry, drop this one instead of duplicating
    if (next.some((v, j) => j !== index && v === newValue)) {
      next.splice(index, 1);
    } else {
      next[index] = newValue;
    }
    onChange(next);
  };

  const removeAt = (index: number): void => {
    const next: string[] = [...values];
    next.splice(index, 1);
    onChange(next);
  };

  const isEmpty = values.length === 0 && draft.trim() === "";

  return (
    <FieldShell label={label} isEmpty={isEmpty}>
      <div className="space-y-2">
        {values.length > 0 && (
          <ul
            className="grid gap-1.5 overflow-y-auto no-scrollbar pr-1 sm:grid-cols-2"
            style={{ maxHeight }}
          >
            {values.map((v: string, i: number) => (
              <TagRow
                key={`${v}-${i}`}
                value={v}
                icon={icon}
                onCommit={(nv: string) => updateAt(i, nv)}
                onRemove={() => removeAt(i)}
              />
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1.5">
          <Plus
            className="h-3 w-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={draft}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setDraft(e.target.value)
            }
            onKeyDown={handleKeyDown}
            onBlur={commitDraft}
            onPaste={handlePaste}
            placeholder={
              values.length === 0 ? "Type and press Enter…" : "Add another…"
            }
            className="h-5 flex-1 border-none bg-transparent p-0 text-xs text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
          />
        </div>
      </div>
    </FieldShell>
  );
}
/* ------------------------- PaymentStagesControl -------------------------- */
/*                                                                            *
 * The claim schedule is stored as one label per stage (e.g. "Slab 15%"), so  *
 * the label is the only editable source of truth: the percent input writes   *
 * its value back into the label, and the amount is derived from the contract *
 * sum exactly the way `projectsWrite` derives it on save. That keeps this    *
 * table a true preview of the stages the project will be created with.       *
 *                                                                            *
 * Editing follows the TagRow idiom above — a local draft committed on        *
 * Enter/blur, clearing the label removes the row — because the extraction    *
 * schema trims and drops blank entries on every parse, so a half-typed row   *
 * held in the parent state would vanish mid-keystroke.                       *
 *                                                                            */

const STAGE_GRID = "grid grid-cols-[1fr_84px_112px_28px] items-center gap-2";

function PaymentStageRow({
  label,
  percentage,
  amount,
  index,
  onCommitLabel,
  onChangePercentage,
  onRemove,
}: {
  label: string;
  percentage: number | null;
  amount: number | null;
  index: number;
  onCommitLabel: (value: string) => void;
  onChangePercentage: (value: number | null) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string>(label);
  const [syncedLabel, setSyncedLabel] = useState<string>(label);

  // Keep the draft in step when the label changes underneath us — a percent
  // edit rewrites it — without clobbering what is being typed right now.
  if (label !== syncedLabel) {
    setSyncedLabel(label);
    setDraft(label);
  }

  const commit = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onRemove();
    } else if (trimmed !== label) {
      onCommitLabel(trimmed);
    }
  };

  const isEstimated = percentage !== null && !hasExplicitStagePercentage(label);

  return (
    <div className={cn(STAGE_GRID, "px-3 py-2")}>
      <Input
        aria-label={`Stage ${index + 1} label`}
        value={draft}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          setDraft(e.target.value)
        }
        onBlur={commit}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(label);
          }
        }}
        className="h-8 rounded-md border-slate-200 bg-white text-sm"
      />

      <div className="relative">
        <Input
          aria-label={`Stage ${index + 1} percent of contract`}
          type="number"
          inputMode="decimal"
          value={displayValue(percentage)}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChangePercentage(parseNumber(e.target.value))
          }
          title={
            isEstimated
              ? "Estimated from the stage name. Type a value to set it explicitly."
              : undefined
          }
          className={cn(
            "h-8 rounded-md border-slate-200 bg-white pr-5 text-sm tabular-nums",
            isEstimated && "text-slate-400",
          )}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400"
        >
          %
        </span>
      </div>

      <p className="truncate text-right text-sm tabular-nums text-slate-500">
        {amount === null ? "—" : currency.format(amount)}
      </p>

      <button
        type="button"
        onClick={onRemove}
        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        aria-label={`Remove stage ${index + 1}`}
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PaymentStagesControl({
  labels,
  totalContractSum,
  onChange,
}: {
  labels: readonly string[];
  totalContractSum: number | null;
  onChange: (labels: string[]) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string>("");

  const stages = paymentStagesFromLabels(labels, totalContractSum);
  const percentTotal = stages.reduce(
    (sum, stage) => sum + (stage.percentage ?? 0),
    0,
  );
  const hasPercentages = stages.some((stage) => stage.percentage !== null);
  const sumsToWhole = Math.round(percentTotal * 100) === 100 * 100;

  const replaceAt = (index: number, label: string): void =>
    onChange(labels.map((current, i) => (i === index ? label : current)));

  const removeAt = (index: number): void =>
    onChange(labels.filter((_, i) => i !== index));

  const commitDraft = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...labels, trimmed]);
    setDraft("");
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Payment Stages
          </p>
          <p className="text-xs text-slate-400">
            The claim schedule in document order. Amounts are calculated from
            the total contract sum.
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 rounded-full border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
        >
          {stages.length} stage{stages.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {stages.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div
            className={cn(
              STAGE_GRID,
              "bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
            )}
          >
            <span>Stage</span>
            <span>Percent</span>
            <span className="text-right">Amount</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="divide-y divide-slate-100">
            {stages.map((stage, index) => (
              <PaymentStageRow
                key={index}
                index={index}
                label={stage.label}
                percentage={stage.percentage}
                amount={stage.amount}
                onCommitLabel={(value: string) => replaceAt(index, value)}
                onChangePercentage={(value: number | null) =>
                  replaceAt(index, withStagePercentage(stage.label, value))
                }
                onRemove={() => removeAt(index)}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-sm text-slate-400">
          No payment stages were extracted. Add the claim schedule below.
        </p>
      )}

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-white px-2.5 py-1.5">
        <Plus className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
        <Input
          value={draft}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setDraft(e.target.value)
          }
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
            if (e.key === "Backspace" && draft === "" && labels.length > 0) {
              onChange(labels.slice(0, -1));
            }
          }}
          onBlur={commitDraft}
          placeholder={
            stages.length === 0
              ? "e.g. Deposit 5% — press Enter"
              : "Add another stage…"
          }
          className="h-6 flex-1 border-none bg-transparent p-0 text-xs text-slate-700 shadow-none outline-none placeholder:text-slate-400 focus-visible:ring-0"
        />
      </div>

      {hasPercentages ? (
        <p
          className={cn(
            "text-right text-xs tabular-nums text-slate-500",
            !sumsToWhole && "text-red-500",
          )}
        >
          Schedule totals {Number(percentTotal.toFixed(2))}%
          {sumsToWhole ? null : " — a complete schedule should sum to 100%."}
        </p>
      ) : null}

      {totalContractSum === null ? (
        <p className="text-right text-xs text-slate-400">
          Set the total contract sum to see stage amounts.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single field renderer
// ---------------------------------------------------------------------------

export function ExtractionField({
  title,
  field,
  value,
  onChange,
  error,
}: {
  title?: string;
  field: string;
  value: unknown;
  onChange: (field: string, value: unknown) => void;
  /** Validation message for this field; renders inline and rings the control. */
  error?: string;
}) {
  const label = title
    ? fieldLabel(removeTitleFromFieldName(title, field))
    : fieldLabel(field);
  const type = resolveFieldType(field);
  const emit = (raw: string) => onChange(field, coerceFieldValue(field, raw));

  return (
    <FieldErrorBoundaryShell field={field} error={error}>
      {renderControl()}
    </FieldErrorBoundaryShell>
  );

  function renderControl() {
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
}

// ---------------------------------------------------------------------------
// Error shell
// ---------------------------------------------------------------------------

/**
 * Wraps any field control with the stable id the wizard scrolls to, the
 * invalid ring, and the inline message. Done at this level rather than inside
 * each control so every field type (text, currency, tag list, boolean) gets
 * identical error affordances for free.
 */
export function FieldErrorBoundaryShell({
  field,
  error,
  children,
}: {
  field: string;
  error?: string;
  children: React.ReactNode;
}) {
  const errorId = `${fieldElementId(field)}-error`;

  return (
    <div
      id={fieldElementId(field)}
      data-field={field}
      data-invalid={error ? "true" : undefined}
      className={cn(
        "scroll-mt-24 rounded-lg transition-shadow",
        error &&
          "bg-destructive-light/40 p-2 -m-2 ring-1 ring-destructive/60 ring-offset-0",
      )}
    >
      <div
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      >
        {children}
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 flex items-start gap-1 text-[11px] font-medium leading-snug text-destructive-ink"
        >
          <AlertCircle className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
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
  errors,
}: {
  title: string;
  heading: string;
  caption: string;
  fields: string[];
  values: ProjectExtractionData;
  onChange: (field: string, value: unknown) => void;
  errors?: FieldErrorMap;
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
            title={title}
            field={field}
            value={values[field as keyof ProjectExtractionData]}
            onChange={onChange}
            error={errors?.[field]}
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
  errors,
}: {
  sectionKey: ProjectExtractionSectionKey;
  title: string;
  description?: string;
  fields: readonly string[];
  values: ProjectExtractionData;
  onChange: (field: string, value: unknown) => void;
  /** Field key -> validation message, from client checks or the server. */
  errors?: FieldErrorMap;
}) {
  const meta = SECTION_META[sectionKey];
  const Icon = meta.icon;
  const filledCount = countFilledFields(values, fields);
  const errorCount = errors
    ? fields.filter((field) => Boolean(errors[field])).length
    : 0;

  const activeGroups = FIELD_GROUPS.filter((group) =>
    group.fields.every((field) => fields.includes(field)),
  );
  const groupedFieldsInSection = new Set(
    activeGroups.flatMap((group) => group.fields),
  );
  const standaloneFields = fields.filter(
    (field) =>
      !groupedFieldsInSection.has(field) && field !== PAYMENT_STAGES_FIELD,
  );
  const hasPaymentStages = fields.includes(PAYMENT_STAGES_FIELD);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-5 shadow-sm",
        errorCount > 0 ? "border-destructive/50" : "border-slate-200",
      )}
    >
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
        <div className="flex shrink-0 items-center gap-2">
          {errorCount > 0 ? (
            <Badge
              variant="outline"
              className="shrink-0 rounded-full border-destructive/40 bg-destructive-light px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive-ink"
            >
              {errorCount} {errorCount === 1 ? "issue" : "issues"}
            </Badge>
          ) : null}
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
            {/* `field` must stay the schema key: it is what onChange emits and
                what resolveFieldType classifies. The section prefix is only
                stripped for the label, inside ExtractionField via `title`. */}
            <ExtractionField
              title={title}
              field={field}
              value={values[field as keyof ProjectExtractionData]}
              onChange={onChange}
              error={errors?.[field]}
            />
          </div>
        ))}
      </div>

      {hasPaymentStages ? (
        <div className="mt-4">
          <FieldErrorBoundaryShell
            field={PAYMENT_STAGES_FIELD}
            error={errors?.[PAYMENT_STAGES_FIELD]}
          >
            <PaymentStagesControl
              labels={values.commercialsAndClaimsPaymentStages ?? []}
              totalContractSum={values.commercialsAndClaimsTotalContractSum}
              onChange={(labels) => onChange(PAYMENT_STAGES_FIELD, labels)}
            />
          </FieldErrorBoundaryShell>
        </div>
      ) : null}

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
              errors={errors}
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
