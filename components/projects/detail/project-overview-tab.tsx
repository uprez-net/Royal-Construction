"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProjectDetail } from "@/types/project";
import { ComplianceDocumentType, type File as DBFile } from "@prisma/client";
import type {
  HbcfClaimDocument,
  ProjectRequirementsPayload,
  ProjectFlowSectionKey,
  ProjectPaymentStage,
  ProjectValidationResult,
  ProjectConflictResult,
} from "@/types/project-flow";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Pencil,
  Lock,
} from "lucide-react";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  setActiveProject,
  uploadComplianceDocument,
} from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import { useParams } from "next/navigation";
import { format, parse } from "date-fns";
import {
  hasWorkStarted,
  milestoneTargetDates,
} from "@/lib/domain/projects/milestone-schedule";
import { hasInsuranceClaimDates } from "@/lib/projects/insurance-claim-dates";
import { HbcfCoverDatesDialog } from "@/components/projects/detail/hbcf-cover-dates-dialog";
import { withInsuranceClaimStartDate } from "@/components/projects/detail/insurance-claim-dates-fields";
import { HbcfClaimsBlock } from "@/components/projects/detail/hbcf-claims-block";
import {
  appendHbcfClaimDocuments,
  hbcfClaimDate,
  readHbcfClaimDocuments,
} from "@/lib/domain/insurance/hbcf-claims";
import { projectDocumentGaps } from "@/lib/domain/projects/document-gaps";
import { normalizeDateString } from "@/utils/date";
import {
  DOCUMENT_ATTENTION_ID,
  DocumentAttentionPanel,
  type DocumentGapTarget,
} from "@/components/projects/detail/document-attention-panel";
import type { VisibleProjectDetailTabKey } from "@/components/projects/detail/project-tab-navigation";

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
    // A date, stored `yyyy-MM-dd`: the server normalises it on every save and
    // compares it with the start date. It was a free-text box, which is how
    // "TBC" and "12th June" got in.
    { key: "signedDate", label: "Signed (contract executed)", type: "date" },
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
 * Anything else ("12 March 2026" read off a contract) goes through
 * `normalizeDateString`, the parser the server normalises the signed date
 * with on save.
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  return normalizeDateString(value) ?? "";
}

/** The element id a field is scrolled to from the document attention panel. */
function fieldAnchorId(field: string) {
  return `project-field-${field}`;
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
  const inputValue = toDateInputValue(value);
  // A stored value no parser can read ("TBC", "on exchange") would show as an
  // empty picker and look unset. Say what is there, so it is replaced on
  // purpose rather than by accident.
  const unreadable =
    typeof value === "string" && value.trim() !== "" && inputValue === ""
      ? value.trim()
      : null;
  const hintId = `${id}-unreadable`;
  return (
    <FieldShell label={label} htmlFor={id}>
      <Input
        id={id}
        type="date"
        value={inputValue}
        aria-describedby={unreadable ? hintId : undefined}
        aria-invalid={unreadable ? true : undefined}
        onChange={(e) => onChange(emptyToNull(e.target.value))}
        className={cn(FIELD_CONTROL_CLASS, "font-mono tabular-nums")}
      />
      {unreadable ? (
        <p id={hintId} className="text-[11px] leading-snug text-warning-ink">
          Recorded as &ldquo;{unreadable}&rdquo;, which is not a date. Pick the
          date to replace it.
        </p>
      ) : null}
    </FieldShell>
  );
}

/**
 * The on-site start date, edited and saved on its own.
 *
 * Every activity's target date hangs off this one — saving a new start re-dates
 * the whole schedule (`milestoneTargetDate`) — so it changes deliberately: Edit,
 * Save, then a confirmation that says what is about to move. It never rides
 * along with whatever else the overview form holds unsaved, and a refusal (a
 * start before the contract was signed) is reported against this field.
 */
