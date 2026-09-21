"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProjectDetail } from "@/types/project";
import { ComplianceDocumentType, type File as DBFile } from "@prisma/client";
import type {
  ProjectRequirementsPayload,
  ProjectFlowSectionKey,
  ProjectPaymentStage,
  ProjectSourceDocumentReference,
  ProjectValidationResult,
  ProjectConflictResult,
} from "@/types/project-flow";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/utils/fetch";
import { formatValue, toLabel } from "@/utils/formatters";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  Info,
  CircleAlert,
  FileText,
  ExternalLink,
  Plus,
  X,
  ScrollText,
  Landmark,
  Layers,
  ShieldAlert,
  Plug,
  Droplets,
  HardHat,
  Check,
  Loader2,
} from "lucide-react";
import { UploadButton } from "@/components/common/upload-button";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  setActiveProject,
  uploadComplianceDocument,
} from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import { useParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

type RequirementsData = Partial<ProjectRequirementsPayload>;

type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "percent"
  | "boolean"
  | "date";

interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  span?: 1 | 2;
}

const SECTION_META: Record<
  ProjectFlowSectionKey,
  {
    label: string;
    description: string;
    icon: React.ElementType;
    isAdminOnly?: boolean;
  }
> = {
  legalAdministration: {
    label: "Legal and administration",
    description: "Site details, ownership and sign-off",
    icon: ScrollText,
  },
  commercialsAndClaims: {
    label: "Commercials and claims",
    description: "Contract sum, GST and payment schedule",
    icon: Landmark,
    isAdminOnly: true,
  },
  subStructureAndGround: {
    label: "Sub structure and ground",
    description: "Slab, termite and drainage specification",
    icon: Layers,
  },
  inclusionsAndExclusions: {
    label: "Inclusions and Exclusions",
    description: "Items included and excluded from the tender scope",
    icon: ShieldAlert,
  },
  utilityInfrastructure: {
    label: "Utility infrastructure",
    description: "Electrical, gas and comms provisioning",
    icon: Plug,
  },
  wetAreaCompliance: {
    label: "Wet area compliance",
    description: "Waterproofing and shower compliance",
    icon: Droplets,
  },
  safetyAndSiteLogistics: {
    label: "Safety and site logistics",
    description: "Site safety, sediment control and clean-up",
    icon: HardHat,
  },
};

const SECTION_FIELDS: Record<ProjectFlowSectionKey, FieldConfig[]> = {
  legalAdministration: [
    { key: "siteAddress", label: "Site address", type: "textarea", span: 2 },
    { key: "commencementTrigger", label: "Commencement trigger", type: "text" },
    { key: "signedDate", label: "Signed (contract executed)", type: "text" },
    { key: "pcaInspector", label: "PCA inspector", type: "text" },
    // Captured when the first Slab-stage milestone starts, and editable here
    // afterwards through the same PATCH that the kickoff prompt uses.
    {
      key: "insuranceClaimStartDate",
      label: "Insurance Claim Start Date",
      type: "date",
    },
    {
      key: "insuranceClaimEndDate",
      label: "Insurance Claim End Date",
      type: "date",
    },
  ],
  commercialsAndClaims: [
    { key: "totalContractSum", label: "Total contract sum", type: "currency" },
    { key: "gstIncluded", label: "GST included", type: "boolean" },
    { key: "gstAmount", label: "GST amount", type: "currency" },
    { key: "depositValue", label: "Deposit value", type: "currency" },
    {
      key: "claimStageSlabPercentage",
      label: "Slab claim stage",
      type: "percent",
    },
    {
      key: "claimStageSlabDollarValue",
      label: "Slab claim value",
      type: "currency",
    },
    {
      key: "variationAdminFee",
      label: "Variation admin fee",
      type: "currency",
    },
    { key: "latePenaltyRate", label: "Late penalty rate", type: "percent" },
  ],
  subStructureAndGround: [
    { key: "concreteSlabClass", label: "Concrete slab class", type: "text" },
    {
      key: "concreteStrengthMpa",
      label: "Concrete strength",
      type: "number",
      unit: "MPa",
    },
    { key: "vapourBarrier", label: "Vapour barrier", type: "text" },
    { key: "termiteSystem", label: "Termite system", type: "text" },
    { key: "sewerConnection", label: "Sewer connection", type: "text" },
  ],
  inclusionsAndExclusions: [],
  utilityInfrastructure: [
    { key: "electricalPhase", label: "Electrical phase", type: "text" },
    {
      key: "communicationConduit",
      label: "Communication conduit",
      type: "text",
    },
    { key: "gasConnection", label: "Gas connection", type: "text" },
    { key: "fridgeWaterPoint", label: "Fridge water point", type: "text" },
    { key: "smartLockBrand", label: "Smart lock brand", type: "text" },
  ],
  wetAreaCompliance: [
    {
      key: "waterproofingStandard",
      label: "Waterproofing standard",
      type: "text",
    },
    { key: "showerScreenType", label: "Shower screen type", type: "text" },
    { key: "tiledNicheCount", label: "Tiled niche count", type: "number" },
    { key: "showerCount", label: "Shower count", type: "number" },
    {
      key: "floorToCeilingTiles",
      label: "Floor to ceiling tiles",
      type: "text",
    },
    { key: "floorWasteType", label: "Floor waste type", type: "text" },
  ],
  safetyAndSiteLogistics: [
    { key: "roofGuardrails", label: "Roof guardrails", type: "text" },
    { key: "sedimentControl", label: "Sediment control", type: "text" },
    { key: "scaffoldingSafety", label: "Scaffolding safety", type: "text" },
    { key: "tradeWaste", label: "Trade waste", type: "text" },
    { key: "finalCleanStatus", label: "Final clean status", type: "text" },
  ],
};

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function emptyToNull(raw: string) {
  return raw.trim() === "" ? null : raw;
}

function parseNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `<input type="date">` only accepts `yyyy-MM-dd`. Requirements dates are
 * written in that shape, but older payloads may carry a full ISO timestamp, so
 * anything longer is trimmed back to the date part rather than shown blank.
 */
function toDateInputValue(value: unknown) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";

    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  if (typeof value !== "string" || value.trim() === "") return "";

  const [datePart] = value.split("T");
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "";
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

// ---------------------------------------------------------------------------
// Reusable field primitives
// ---------------------------------------------------------------------------

const FIELD_LABEL_CLASS = "gap-1 text-xs font-medium text-muted-foreground";
const FIELD_CONTROL_CLASS = "h-9 rounded-lg bg-card text-sm";

function FieldShell({
  label,
  unit,
  htmlFor,
  children,
}: {
  label: React.ReactNode;
  unit?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const content = (
    <>
      {label}
      {unit ? (
        <span className="font-normal text-muted-foreground">({unit})</span>
      ) : null}
    </>
  );

  return (
    <div className="space-y-1.5">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
          {content}
        </Label>
      ) : (
        <p className={cn("flex items-center", FIELD_LABEL_CLASS)}>{content}</p>
      )}
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: unknown;
  onChange: (v: string | null) => void;
  multiline?: boolean;
}) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id}>
      {multiline ? (
        <Textarea
          id={id}
          value={displayValue(value)}
          onChange={(e) => onChange(emptyToNull(e.target.value))}
          className="min-h-20 resize-none rounded-lg bg-card text-sm"
        />
      ) : (
        <Input
          id={id}
          value={displayValue(value)}
          onChange={(e) => onChange(emptyToNull(e.target.value))}
          className={FIELD_CONTROL_CLASS}
        />
      )}
    </FieldShell>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: string | null) => void;
}) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id}>
      <Input
        id={id}
        type="date"
        value={toDateInputValue(value)}
        onChange={(e) => onChange(emptyToNull(e.target.value))}
        className={cn(FIELD_CONTROL_CLASS, "font-mono tabular-nums")}
      />
    </FieldShell>
  );
}

function NumberField({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: unknown;
  onChange: (v: number | null) => void;
  unit?: string;
}) {
  const id = useId();
  return (
    <FieldShell label={label} unit={unit} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={displayValue(value)}
        onChange={(e) => onChange(parseNumber(e.target.value))}
        className={cn(FIELD_CONTROL_CLASS, "font-mono tabular-nums")}
      />
    </FieldShell>
  );
}

function CurrencyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: number | null) => void;
}) {
  const id = useId();
  return (
    <FieldShell label={label} unit="AUD" htmlFor={id}>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
        >
          $
        </span>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={displayValue(value)}
          onChange={(e) => onChange(parseNumber(e.target.value))}
          className={cn(FIELD_CONTROL_CLASS, "pl-6 font-mono tabular-nums")}
        />
      </div>
    </FieldShell>
  );
}

function PercentField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: number | null) => void;
}) {
  const id = useId();
  return (
    <FieldShell label={label} unit="%" htmlFor={id}>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={displayValue(value)}
          onChange={(e) => onChange(parseNumber(e.target.value))}
          className={cn(FIELD_CONTROL_CLASS, "pr-7 font-mono tabular-nums")}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
        >
          %
        </span>
      </div>
    </FieldShell>
  );
}

function BooleanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: boolean | null) => void;
}) {
  const id = useId();
  const current = value === true ? "yes" : value === false ? "no" : "unknown";
  return (
    <FieldShell label={label} htmlFor={id}>
      <Select
        value={current}
        onValueChange={(next) =>
          onChange(next === "unknown" ? null : next === "yes")
        }
      >
        <SelectTrigger
          id={id}
          className="w-full rounded-lg bg-card text-sm data-[size=default]:h-9"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unknown">Not recorded</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function renderField(
  config: FieldConfig,
  value: unknown,
  onChange: (value: unknown) => void,
) {
  switch (config.type) {
    case "currency":
      return (
        <CurrencyField label={config.label} value={value} onChange={onChange} />
      );
    case "percent":
      return (
        <PercentField label={config.label} value={value} onChange={onChange} />
      );
    case "number":
      return (
        <NumberField
          label={config.label}
          value={value}
          onChange={onChange}
          unit={config.unit}
        />
      );
    case "boolean":
      return (
        <BooleanField label={config.label} value={value} onChange={onChange} />
      );
    case "date":
      return (
        <DateField label={config.label} value={value} onChange={onChange} />
      );
    case "textarea":
      return (
        <TextField
          label={config.label}
          value={value}
          onChange={onChange}
          multiline
        />
      );
    default:
      return (
        <TextField label={config.label} value={value} onChange={onChange} />
      );
  }
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

  return (
    <FieldShell label={label}>
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
// ---------------------------------------------------------------------------
// Section-specific composite blocks
// ---------------------------------------------------------------------------

/**
 * Read-only, deliberately.
 *
 * ADR 0003 makes `owners[]` on the offer's Job setup step the single source of
 * truth for the customer side, and persists the full party set to
 * `Project.parties` at handoff. `requirements.legalAdministration.ownerContacts`
 * is a *derived projection* of that set, written once by
 * `offer-project-handoff.ts` — not an independent record.
 *
 * This block used to render editable tag lists over that projection. Edits made
 * here never reached `Project.parties`, so they diverged from what the offer,
 * tender and contract signing flows actually read, and would be silently
 * overwritten if the handoff re-ran. With no write path, the projection and the
 * party set stay consistent by construction.
 *
 * Owners are also not three independent lists — they are parties. Pairing them
 * by index reflects that, and makes a ragged projection visible rather than
 * quietly misaligning names against the wrong email.
 */
function OwnerContactsBlock({
  names,
  emails,
  phones,
}: {
  names: string[];
  emails: string[];
  phones: string[];
}) {
  const ownerCount = Math.max(names.length, emails.length, phones.length);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-sm font-semibold text-foreground">Owners</h4>
        <p className="text-xs text-muted-foreground">
          Captured on the offer&rsquo;s Job setup step. Edit them there so the
          contract and signing flows stay in step.
        </p>
      </div>

      {ownerCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          No owner parties were captured for this project.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: ownerCount }, (_, index) => (
            <li
              key={index}
              className="rounded-lg border border-border/70 bg-card p-3"
            >
              <p className="text-sm font-medium text-foreground">
                {names[index]?.trim() || "Name not recorded"}
              </p>
              <p className="mt-1 wrap-break-word text-xs text-muted-foreground">
                {emails[index]?.trim() || "No email recorded"}
              </p>
              <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                {phones[index]?.trim() || "No phone recorded"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * HBCF (Home Building Compensation Fund) certificate number and the certificate
 * it was read from.
 *
 * The number is the thing site staff quote back to iCare and to the owner, so
 * it stays editable by hand: OCR on a photographed certificate is not reliable
 * enough to be the only way in. The alert is driven by the number rather than
 * by the presence of a document, so uploading an unreadable certificate leaves
 * the prompt up instead of silently marking the job compliant.
 */
function HbcfInsuranceBlock({
  projectId,
  insuranceNumber,
  document,
  extracting,
  onNumberChange,
  onUpload,
}: {
  projectId: string;
  insuranceNumber: string | null;
  document: ProjectSourceDocumentReference | null;
  extracting: boolean;
  onNumberChange: (value: string | null) => void;
  onUpload: (files: DBFile[]) => void;
}) {
  const id = useId();
  const dispatch = useAppDispatch();
  const hasNumber = (insuranceNumber ?? "").trim().length > 0;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-sm font-semibold text-foreground">
          HBCF insurance
        </h4>
        <p className="text-xs text-muted-foreground">
          Upload the certificate to read the number automatically, or type it in
          if the scan is unreadable.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FieldShell label="HBCF insurance no." htmlFor={id}>
          <Input
            id={id}
            value={displayValue(insuranceNumber)}
            onChange={(e) => onNumberChange(emptyToNull(e.target.value))}
            placeholder="Not recorded yet"
            disabled={extracting}
            className={FIELD_CONTROL_CLASS}
          />
        </FieldShell>

        <div className="flex flex-col justify-end gap-1.5">
          <UploadButton
            projectId={projectId}
            maxFiles={1}
            accept="application/pdf,.pdf"
            onUpload={onUpload}
          />
          {extracting ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
              Reading the certificate&hellip;
            </p>
          ) : null}
        </div>
      </div>

      {hasNumber ? null : (
        <div
          role="alert"
          className={cn(
            "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm",
            "border-destructive/25 bg-destructive-light text-destructive-ink",
          )}
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <p>Upload the insurance document to update the no.</p>
        </div>
      )}

      {document?.url ? (
        <Button
          type="button"
          onClick={() =>
            dispatch(
              openModal({
                type: "previewFile",
                payload: { fileUrl: document.url },
              }),
            )
          }
          aria-label={`Open the hbcf insurance document in a new tab`}
          variant="ghost"
          size="sm"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <FileText aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="wrap-break-word">
            {document.fileName || "HBCF insurance certificate"}
          </span>
          <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
        </Button>
      ) : null}
    </div>
  );
}

function PaymentStagesTable({
  stages,
  onChange,
}: {
  stages: ProjectPaymentStage[];
  onChange: (stages: ProjectPaymentStage[]) => void;
}) {
  const updateRow = (index: number, patch: Partial<ProjectPaymentStage>) => {
    const next = stages.map((stage, i) =>
      i === index ? { ...stage, ...patch } : stage,
    );
    onChange(next);
  };

  const removeRow = (index: number) =>
    onChange(stages.filter((_, i) => i !== index));
  const addRow = () =>
    onChange([...stages, { label: "", percentage: null, amount: null }]);

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Payment stages</p>
        <Badge
          variant="outline"
          className="rounded-full bg-muted text-xs font-medium text-muted-foreground"
        >
          {stages.length} stage{stages.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {stages.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_100px_120px_32px] gap-2 bg-muted px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Label</span>
            <span>Percent</span>
            <span>Amount</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="divide-y divide-border">
            {stages.map((stage, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_100px_120px_32px] items-center gap-2 px-3 py-2"
              >
                <Input
                  aria-label={`Stage ${index + 1} label`}
                  value={stage.label ?? ""}
                  onChange={(e) => updateRow(index, { label: e.target.value })}
                  className="h-8 rounded-md bg-card text-sm"
                />
                <div className="relative">
                  <Input
                    aria-label={`Stage ${index + 1} percent of contract`}
                    type="number"
                    inputMode="decimal"
                    value={displayValue(stage.percentage)}
                    onChange={(e) =>
                      updateRow(index, {
                        percentage: parseNumber(e.target.value),
                      })
                    }
                    className="h-8 rounded-md bg-card pr-5 font-mono text-sm tabular-nums"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
                  >
                    %
                  </span>
                </div>
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
                  >
                    $
                  </span>
                  <Input
                    aria-label={`Stage ${index + 1} amount in AUD`}
                    type="number"
                    inputMode="decimal"
                    value={displayValue(stage.amount)}
                    onChange={(e) =>
                      updateRow(index, { amount: parseNumber(e.target.value) })
                    }
                    className="h-8 rounded-md bg-card pl-5 font-mono text-sm tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={`Remove stage ${index + 1}`}
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border py-4 text-center text-sm text-muted-foreground">
          No payment stages recorded yet. Add a stage to build the claim
          schedule.
        </p>
      )}

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus aria-hidden="true" className="h-3.5 w-3.5" /> Add stage
      </Button>
    </div>
  );
}

function SourceDocumentCard({
  kind,
  url,
}: {
  kind: "Tender" | "Contract";
  fileName: string;
  url: string;
  onChange: (field: "fileName" | "url", value: string) => void;
}) {
  const dispatch = useAppDispatch();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText
            aria-hidden="true"
            className="h-4 w-4 text-muted-foreground"
          />
          <span className="text-sm font-semibold text-foreground">
            {kind} document
          </span>
        </div>
        {url ? (
          <Button
            type="button"
            onClick={() =>
              dispatch(
                openModal({
                  type: "previewFile",
                  payload: { fileUrl: url },
                }),
              )
            }
            aria-label={`Open the ${kind.toLowerCase()} document in a new tab`}
            variant="ghost"
            size="sm"
            className="h-auto gap-1 px-0 text-xs font-medium text-primary hover:underline"
          >
            Open <ExternalLink aria-hidden="true" className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// function AutomationToggle({
//   label,
//   description,
//   checked,
//   onChange,
// }: {
//   label: string;
//   description: string;
//   checked: boolean;
//   onChange: (v: boolean) => void;
// }) {
//   return (
//     <button
//       type="button"
//       role="switch"
//       aria-checked={checked}
//       onClick={() => onChange(!checked)}
//       className={cn(
//         "flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
//         checked ? "border-primary/40 bg-primary/5" : "border-border bg-card",
//       )}
//     >
//       <div>
//         <p className="text-sm font-medium text-foreground">{label}</p>
//         <p className="text-xs text-muted-foreground">{description}</p>
//       </div>
//       <span
//         aria-hidden="true"
//         className={cn(
//           "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
//           checked ? "bg-primary" : "bg-border",
//         )}
//       >
//         <span
//           className={cn(
//             "absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform motion-reduce:transition-none",
//             checked ? "translate-x-4" : "translate-x-0.5",
//           )}
//         />
//       </span>
//     </button>
//   );
// }

function ValidationRow({
  validation,
}: {
  validation: ProjectValidationResult;
}) {
  const Icon =
    validation.severity === "fail"
      ? AlertTriangle
      : validation.severity === "warning"
        ? CircleAlert
        : Info;
  const tone =
    validation.severity === "fail"
      ? "border-destructive/25 bg-destructive-light text-destructive-ink"
      : validation.severity === "warning"
        ? "border-warning/30 bg-warning-light text-warning-ink"
        : "border-border bg-muted text-muted-foreground";
  const severityLabel =
    validation.severity === "fail"
      ? "Issue"
      : validation.severity === "warning"
        ? "Warning"
        : "Note";

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm",
        tone,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-0.5">
        <p>
          <span className="font-medium">{severityLabel}: </span>
          {validation.message}
        </p>
        {validation.ownerResponsibility || validation.variationRequired ? (
          <p className="text-xs">
            {[
              validation.ownerResponsibility ? "Owner responsibility" : null,
              validation.variationRequired ? "Variation required" : null,
            ]
              .filter(Boolean)
              .join(" • ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ConflictValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="font-mono text-xs tabular-nums text-foreground">
        {formatValue(value)}
      </p>
    </div>
  );
}

function ConflictRow({ conflict }: { conflict: ProjectConflictResult }) {
  return (
    <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-light p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-foreground">
          {conflict.fieldPath}
        </span>
        <Badge className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-warning-ink">
          {toLabel(conflict.resolution)}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ConflictValue label="Tender" value={conflict.tenderValue} />
        <ConflictValue label="Contract" value={conflict.contractValue} />
        <ConflictValue label="Resolved" value={conflict.resolvedValue} />
      </div>
      {conflict.note ? (
        <p className="text-xs text-muted-foreground">{conflict.note}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectOverviewTab({
  project,
  isAdmin,
}: {
  project: ProjectDetail;
  isAdmin: boolean;
}) {
  const params = useParams();
  const dispatch = useAppDispatch();
  const { startDate, estimatedEndDate } = project;
  const initialRequirements = (project.requirements ?? {}) as RequirementsData;
  const [openSection, setOpenSection] = useState<string>();
  const [draft, setDraft] = useState<RequirementsData>(initialRequirements);
  const [stateStartDate, setStateStartDate] = useState<string | null>(
    toDateInputValue(startDate),
  );
  const [stateEstimatedEndDate, setStateEstimatedEndDate] = useState<
    string | null
  >(toDateInputValue(estimatedEndDate));
  const [saving, setSaving] = useState(false);
  // OCR + model round-trip on the uploaded HBCF certificate. Separate from
  // `saving` so the certificate field can be locked while it runs without
  // disabling the rest of the form.
  const [hbcfExtracting, setHbcfExtracting] = useState(false);
  // Validations and conflicts are produced upstream from the tender/contract
  // extraction and stored on the requirements payload — nothing in the app
  // derives them (`buildProjectRequirementsPayload` takes them as an argument),
  // so they cannot be recomputed from the live form without inventing rules the
  // server does not have. Instead, track whether the form has unsaved edits and
  // label the counts honestly while it does.
  const [dirty, setDirty] = useState(false);

  // Every edit path goes through this so `dirty` can never drift from `draft`.
  const editDraft = (
    updater: (current: RequirementsData) => RequirementsData,
  ) => {
    setDirty(true);
    setDraft(updater);
  };

  const sectionKeys = useMemo(
    () => Object.keys(SECTION_META) as ProjectFlowSectionKey[],
    [],
  );

  const validations = draft.validations ?? [];
  const conflicts = draft.conflicts ?? [];
  const failCount = validations.filter((v) => v.severity === "fail").length;
  const warnCount = validations.filter((v) => v.severity === "warning").length;
  const countsAreStale = dirty && failCount + warnCount > 0;

  const updateSectionField = (
    section: ProjectFlowSectionKey,
    field: string,
    value: unknown,
  ) => {
    editDraft((current) => ({
      ...current,
      [section]: { ...(current[section] as object), [field]: value },
    }));
  };

  // `updateOwnerContacts` was removed with the editable owner block. Owners are
  // owned by the offer's Job setup step (ADR 0003) and reach the project as a
  // read-only projection; a write path here forked them from Project.parties.

  const updatePaymentStages = (stages: ProjectPaymentStage[]) => {
    editDraft((current) => ({
      ...current,
      commercialsAndClaims: {
        ...(current.commercialsAndClaims as object),
        paymentStages: stages,
      } as never,
    }));
  };

  const updateInclusionsExclusionsList = (
    field: "inclusions" | "exclusions",
    values: string[],
  ) => {
    updateSectionField("inclusionsAndExclusions", field, values);
  };

  const updateSourceDocument = (
    kind: "tender" | "contract",
    field: "fileName" | "url",
    value: string,
  ) => {
    editDraft((current) => {
      const sourceDocuments = (current.sourceDocuments ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const doc = sourceDocuments[kind] ?? {
        kind,
        fileId: "",
        fileName: "",
        url: "",
      };
      return {
        ...current,
        sourceDocuments: {
          ...sourceDocuments,
          [kind]: { ...doc, [field]: value },
        } as never,
      };
    });
  };

  // const updateAutomationTrigger = (
  //   field: "orderReminders" | "rainDelayCalculations" | "noticeCountdowns",
  //   value: boolean,
  // ) => {
  //   editDraft((current) => ({
  //     ...current,
  //     automationTriggers: {
  //       ...(current.automationTriggers ?? {}),
  //       [field]: value,
  //     } as never,
  //   }));
  // };

  /**
   * @param override - Requirements to persist instead of the current `draft`.
   *   State updates are async, so a flow that edits the draft and saves in the
   *   same tick (the HBCF upload) has to hand the new payload in directly or it
   *   would PATCH the pre-edit draft.
   */
  const handleSave = async (override?: RequirementsData) => {
    const payload = override ?? draft;
    setSaving(true);
    try {
      const response = await fetchJson<ProjectDetail>(
        `/api/projects/${project.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requirements: payload,
            name: payload.projectName,
            startDate: stateStartDate,
            estimatedEndDate: stateEstimatedEndDate,
          }),
        },
        "Unable to update project",
      );
      toast.success("Project sections updated");
      // The header is a sibling reading `projects.activeProject`, not this
      // tab's draft, so a saved HBCF number or PCA inspector kept showing
      // "Not set" until a full reload. The PATCH returns the whole project,
      // so hand it to the store the header actually reads.
      dispatch(setActiveProject(response.data));
      setDraft((response.data.requirements ?? payload) as RequirementsData);
      setStateStartDate(toDateInputValue(response.data.startDate));
      setStateEstimatedEndDate(
        toDateInputValue(response.data.estimatedEndDate),
      );
      setDirty(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update project",
      );
    } finally {
      setSaving(false);
    }
  };

  /**
   * Links an uploaded HBCF certificate to the project and fills in the number
   * read off it.
   *
   * Extraction failure is not upload failure: the document reference is saved
   * either way, so the certificate stays one click away and the red alert keeps
   * asking for a number instead of the upload being lost.
   * @param files - Result of the single-file HBCF upload.
   */
  const handleHbcfUpload = async (files: DBFile[]) => {
    const file = files[0];
    if (!file) return;

    const hbcfInsuranceDocument: ProjectSourceDocumentReference = {
      fileId: file.id,
      fileName: file.filename,
      url: file.url,
      kind: "hbcfInsurance",
    };

    const toastId = toast.loading("Reading the HBCF certificate…");
    setHbcfExtracting(true);
    let extractedNumber = "";

    try {
      const response = await fetchJson<{
        hbcfInsuranceNumber: string;
        ok: boolean;
        message: string;
      }>(
        `/api/projects/${project.id}/hbcf-extract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: file.url,
            fileId: file.id,
            fileName: file.filename,
          }),
        },
        "Unable to read the HBCF insurance document",
      );

      extractedNumber = (response.data.hbcfInsuranceNumber ?? "").trim();

      if (extractedNumber) {
        toast.success("HBCF insurance number read from the certificate", {
          id: toastId,
        });
      } else {
        toast.warning(
          "No HBCF insurance number was found on the certificate. Enter it manually.",
          { id: toastId },
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to read the HBCF insurance document",
        { id: toastId },
      );
    } finally {
      setHbcfExtracting(false);
    }

    const nextDraft: RequirementsData = {
      ...draft,
      legalAdministration: {
        ...(draft.legalAdministration as object),
        hbcfInsuranceNumber: extractedNumber || null,
        hbcfInsuranceDocument,
      } as never,
    };

    editDraft(() => nextDraft);
    await handleSave(nextDraft);

    // One certificate, filed in both places it is needed. The compliance
    // checklist asks for home insurance too, and without this the same PDF had
    // to be uploaded a second time over there — against a row the certifier is
    // waiting on, which is the half more likely to be forgotten.
    //
    // Only when an engagement exists to file it against, and never fatal: the
    // number and the document reference are already saved above, and a project
    // with no certifier yet has nowhere to put this and needs nothing doing.
    if (project.certifierEngagement) {
      try {
        await dispatch(
          uploadComplianceDocument({
            projectId: project.id,
            fileId: file.id,
            documentType: ComplianceDocumentType.HOME_INSURANCE,
          }),
        ).unwrap();
      } catch (error) {
        console.error(
          "Saved the HBCF certificate, but could not file it on the compliance checklist",
          error,
        );
      }
    }
  };

  const tender = (draft.sourceDocuments?.tender ?? {
    fileName: "",
    url: "",
    kind: "tender",
    fileId: "",
  }) as Record<string, string>;
  const contract = (draft.sourceDocuments?.contract ?? {
    fileName: "",
    url: "",
    kind: "contract",
    fileId: "",
  }) as Record<string, string>;
  // const automation = draft.automationTriggers ?? {
  //   orderReminders: false,
  //   rainDelayCalculations: false,
  //   noticeCountdowns: false,
  // };
  const legalAdministration = draft.legalAdministration as
    | Record<string, unknown>
    | undefined;
  const ownerContacts = legalAdministration?.ownerContacts as
    | { names?: string[]; emails?: string[]; phones?: string[] }
    | undefined;
  const hbcfInsuranceNumber =
    (legalAdministration?.hbcfInsuranceNumber as string | null | undefined) ??
    null;
  const hbcfInsuranceDocument =
    (legalAdministration?.hbcfInsuranceDocument as
      | ProjectSourceDocumentReference
      | null
      | undefined) ?? null;

  // Header chips and the compliance banner deep-link here via
  // `#legalAdministration`. Re-apply on hashchange too — a click while
  // already on Overview used to leave the accordion closed because `params`
  // (the only prior dependency) does not change for a same-route hash nav.
  useEffect(() => {
    const applyHash = () => {
      const section = window.location.hash.slice(1);
      if (!section) return;
      setOpenSection(section);
      // Wait a tick for the accordion to expand before scrolling, otherwise
      // the browser lands on a collapsed header and the fields stay off-screen.
      window.setTimeout(() => {
        document.getElementById(section)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 50);
    };

    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [params]);

  // Warn before discarding unsaved overview edits via refresh / close. In-app
  // tab switches are a separate gap — this covers the browser-level loss path.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <section className="space-y-4">
      <Card className="border-border/70 bg-card shadow-sm">
        <CardHeader className="sticky top-0 z-20 flex flex-row items-center justify-between gap-3 border-b border-border/70 bg-card pb-4 shadow-sm">
          <div>
            {/* The page <h1> is the project name in project-header.tsx and
                nothing between here and it is an <h2>, so this panel title is
                the first h2 on the tab. The accordion triggers below sit in
                Radix's <h3> headers, so there is no level skip. */}
            <CardTitle
              as="h2"
              className="text-base font-semibold text-foreground"
            >
              Project information
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Extracted from the tender and contract documents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {failCount + warnCount > 0 ? (
              /* Live region so the "as of last save" qualifier is announced when
                 the first edit makes these counts stale, not just seen. */
              <div aria-live="polite" className="flex items-center gap-2">
                {failCount > 0 ? (
                  <Badge className="rounded-full bg-destructive-light px-3 py-1 text-xs font-medium text-destructive-ink">
                    {failCount} issue{failCount === 1 ? "" : "s"}
                  </Badge>
                ) : null}
                {warnCount > 0 ? (
                  <Badge className="rounded-full bg-warning-light px-3 py-1 text-xs font-medium text-warning-ink">
                    {warnCount} warning{warnCount === 1 ? "" : "s"}
                  </Badge>
                ) : null}
                {countsAreStale ? (
                  <span className="max-w-24 text-xs leading-tight text-muted-foreground">
                    as of last save
                  </span>
                ) : null}
              </div>
            ) : null}
            {dirty ? (
              <Badge className="rounded-full bg-warning-light px-3 py-1 text-xs font-medium text-warning-ink">
                Unsaved
              </Badge>
            ) : null}
            <Button
              onClick={() => handleSave()}
              disabled={!dirty || saving}
              aria-busy={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          {/* Overview fields */}
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label="Project name"
              value={draft.projectName}
              onChange={(v) =>
                editDraft((c) => ({ ...c, projectName: v ?? "" }))
              }
            />
            <TextField
              label="Project type"
              value={draft.projectType}
              onChange={(v) =>
                editDraft((c) => ({ ...c, projectType: v ?? "" }))
              }
            />
            <DateField
              label="Start date (on-site)"
              value={stateStartDate}
              onChange={(v) => {
                setStateStartDate(v);
                setDirty(true);
              }}
            />
            <DateField
              label="Estimated end date"
              value={stateEstimatedEndDate}
              onChange={(v) => {
                setStateEstimatedEndDate(v);
                setDirty(true);
              }}
            />
            <FieldShell label="Version">
              <p className="flex h-9 items-center rounded-lg border border-border bg-muted px-3 font-mono text-sm tabular-nums text-muted-foreground">
                v{draft.version ?? 1}
              </p>
            </FieldShell>
          </div>
          <TextField
            label="Summary"
            value={draft.summary}
            onChange={(v) => editDraft((c) => ({ ...c, summary: v ?? "" }))}
            multiline
          />

          {/* Source documents */}
          {isAdmin && (
            <div className="grid gap-4 md:grid-cols-2">
              <SourceDocumentCard
                kind="Tender"
                fileName={tender.fileName ?? ""}
                url={tender.url ?? ""}
                onChange={(field, value) =>
                  updateSourceDocument("tender", field, value)
                }
              />
              <SourceDocumentCard
                kind="Contract"
                fileName={contract.fileName ?? ""}
                url={contract.url ?? ""}
                onChange={(field, value) =>
                  updateSourceDocument("contract", field, value)
                }
              />
            </div>
          )}

          {/* Conflicts */}
          {conflicts.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">
                Conflicts between tender and contract
              </p>
              <div className="space-y-2">
                {conflicts.map((conflict, i) => (
                  <ConflictRow
                    key={`${conflict.fieldPath}-${i}`}
                    conflict={conflict}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Sections */}
          <Accordion
            type="single"
            collapsible
            value={openSection}
            onValueChange={setOpenSection}
            className="space-y-2"
          >
            {sectionKeys.map((key) => {
              const meta = SECTION_META[key];
              const Icon = meta.icon;
              const sectionData =
                (draft[key] as unknown as Record<string, unknown>) ?? {};
              const sectionValidations = validations.filter(
                (v) => v.section === key,
              );
              const sectionFailCount = sectionValidations.filter(
                (v) => v.severity === "fail",
              ).length;

              if (!isAdmin && meta.isAdminOnly) {
                return null;
              }

              return (
                <AccordionItem
                  key={key}
                  id={key}
                  value={key}
                  className="rounded-xl border border-border bg-card px-4"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-3 text-left">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon aria-hidden="true" className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {meta.label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {meta.description}
                          </p>
                        </div>
                      </div>
                      {sectionFailCount > 0 ? (
                        <Badge className="rounded-full bg-destructive-light px-2.5 py-0.5 text-xs font-medium text-destructive-ink">
                          {sectionFailCount} issue
                          {sectionFailCount === 1 ? "" : "s"}
                          {dirty ? (
                            <span className="sr-only"> as of last save</span>
                          ) : null}
                        </Badge>
                      ) : null}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="max-h-[75vh] space-y-4 overflow-y-auto pb-4 pt-1 no-scrollbar">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {SECTION_FIELDS[key].map((config) => (
                        <div
                          key={config.key}
                          className={
                            config.span === 2
                              ? "md:col-span-2 xl:col-span-2"
                              : undefined
                          }
                        >
                          {renderField(
                            config,
                            sectionData[config.key],
                            (value) =>
                              updateSectionField(key, config.key, value),
                          )}
                        </div>
                      ))}
                    </div>

                    {key === "legalAdministration" ? (
                      <OwnerContactsBlock
                        names={ownerContacts?.names ?? []}
                        emails={ownerContacts?.emails ?? []}
                        phones={ownerContacts?.phones ?? []}
                      />
                    ) : null}

                    {key === "legalAdministration" ? (
                      <HbcfInsuranceBlock
                        projectId={project.id}
                        insuranceNumber={hbcfInsuranceNumber}
                        document={hbcfInsuranceDocument}
                        extracting={hbcfExtracting}
                        onNumberChange={(value) =>
                          updateSectionField(
                            "legalAdministration",
                            "hbcfInsuranceNumber",
                            value,
                          )
                        }
                        onUpload={handleHbcfUpload}
                      />
                    ) : null}

                    {key === "commercialsAndClaims" ? (
                      <PaymentStagesTable
                        stages={
                          (sectionData.paymentStages as ProjectPaymentStage[]) ??
                          []
                        }
                        onChange={updatePaymentStages}
                      />
                    ) : null}

                    {key === "inclusionsAndExclusions" ? (
                      <div className="grid gap-4 rounded-xl border border-border bg-muted/40 p-4 md:grid-cols-2">
                        <TagListControl
                          label={
                            <h5 className="flex items-center text-sm font-medium text-foreground">
                              <Check
                                aria-hidden="true"
                                className="mr-1 h-3 w-3 shrink-0 text-success-ink"
                              />
                              Inclusions
                            </h5>
                          }
                          icon={
                            <Check
                              aria-hidden="true"
                              className="mr-1 h-3 w-3 shrink-0 text-success-ink"
                            />
                          }
                          values={(sectionData.inclusions as string[]) ?? []}
                          onChange={(v) =>
                            updateInclusionsExclusionsList("inclusions", v)
                          }
                        />
                        <TagListControl
                          label={
                            <h5 className="flex items-center text-sm font-medium text-foreground">
                              <AlertTriangle
                                aria-hidden="true"
                                className="mr-1 h-3 w-3 shrink-0 text-warning-ink"
                              />
                              Exclusions
                            </h5>
                          }
                          icon={
                            <AlertTriangle
                              aria-hidden="true"
                              className="mr-1 h-3 w-3 shrink-0 text-warning-ink"
                            />
                          }
                          values={(sectionData.exclusions as string[]) ?? []}
                          onChange={(v) =>
                            updateInclusionsExclusionsList("exclusions", v)
                          }
                        />
                      </div>
                    ) : null}

                    {sectionValidations.length > 0 ? (
                      <div className="space-y-2">
                        {sectionValidations.map((validation) => (
                          <ValidationRow
                            key={validation.id}
                            validation={validation}
                          />
                        ))}
                      </div>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>
    </section>
  );
}