function StartDateField({
  projectId,
  value,
  milestones,
  locked,
  claimDate,
  onSaved,
}: {
  projectId: string;
  value: unknown;
  milestones: ProjectDetail["milestones"];
  /** Work has started on site: the date is the day it began, and fixed. */
  locked: boolean;
  /**
   * The saved HBCF claim date, `yyyy-MM-dd`. While one is recorded the start
   * date follows it (issue #421) and is not edited here.
   */
  claimDate: string | null;
  onSaved: (project: ProjectDetail) => void;
}) {
  const milestoneCount = milestones.length;
  const id = useId();
  const current = toDateInputValue(value);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    setPending(current);
    setEditing(true);
  };

  const requestSave = () => {
    if (saving) return;
    if (!pending) {
      toast.error("Pick a start date.");
      return;
    }
    if (pending === current) {
      setEditing(false);
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetchJson<ProjectDetail>(
        `/api/projects/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: pending }),
        },
        "Unable to update the start date",
      );
      onSaved(response.data);
      setConfirming(false);
      setEditing(false);
      toast.success(
        milestoneCount > 0
          ? `Start date updated and ${milestoneCount} milestone target dates rescheduled`
          : "Start date updated",
      );
    } catch (error) {
      // The dialog closes so the date can be corrected; nothing was written.
      setConfirming(false);
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update the start date",
      );
    } finally {
      setSaving(false);
    }
  };

  const pendingDate = pending ? parse(pending, "yyyy-MM-dd", new Date()) : null;
  const displayDate = (date: Date) => format(date, "d MMM yyyy");

  const hintId = `${id}-hint`;
  const followsClaim = Boolean(claimDate) && !locked;
  const hint = locked ? (
    <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
      Set to the day the first milestone started. It can&apos;t be changed once
      work has started.
      {claimDate && claimDate !== current
        ? ` The HBCF claim date is ${displayDate(parse(claimDate, "yyyy-MM-dd", new Date()))}.`
        : null}
    </p>
  ) : followsClaim ? (
    <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
      Follows the HBCF claim date. Change the Insurance Claim Start Date under
      Legal &amp; Administration to move it and reschedule every milestone.
    </p>
  ) : (
    <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
      Changing it reschedules every milestone. It&apos;s set automatically, then
      locked, when the first milestone starts.
    </p>
  );

  if (!editing || locked || followsClaim) {
    return (
      <FieldShell label="Start date (on-site)">
        <div
          className={cn(
            "flex h-9 items-center justify-between gap-2 rounded-lg border border-border pl-3 pr-1 text-sm",
            locked ? "bg-muted" : "bg-card",
          )}
          aria-describedby={hintId}
        >
          <span
            className={cn(
              "font-mono tabular-nums",
              locked ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {current
              ? displayDate(parse(current, "yyyy-MM-dd", new Date()))
              : "Not set"}
          </span>
          {locked || followsClaim ? (
            <span className="mr-2 flex items-center">
              <Lock
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="sr-only">
                {locked ? "Locked" : "Set from the HBCF claim date"}
              </span>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-primary"
              aria-label="Edit start date"
              aria-describedby={hintId}
              onClick={startEditing}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
          )}
        </div>
        {hint}
      </FieldShell>
    );
  }

  return (
    <FieldShell label="Start date (on-site)" htmlFor={id}>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="date"
          value={pending}
          aria-describedby={hintId}
          autoFocus
          disabled={saving}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") requestSave();
            if (e.key === "Escape" && !saving) setEditing(false);
          }}
          className={cn(FIELD_CONTROL_CLASS, "font-mono tabular-nums")}
        />
        <Button
          size="icon"
          className="size-9 shrink-0"
          aria-label="Save start date"
          disabled={saving}
          onClick={requestSave}
        >
          <Check className="size-4" aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-9 shrink-0"
          aria-label="Cancel editing start date"
          disabled={saving}
          onClick={() => setEditing(false)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {hint}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !saving) setConfirming(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDate
                ? `Move the start date to ${displayDate(pendingDate)}?`
                : "Move the start date?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {milestoneCount > 0 && pendingDate ? (
                  <p>
                    All {milestoneCount} milestone target dates will be
                    rescheduled from the new start: the first on{" "}
                    <span className="font-medium text-foreground">
                      {displayDate(pendingDate)}
                    </span>
                    , then using each activity&apos;s estimated calendar days,
                    the last on{" "}
                    <span className="font-medium text-foreground">
                      {displayDate(
                        milestoneTargetDates(
                          pendingDate,
                          [...milestones].sort((a, b) => a.order - b.order),
                        ).at(-1)!,
                      )}
                    </span>
                    .
                  </p>
                ) : (
                  <p>This project has no milestones to reschedule.</p>
                )}
                <p>
                  This applies to every milestone, including ones already done
                  or in progress, and replaces any target date set by hand. It
                  cannot be undone from here.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              aria-busy={saving}
              onClick={(event) => {
                // Stay open until the save answers, so a failure is not
                // mistaken for a dialog that simply closed.
                event.preventDefault();
                void save();
              }}
            >
              {saving ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : null}
              {saving ? "Rescheduling…" : "Move start date"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          aria-label={`Edit ${value}`}
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
        className="min-h-11 min-w-0 flex-1 cursor-text whitespace-normal break-words text-left md:min-h-0 md:truncate"
        title={value}
      >
        {value}
      </button>

      <button
        type="button"
        onClick={onRemove}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:bg-background hover:text-foreground md:size-auto md:p-0.5 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
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
  const inputId = useId();
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
    <FieldShell label={label} htmlFor={inputId}>
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
            id={inputId}
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
          <div className="hidden grid-cols-[1fr_100px_120px_32px] gap-2 bg-muted px-3 py-2 text-[11px]/[1.4] font-semibold tracking-[0.06em] text-muted-foreground uppercase md:grid">
            <span>Label</span>
            <span>Percent</span>
            <span>Amount</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="divide-y divide-border">
            {stages.map((stage, index) => (
              // On a phone each stage is a small card: its number and remove
              // button on top, the label across, percent and amount side by
              // side with their names shown, since the column header is gone.
              <div
                key={index}
                className="grid grid-cols-2 items-end gap-x-2 gap-y-2 px-3 py-3 md:grid-cols-[1fr_100px_120px_32px] md:items-center md:gap-2 md:py-2"
              >
                <span className="col-start-1 row-start-1 self-center text-xs font-semibold text-muted-foreground md:hidden">
                  Stage {index + 1}
                </span>
                <Input
                  aria-label={`Stage ${index + 1} label`}
                  placeholder="Stage label"
                  value={stage.label ?? ""}
                  onChange={(e) => updateRow(index, { label: e.target.value })}
                  className="col-span-2 h-8 rounded-md bg-card text-sm md:col-span-1"
                />
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="mb-1 block text-xs text-muted-foreground md:hidden"
                  >
                    Percent
                  </span>
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
                    className="pointer-events-none absolute right-2 bottom-0 flex h-11 items-center text-xs text-muted-foreground md:h-8"
                  >
                    %
                  </span>
                </div>
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="mb-1 block text-xs text-muted-foreground md:hidden"
                  >
                    Amount
                  </span>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-0 left-2 flex h-11 items-center text-xs text-muted-foreground md:h-8"
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
                  className="col-start-2 row-start-1 flex h-11 w-11 items-center justify-center justify-self-end rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:col-start-auto md:row-start-auto md:h-8 md:w-8 md:justify-self-auto"
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
        <span className="min-w-0 font-mono text-xs break-all text-foreground">
          {conflict.fieldPath}
        </span>
        <Badge className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-warning-ink">
          {toLabel(conflict.resolution)}
        </Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
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
  onOpenTab,
}: {
  project: ProjectDetail;
  isAdmin: boolean;
  /** Switches the project page to another tab (a certificate's upload). */
  onOpenTab: (tab: VisibleProjectDetailTabKey) => void;
}) {
  const params = useParams();
  const dispatch = useAppDispatch();
  const { estimatedEndDate } = project;
  const initialRequirements = (project.requirements ?? {}) as RequirementsData;
  const [openSection, setOpenSection] = useState<string>();
  const [draft, setDraft] = useState<RequirementsData>(initialRequirements);
  const [stateEstimatedEndDate, setStateEstimatedEndDate] = useState<
    string | null
  >(toDateInputValue(estimatedEndDate));
  const [saving, setSaving] = useState(false);
  // OCR + model round-trip on the uploaded HBCF certificate. Separate from
  // `saving` so the certificate field can be locked while it runs without
  // disabling the rest of the form.
  const [hbcfExtracting, setHbcfExtracting] = useState(false);
  // Open after an HBCF upload on a project with no cover window yet, carrying
  // the start date read off the certificate (null when none was found).
  const [coverDatesPrompt, setCoverDatesPrompt] = useState<{
    suggestedStartDate: string | null;
    conflictingDates: string[];
  } | null>(null);
  // Validations and conflicts are produced upstream from the tender/contract
  // extraction and stored on the requirements payload — nothing in the app
  // derives them (`buildProjectRequirementsPayload` takes them as an argument),
  // so they cannot be recomputed from the live form without inventing rules the
  // server does not have. Instead, track whether the form has unsaved edits and
  // label the counts honestly while it does.
  const [dirty, setDirty] = useState(false);
  // The draft as of the last render. The HBCF upload awaits OCR for several
  // seconds; it merges its documents into this rather than into the draft it
  // started from, so edits made while the documents were being read survive.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // Same for the estimated end date, which is state of its own.
  const estimatedEndDateRef = useRef(stateEstimatedEndDate);
  useEffect(() => {
    estimatedEndDateRef.current = stateEstimatedEndDate;
  }, [stateEstimatedEndDate]);

  // Open while a save would move the start date onto a changed HBCF claim
  // date, which reschedules every milestone: the same deliberate step the
  // start date field asks for when it is moved by hand.
  const [claimDateConfirm, setClaimDateConfirm] = useState<{
    claimDate: string;
  } | null>(null);

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
    editDraft((current) => {
      const sectionData = current[section] as
        | Record<string, unknown>
        | undefined;
      // The cover end follows the start at the default twelve months until
      // somebody sets an end of their own — the same rule the HBCF upload and
      // the Slab-start prompt apply.
      if (
        section === "legalAdministration"
        && field === "insuranceClaimStartDate"
      ) {
        const next = withInsuranceClaimStartDate(
          {
            insuranceClaimStartDate:
              (sectionData?.insuranceClaimStartDate as string | null)
              ?? undefined,
            insuranceClaimEndDate:
              (sectionData?.insuranceClaimEndDate as string | null)
              ?? undefined,
          },
          (value as string | null) ?? undefined,
        );
        return {
          ...current,
          [section]: {
            ...sectionData,
            insuranceClaimStartDate: next.insuranceClaimStartDate ?? null,
            insuranceClaimEndDate: next.insuranceClaimEndDate ?? null,
          } as never,
        };
      }
      return {
        ...current,
        [section]: { ...sectionData, [field]: value },
      };
    });
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
   * @returns Whether the save landed, so a flow that continues after it (the
   *   HBCF upload) can stop instead of acting on something never saved.
   */
  const handleSave = async (override?: RequirementsData): Promise<boolean> => {
    const payload = override ?? draft;
    const estimatedEndDateAtSave = estimatedEndDateRef.current;
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
            // The start date is saved on its own by `StartDateField`. Read
            // through the ref: the HBCF upload saves after a long OCR wait,
            // and the value captured when it began may be out of date.
            estimatedEndDate: estimatedEndDateAtSave,
          }),
        },
        "Unable to update project",
      );
      const meta = response.meta ?? {};
      if (meta.startDateFollowedHbcfClaim) {
        const rescheduled = Number(meta.rescheduledMilestones ?? 0);
        toast.success(
          rescheduled > 0
            ? `Project sections updated. The start date moved to the HBCF claim date and ${rescheduled} milestone target dates were rescheduled.`
            : "Project sections updated. The start date moved to the HBCF claim date.",
        );
      } else if (meta.startDateHeldByStartedWork) {
        toast.info(
          "Project sections updated. The HBCF claim date was saved, but the start date stays on the day work began because work has started.",
        );
      } else {
        toast.success("Project sections updated");
      }
      // The header is a sibling reading `projects.activeProject`, not this
      // tab's draft, so a saved HBCF number or PCA inspector kept showing
      // "Not set" until a full reload. The PATCH returns the whole project,
      // so hand it to the store the header actually reads.
      dispatch(setActiveProject(response.data));
      // Edits made while the request was in flight are newer than what was
      // saved; replacing them with the response would lose them silently.
      // Every edit makes a new draft object, so the draft is unedited only
      // while it is still the very object this save sent.
      if (
        draftRef.current === payload
        && estimatedEndDateRef.current === estimatedEndDateAtSave
      ) {
        setDraft((response.data.requirements ?? payload) as RequirementsData);
        setStateEstimatedEndDate(
          toDateInputValue(response.data.estimatedEndDate),
        );
        setDirty(false);
      }
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update project",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * The Save button. A changed HBCF claim date moves the start date and
   * reschedules every milestone (issue #421) unless work has started, so that
   * save is confirmed first, the way a hand-moved start date is.
   */
  const requestSave = () => {
    const pendingClaim = hbcfClaimDate(
      draft.legalAdministration as Parameters<typeof hbcfClaimDate>[0],
    );
    if (
      pendingClaim
      && pendingClaim !== savedClaimDate
      && pendingClaim !== toDateInputValue(project.startDate)
      && !hasWorkStarted(project.milestones)
    ) {
      setClaimDateConfirm({ claimDate: pendingClaim });
      return;
    }
    void handleSave();
  };

  /**
   * Adds uploaded HBCF documents to the project's claim (issue #423), with the
   * number, cover date and amount read off each.
   *
   * Every document already on the project is kept. Extraction failure is not
   * upload failure: a document that could not be read is still added, with no
   * amount, so it stays one click away and is plainly not counted.
   *
   * The claim date is never taken from a document without asking: with no
   * claim date yet, the dates read are offered for confirmation (none is
   * suggested when they disagree); with one already set, a document that
   * disagrees is flagged and the date is left alone.
   * @param files - Result of the HBCF upload, one or more PDFs.
   */
  const handleHbcfUpload = async (files: DBFile[]) => {
    if (files.length === 0) return;

    const toastId = toast.loading(
      files.length === 1
        ? "Reading the HBCF document…"
        : `Reading ${files.length} HBCF documents…`,
    );
    setHbcfExtracting(true);

    const readings = await Promise.all(
      files.map(
        async (file): Promise<HbcfClaimDocument & { read: boolean }> => {
          const base = {
            amountConfirmed: false,
            certificateNumber: null,
            claimAmount: null,
            coverStartDate: null,
            fileId: file.id,
            fileName: file.filename,
            url: file.url,
          };
          try {
            const response = await fetchJson<{
              hbcfInsuranceNumber: string;
              coverStartDate?: string;
              claimAmount?: number | null;
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
            return {
              ...base,
              certificateNumber:
                response.data.hbcfInsuranceNumber?.trim() || null,
              claimAmount: response.data.claimAmount ?? null,
              coverStartDate: response.data.coverStartDate?.trim() || null,
              read: true,
            };
          } catch {
            return { ...base, read: false };
          }
        },
      ),
    );
    setHbcfExtracting(false);

    const unread = readings.filter((reading) => !reading.read).length;
    const added: HbcfClaimDocument[] = readings.map((reading) => ({
      amountConfirmed: reading.amountConfirmed,
      certificateNumber: reading.certificateNumber,
      claimAmount: reading.claimAmount,
      coverStartDate: reading.coverStartDate,
      fileId: reading.fileId,
      fileName: reading.fileName,
      url: reading.url,
    }));
    const firstNumber =
      added.find((document) => document.certificateNumber)?.certificateNumber
      ?? null;

    if (unread === readings.length) {
      toast.error(
        "The HBCF documents were added, but could not be read. Enter the number and amounts manually.",
        { id: toastId },
      );
    } else if (unread > 0) {
      toast.warning(
        `${unread} of ${readings.length} documents could not be read. Enter their amounts manually.`,
        { id: toastId },
      );
    } else if (firstNumber || added.some((d) => d.claimAmount !== null)) {
      toast.success(
        "Read the HBCF documents. Check and confirm each claim amount.",
        { id: toastId },
      );
    } else {
      toast.warning(
        "No HBCF number or amount was found on the documents. Enter them manually.",
        { id: toastId },
      );
    }

    // The draft now, not the one this upload started from: OCR took a while,
    // and anything typed meanwhile must not be thrown away by this save.
    const latest = draftRef.current;
    const legal = (latest.legalAdministration ?? {}) as Record<string, unknown>;
    const previous = readHbcfClaimDocuments(
      legal as Parameters<typeof readHbcfClaimDocuments>[0],
    );
    const documents = appendHbcfClaimDocuments(previous, added);
    const currentNumber = (legal.hbcfInsuranceNumber as string | null) ?? null;
    const primary = documents[0];

    const nextDraft: RequirementsData = {
      ...latest,
      legalAdministration: {
        ...legal,
        // A number already on the project is the one quoted to iCare; an
        // additional document does not replace it.
        hbcfInsuranceNumber: currentNumber?.trim()
          ? currentNumber
          : firstNumber,
        hbcfClaimDocuments: documents,
        // The first document stays the one the compliance checklist reads.
        hbcfInsuranceDocument: primary
          ? {
              fileId: primary.fileId,
              fileName: primary.fileName,
              kind: "hbcfInsurance",
              url: primary.url,
            }
          : null,
      } as never,
    };

    editDraft(() => nextDraft);
    // Nothing below may act on documents that were not saved: no date prompt
    // and no compliance filing for a certificate the project does not hold.
    // The documents stay in the draft, so Save can retry them.
    if (!(await handleSave(nextDraft))) return;

    const datesOf = (list: readonly HbcfClaimDocument[]) =>
      [
        ...new Set(
          list
            .map((document) => document.coverStartDate)
            .filter((date): date is string => Boolean(date)),
        ),
      ].sort();
    const readDates = datesOf(added);
    if (!hasInsuranceClaimDates(nextDraft)) {
      // Every document on the claim, not just the new ones: a certificate
      // added earlier (when the prompt was skipped) may disagree with this one,
      // and suggesting the new date alone would hide that.
      const allDates = datesOf(documents);
      setCoverDatesPrompt({
        conflictingDates: allDates.length > 1 ? allDates : [],
        suggestedStartDate: allDates.length === 1 ? allDates[0] : null,
      });
    } else {
      const claimDate = hbcfClaimDate(
        nextDraft.legalAdministration as Parameters<typeof hbcfClaimDate>[0],
      );
      if (claimDate && readDates.some((date) => date !== claimDate)) {
        toast.warning(
          "A new HBCF document shows a different cover start date from the project's claim date. The claim date was not changed; check it under Legal & Administration.",
        );
      }
    }

    // The first certificate on the project is also filed on the compliance
    // checklist, which asks for home insurance too; without this the same PDF
    // had to be uploaded a second time over there. Additional documents are
    // not: the checklist line wants the certificate, not every claim.
    //
    // Only when an engagement exists to file it against, and never fatal: the
    // documents are already saved above.
    if (project.certifierEngagement && previous.length === 0 && primary) {
      try {
        await dispatch(
          uploadComplianceDocument({
            projectId: project.id,
            fileId: primary.fileId,
            documentType: ComplianceDocumentType.HOME_INSURANCE,
          }),
        ).unwrap();
      } catch (error) {
        console.error(
          "Saved the HBCF document, but could not file it on the compliance checklist",
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
    (legalAdministration?.hbcfInsuranceNumber as string | null | undefined)
    ?? null;
  const hbcfClaimDocuments = readHbcfClaimDocuments(
    legalAdministration as Parameters<typeof readHbcfClaimDocuments>[0],
  );
  const savedClaimDate = hbcfClaimDate(
    (project.requirements as RequirementsData | null)
      ?.legalAdministration as Parameters<typeof hbcfClaimDate>[0],
  );

  // The document half of Needs Attention, from the same rule the projects
  // list reads. The saved project, not the draft: an item clears when its fix
  // is saved, which is when it leaves the list too.
  const documentGaps = useMemo(() => {
    const savedLegal = (project.requirements as RequirementsData | null)
      ?.legalAdministration as
      | {
          signedDate?: string | null;
          pcaInspector?: string | null;
          hbcfInsuranceNumber?: string | null;
        }
      | undefined;
    return projectDocumentGaps({
      status: project.status,
      started: hasWorkStarted(project.milestones),
      legal: {
        signedDate: savedLegal?.signedDate,
        pcaInspector: savedLegal?.pcaInspector,
        hbcfInsuranceNumber: savedLegal?.hbcfInsuranceNumber,
      },
      heldDocuments: new Set(
        (project.certifierEngagement?.documents ?? [])
          .filter((document) => document.files.length > 0)
          .map((document) => document.documentType),
      ),
    });
  }, [
    project.requirements,
    project.status,
    project.milestones,
    project.certifierEngagement,
  ]);

  /**
   * Opens the section a field lives in, scrolls it into view and puts the
   * cursor in it. A collapsed section is given time to expand first, or the
   * browser scrolls to where the field will be before it is there.
   */
  const goToDocumentGap = (target: DocumentGapTarget) => {
    if (target.kind === "tab") {
      onOpenTab(target.tab);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const alreadyOpen = openSection === target.section;
    setOpenSection(target.section);
    window.setTimeout(
      () => {
        const element = document.getElementById(fieldAnchorId(target.field));
        if (!element) return;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        // Centred, so the sticky Save bar above the form does not cover it.
        element.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "center",
        });
        element
          .querySelector<HTMLElement>("input, textarea, button")
          ?.focus({ preventScroll: true });
      },
      alreadyOpen ? 0 : 250,
    );
  };

  // Header chips and the compliance banner deep-link here via
  // `#legalAdministration` (a section) or `#document-attention` (the panel).
  // Re-apply on hashchange too — a click while already on Overview used to
  // leave the accordion closed because `params` (the only prior dependency)
  // does not change for a same-route hash nav.
  useEffect(() => {
    const applyHash = () => {
      const target = window.location.hash.slice(1);
      if (!target) return;
      // Only a section opens; the panel's id must not collapse the one open.
      if (target in SECTION_META) setOpenSection(target);
      // Wait a tick for the accordion to expand before scrolling, otherwise
      // the browser lands on a collapsed header and the fields stay off-screen.
      window.setTimeout(() => {
        document.getElementById(target)?.scrollIntoView({
          behavior: "smooth",
          block: target === DOCUMENT_ATTENTION_ID ? "center" : "start",
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
      {/* Card clips its children by default, which made the header's
          `sticky` a no-op: it stuck inside a box that never scrolls. Unclipped,
          Save stays on screen down a form several screens long. */}
      <Card className="overflow-visible border-border/70 bg-card pt-0 shadow-sm">
        <CardHeader className="sticky top-(--topbar-h) z-20 flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card px-4 pt-3 shadow-sm [.border-b]:pb-3 sm:gap-3 sm:px-6 sm:pt-4 sm:[.border-b]:pb-4">
          <div className="min-w-0 flex-1">
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
            <p className="mt-1 hidden text-sm text-muted-foreground md:block">
              Extracted from the tender and contract documents.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
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
              onClick={requestSave}
              disabled={!dirty || saving}
              aria-busy={saving}
            >
              {saving ? (
                "Saving…"
              ) : (
                <>
                  <span className="sm:hidden">Save</span>
                  <span className="hidden sm:inline">Save changes</span>
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 px-4 pt-4 sm:px-6 sm:pt-5">
          {/* First on the tab: what is keeping this job in Needs attention,
              and where each one is fixed. */}
          <DocumentAttentionPanel
            gaps={documentGaps}
            hasComplianceFile={project.certifierEngagement !== null}
            unsaved={dirty}
            onGo={goToDocumentGap}
          />

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
            <StartDateField
              projectId={project.id}
              value={project.startDate}
              milestones={project.milestones}
              locked={hasWorkStarted(project.milestones)}
              claimDate={savedClaimDate}
              // The header and the milestone tab read the store, not this
              // tab, so the saved project goes back there.
              onSaved={(saved) => dispatch(setActiveProject(saved))}
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
                  className="rounded-xl border border-border bg-card px-3 sm:px-4"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 pr-1 text-left sm:gap-3 sm:pr-3">
                      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:flex">
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
                  <AccordionContent className="space-y-4 pb-4 pt-1 md:max-h-[75vh] md:overflow-y-auto">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {SECTION_FIELDS[key].map((config) => (
                        <div
                          key={config.key}
                          id={fieldAnchorId(config.key)}
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
                      // The number input is the block's first control, which
                      // is what the attention panel's "Go to HBCF number"
                      // focuses.
                      <div id={fieldAnchorId("hbcfInsuranceNumber")}>
                        <HbcfClaimsBlock
                          projectId={project.id}
                          insuranceNumber={hbcfInsuranceNumber}
                          documents={hbcfClaimDocuments}
                          claimDate={hbcfClaimDate(
                            legalAdministration as Parameters<
                              typeof hbcfClaimDate
                            >[0],
                          )}
                          extracting={hbcfExtracting}
                          canRemove={isAdmin}
                          onNumberChange={(value) =>
                            updateSectionField(
                              "legalAdministration",
                              "hbcfInsuranceNumber",
                              value,
                            )
                          }
                          onDocumentsChange={(documents) => {
                            const primary = documents[0];
                            editDraft((current) => ({
                              ...current,
                              legalAdministration: {
                                ...(current.legalAdministration as object),
                                hbcfClaimDocuments: documents,
                                hbcfInsuranceDocument: primary
                                  ? {
                                      fileId: primary.fileId,
                                      fileName: primary.fileName,
                                      kind: "hbcfInsurance",
                                      url: primary.url,
                                    }
                                  : null,
                              } as never,
                            }));
                          }}
                          onUpload={handleHbcfUpload}
                        />
                      </div>
                    ) : null}

                    {key === "commercialsAndClaims" ? (
                      <PaymentStagesTable
                        stages={
                          (sectionData.paymentStages as ProjectPaymentStage[])
                          ?? []
                        }
                        onChange={updatePaymentStages}
                      />
                    ) : null}

                    {key === "inclusionsAndExclusions" ? (
                      <div className="grid gap-4 rounded-xl border border-border bg-muted/40 p-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <h5 className="flex items-center text-sm font-medium text-foreground">
                            <Check
                              aria-hidden="true"
                              className="mr-1 h-3 w-3 shrink-0 text-success-ink"
                            />
                            Inclusions
                          </h5>
                          <TagListControl
                            label="Inclusions"
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
                        </div>
                        <div className="space-y-2">
                          <h5 className="flex items-center text-sm font-medium text-foreground">
                            <AlertTriangle
                              aria-hidden="true"
                              className="mr-1 h-3 w-3 shrink-0 text-warning-ink"
                            />
                            Exclusions
                          </h5>
                          <TagListControl
                            label="Exclusions"
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

      <AlertDialog
        open={claimDateConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setClaimDateConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {claimDateConfirm
                ? `Move the start date to ${format(parse(claimDateConfirm.claimDate, "yyyy-MM-dd", new Date()), "d MMM yyyy")}?`
                : "Move the start date?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  The project start date follows the HBCF claim date, so saving
                  this claim date moves it
                  {project.milestones.length > 0
                    ? ` and reschedules all ${project.milestones.length} milestone target dates from it`
                    : ""}
                  .
                </p>
                <p>
                  Any target date set by hand is replaced. It cannot be undone
                  from here.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              aria-busy={saving}
              onClick={(event) => {
                // Stay open until the save answers, so a failure is not
                // mistaken for a dialog that simply closed.
                event.preventDefault();
                // Closed only once saved; a failure leaves it open to retry.
                void handleSave().then((saved) => {
                  if (saved) setClaimDateConfirm(null);
                });
              }}
            >
              {saving ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : null}
              {saving ? "Saving…" : "Save and move start date"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {coverDatesPrompt ? (
        <HbcfCoverDatesDialog
          open
          suggestedStartDate={coverDatesPrompt.suggestedStartDate}
          conflictingDates={coverDatesPrompt.conflictingDates}
          // The rule `planStartDateFromHbcfClaim` applies on the server: once
          // an activity has started, the start date stays where it is.
          startDateHeld={hasWorkStarted(project.milestones)}
          rescheduleCount={
            hasWorkStarted(project.milestones) ? 0 : project.milestones.length
          }
          onSkip={() => setCoverDatesPrompt(null)}
          onConfirm={async (dates) => {
            const nextDraft: RequirementsData = {
              ...draft,
              legalAdministration: {
                ...(draft.legalAdministration as object),
                ...dates,
              } as never,
            };
            editDraft(() => nextDraft);
            // Rejecting keeps the dialog open with its own error line.
            if (!(await handleSave(nextDraft))) {
              throw new Error("The cover dates were not saved. Try again.");
            }
            setCoverDatesPrompt(null);
          }}
        />
      ) : null}
    </section>
  );
}
