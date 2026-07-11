"use client";

import { useMemo, useState } from "react";
import type { ProjectDetail } from "@/types/project";
import type {
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/utils/fetch";
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
  Building2,
  Fan,
  Paintbrush,
  ShieldAlert,
  Plug,
  Droplets,
  HardHat,
} from "lucide-react";

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
  | "boolean";

interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  span?: 1 | 2;
}

const SECTION_META: Record<
  ProjectFlowSectionKey,
  { label: string; description: string; icon: React.ElementType }
> = {
  legalAdministration: {
    label: "Legal and Administration",
    description: "Site details, ownership and sign-off",
    icon: ScrollText,
  },
  commercialsAndClaims: {
    label: "Commercials and Claims",
    description: "Contract sum, GST and payment schedule",
    icon: Landmark,
  },
  subStructureAndGround: {
    label: "Sub Structure and Ground",
    description: "Slab, termite and drainage specification",
    icon: Layers,
  },
  shellAndExternal: {
    label: "Shell and External",
    description: "Ceilings, roofing, brick and window allowances",
    icon: Building2,
  },
  mechanicalDetails: {
    label: "Mechanical Details",
    description: "Air conditioning, lighting and power",
    icon: Fan,
  },
  internalFitOutAndFinishes: {
    label: "Internal Fit Out and Finishes",
    description: "Doors, stone, tiles and tapware",
    icon: Paintbrush,
  },
  exclusionsAndRisks: {
    label: "Exclusions and Risks",
    description: "Items excluded, owner risk and variation triggers",
    icon: ShieldAlert,
  },
  utilityInfrastructure: {
    label: "Utility Infrastructure",
    description: "Electrical, gas and comms provisioning",
    icon: Plug,
  },
  wetAreaCompliance: {
    label: "Wet Area Compliance",
    description: "Waterproofing and shower compliance",
    icon: Droplets,
  },
  safetyAndSiteLogistics: {
    label: "Safety and Site Logistics",
    description: "Site safety, sediment control and clean-up",
    icon: HardHat,
  },
};

const SECTION_FIELDS: Record<ProjectFlowSectionKey, FieldConfig[]> = {
  legalAdministration: [
    { key: "siteAddress", label: "Site Address", type: "textarea", span: 2 },
    { key: "commencementTrigger", label: "Commencement Trigger", type: "text" },
    { key: "signedDate", label: "Signed Date", type: "text" },
    { key: "pcaInspector", label: "PCA Inspector", type: "text" },
  ],
  commercialsAndClaims: [
    { key: "totalContractSum", label: "Total Contract Sum", type: "currency" },
    { key: "tenderTotalPrice", label: "Tender Total Price", type: "currency" },
    { key: "contractPrice", label: "Contract Price", type: "currency" },
    { key: "gstIncluded", label: "GST Included", type: "boolean" },
    { key: "gstAmount", label: "GST Amount", type: "currency" },
    { key: "depositValue", label: "Deposit Value", type: "currency" },
    {
      key: "claimStageSlabPercentage",
      label: "Slab Claim Stage",
      type: "percent",
    },
    {
      key: "claimStageSlabDollarValue",
      label: "Slab Claim Value",
      type: "currency",
    },
    {
      key: "variationAdminFee",
      label: "Variation Admin Fee",
      type: "currency",
    },
    { key: "latePenaltyRate", label: "Late Penalty Rate", type: "percent" },
  ],
  subStructureAndGround: [
    { key: "concreteSlabClass", label: "Concrete Slab Class", type: "text" },
    {
      key: "concreteStrengthMpa",
      label: "Concrete Strength",
      type: "number",
      unit: "MPa",
    },
    { key: "vapourBarrier", label: "Vapour Barrier", type: "text" },
    { key: "termiteSystem", label: "Termite System", type: "text" },
    { key: "sewerConnection", label: "Sewer Connection", type: "text" },
  ],
  shellAndExternal: [
    {
      key: "ceilingHeightGroundFloor",
      label: "Ceiling Height (Ground)",
      type: "text",
    },
    {
      key: "ceilingHeightFirstFloor",
      label: "Ceiling Height (First Floor)",
      type: "text",
    },
    { key: "roofingMaterial", label: "Roofing Material", type: "text" },
    { key: "brickAllowance", label: "Brick Allowance", type: "currency" },
    { key: "brickCount", label: "Brick Count", type: "number" },
    {
      key: "selectedBrickPrice",
      label: "Selected Brick Price",
      type: "currency",
    },
    { key: "windowProvider", label: "Window Provider", type: "text" },
    { key: "floorAreaM2", label: "Floor Area", type: "number", unit: "m²" },
  ],
  mechanicalDetails: [
    { key: "acSystemZones", label: "AC System Zones", type: "text" },
    {
      key: "acRequiredCapacityKw",
      label: "AC Required Capacity",
      type: "number",
      unit: "kW",
    },
    {
      key: "acInstalledCapacityKw",
      label: "AC Installed Capacity",
      type: "number",
      unit: "kW",
    },
    { key: "lightingCount", label: "Lighting Count", type: "number" },
    {
      key: "tenderLightingCount",
      label: "Tender Lighting Count",
      type: "number",
    },
    { key: "powerPointCount", label: "Power Point Count", type: "number" },
    { key: "externalPower", label: "External Power", type: "text" },
    { key: "jointSealants", label: "Joint Sealants", type: "text" },
  ],
  internalFitOutAndFinishes: [
    { key: "internalDoorHeight", label: "Internal Door Height", type: "text" },
    { key: "skirtingSize", label: "Skirting Size", type: "text" },
    { key: "stoneThickness", label: "Stone Thickness", type: "text" },
    { key: "waterfallEnds", label: "Waterfall Ends", type: "text" },
    { key: "tapwareFinish", label: "Tapware Finish", type: "text" },
    { key: "tilesProvisionRate", label: "Tiles Provision Rate", type: "text" },
    { key: "tileAllowance", label: "Tile Allowance", type: "currency" },
    {
      key: "selectedTilePrice",
      label: "Selected Tile Price",
      type: "currency",
    },
    {
      key: "wetAreaSizeM2",
      label: "Wet Area Size",
      type: "number",
      unit: "m²",
    },
  ],
  exclusionsAndRisks: [
    { key: "retainingWalls", label: "Retaining Walls", type: "text" },
    { key: "fencing", label: "Fencing", type: "text" },
    { key: "blinds", label: "Blinds", type: "text" },
    { key: "solarProvisions", label: "Solar Provisions", type: "text" },
    { key: "rockExcavation", label: "Rock Excavation", type: "text" },
  ],
  utilityInfrastructure: [
    { key: "electricalPhase", label: "Electrical Phase", type: "text" },
    {
      key: "communicationConduit",
      label: "Communication Conduit",
      type: "text",
    },
    { key: "gasConnection", label: "Gas Connection", type: "text" },
    { key: "fridgeWaterPoint", label: "Fridge Water Point", type: "text" },
    { key: "smartLockBrand", label: "Smart Lock Brand", type: "text" },
  ],
  wetAreaCompliance: [
    {
      key: "waterproofingStandard",
      label: "Waterproofing Standard",
      type: "text",
    },
    { key: "showerScreenType", label: "Shower Screen Type", type: "text" },
    { key: "tiledNicheCount", label: "Tiled Niche Count", type: "number" },
    { key: "showerCount", label: "Shower Count", type: "number" },
    {
      key: "floorToCeilingTiles",
      label: "Floor to Ceiling Tiles",
      type: "text",
    },
    { key: "floorWasteType", label: "Floor Waste Type", type: "text" },
  ],
  safetyAndSiteLogistics: [
    { key: "roofGuardrails", label: "Roof Guardrails", type: "text" },
    { key: "sedimentControl", label: "Sediment Control", type: "text" },
    { key: "scaffoldingSafety", label: "Scaffolding Safety", type: "text" },
    { key: "tradeWaste", label: "Trade Waste", type: "text" },
    { key: "finalCleanStatus", label: "Final Clean Status", type: "text" },
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

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

// ---------------------------------------------------------------------------
// Reusable field primitives
// ---------------------------------------------------------------------------

function FieldShell({
  label,
  unit,
  children,
}: {
  label: string;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
  return (
    <FieldShell label={label}>
      {multiline ? (
        <Textarea
          value={displayValue(value)}
          onChange={(e) => onChange(emptyToNull(e.target.value))}
          placeholder="Not specified"
          className="min-h-20 resize-none rounded-lg border-slate-200 bg-white text-sm"
        />
      ) : (
        <Input
          value={displayValue(value)}
          onChange={(e) => onChange(emptyToNull(e.target.value))}
          placeholder="Not specified"
          className="h-9 rounded-lg border-slate-200 bg-white text-sm"
        />
      )}
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
  return (
    <FieldShell label={label} unit={unit}>
      <Input
        type="number"
        value={displayValue(value)}
        onChange={(e) => onChange(parseNumber(e.target.value))}
        placeholder="—"
        className="h-9 rounded-lg border-slate-200 bg-white text-sm"
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
  return (
    <FieldShell label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
          $
        </span>
        <Input
          type="number"
          value={displayValue(value)}
          onChange={(e) => onChange(parseNumber(e.target.value))}
          placeholder="0.00"
          className="h-9 rounded-lg border-slate-200 bg-white pl-6 text-sm"
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
  return (
    <FieldShell label={label}>
      <div className="relative">
        <Input
          type="number"
          value={displayValue(value)}
          onChange={(e) => onChange(parseNumber(e.target.value))}
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

function BooleanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: boolean | null) => void;
}) {
  const current = value === true ? "true" : value === false ? "false" : "";
  return (
    <FieldShell label={label}>
      <select
        value={current}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "true")
        }
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
      >
        <option value="">Unknown</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
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

// Simple line-per-entry list editor, used for name/email/phone lists and exclusion lists.
function TagListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
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
// Section-specific composite blocks
// ---------------------------------------------------------------------------

function OwnerContactsBlock({
  names,
  emails,
  phones,
  onChange,
}: {
  names: string[];
  emails: string[];
  phones: string[];
  onChange: (field: "names" | "emails" | "phones", values: string[]) => void;
}) {
  return (
    <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-3">
      <TagListField
        label="Owner Names"
        values={names}
        onChange={(v) => onChange("names", v)}
      />
      <TagListField
        label="Owner Emails"
        values={emails}
        onChange={(v) => onChange("emails", v)}
      />
      <TagListField
        label="Owner Phones"
        values={phones}
        onChange={(v) => onChange("phones", v)}
      />
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
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Payment Stages</p>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"
        >
          {stages.length} stage{stages.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {stages.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-[1fr_100px_120px_32px] gap-2 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <span>Label</span>
            <span>Percent</span>
            <span>Amount</span>
            <span />
          </div>
          <div className="divide-y divide-slate-100">
            {stages.map((stage, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_100px_120px_32px] items-center gap-2 px-3 py-2"
              >
                <Input
                  value={stage.label ?? ""}
                  onChange={(e) => updateRow(index, { label: e.target.value })}
                  placeholder="Stage label"
                  className="h-8 rounded-md border-slate-200 bg-white text-sm"
                />
                <div className="relative">
                  <Input
                    type="number"
                    value={displayValue(stage.percentage)}
                    onChange={(e) =>
                      updateRow(index, {
                        percentage: parseNumber(e.target.value),
                      })
                    }
                    placeholder="0"
                    className="h-8 rounded-md border-slate-200 bg-white pr-5 text-sm"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    %
                  </span>
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    $
                  </span>
                  <Input
                    type="number"
                    value={displayValue(stage.amount)}
                    onChange={(e) =>
                      updateRow(index, { amount: parseNumber(e.target.value) })
                    }
                    placeholder="0.00"
                    className="h-8 rounded-md border-slate-200 bg-white pl-5 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Remove stage"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-sm text-slate-400">
          No payment stages recorded
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        className="gap-1.5 rounded-lg border-slate-200 text-slate-600"
      >
        <Plus className="h-3.5 w-3.5" /> Add stage
      </Button>
    </div>
  );
}

function SourceDocumentCard({
  kind,
  fileName,
  url,
  onChange,
}: {
  kind: "Tender" | "Contract";
  fileName: string;
  url: string;
  onChange: (field: "fileName" | "url", value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">
            {kind} Document
          </span>
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"
          >
            Open <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      <Input
        value={fileName}
        onChange={(e) => onChange("fileName", e.target.value)}
        placeholder="File name"
        className="h-9 rounded-lg border-slate-200 bg-white text-sm"
      />
      <Input
        value={url}
        onChange={(e) => onChange("url", e.target.value)}
        placeholder="File URL"
        className="h-9 rounded-lg border-slate-200 bg-white text-sm"
      />
    </div>
  );
}

function AutomationToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition-colors",
        checked ? "border-teal-200 bg-teal-50/60" : "border-slate-200 bg-white",
      )}
    >
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-400">{description}</p>
      </div>
      <span
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-teal-600" : "bg-slate-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

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
      ? "text-red-600 bg-red-50 border-red-100"
      : validation.severity === "warning"
        ? "text-amber-700 bg-amber-50 border-amber-100"
        : "text-slate-600 bg-slate-50 border-slate-100";

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm",
        tone,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-0.5">
        <p>{validation.message}</p>
        {validation.ownerResponsibility || validation.variationRequired ? (
          <p className="text-xs uppercase tracking-wide opacity-70">
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

function ConflictRow({ conflict }: { conflict: ProjectConflictResult }) {
  return (
    <div className="space-y-2 rounded-lg border border-orange-100 bg-orange-50/60 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-700">{conflict.fieldPath}</span>
        <Badge
          variant="outline"
          className="rounded-full border-orange-200 bg-white text-[10px] uppercase tracking-wide text-orange-700"
        >
          {conflict.resolution.replace(/-/g, " ")}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
        <div>
          <p className="font-semibold uppercase tracking-wide text-slate-400">
            Tender
          </p>
          <p className="text-slate-700">
            {displayValue(conflict.tenderValue) || "—"}
          </p>
        </div>
        <div>
          <p className="font-semibold uppercase tracking-wide text-slate-400">
            Contract
          </p>
          <p className="text-slate-700">
            {displayValue(conflict.contractValue) || "—"}
          </p>
        </div>
        <div>
          <p className="font-semibold uppercase tracking-wide text-slate-400">
            Resolved
          </p>
          <p className="text-slate-700">
            {displayValue(conflict.resolvedValue) || "—"}
          </p>
        </div>
      </div>
      {conflict.note ? (
        <p className="text-xs text-slate-500">{conflict.note}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectOverviewTab({ project }: { project: ProjectDetail }) {
  const initialRequirements = (project.requirements ?? {}) as RequirementsData;
  const [draft, setDraft] = useState<RequirementsData>(initialRequirements);
  const [saving, setSaving] = useState(false);

  const sectionKeys = useMemo(
    () => Object.keys(SECTION_META) as ProjectFlowSectionKey[],
    [],
  );

  const validations = draft.validations ?? [];
  const conflicts = draft.conflicts ?? [];
  const failCount = validations.filter((v) => v.severity === "fail").length;
  const warnCount = validations.filter((v) => v.severity === "warning").length;

  const updateSectionField = (
    section: ProjectFlowSectionKey,
    field: string,
    value: unknown,
  ) => {
    setDraft((current) => ({
      ...current,
      [section]: { ...(current[section] as object), [field]: value },
    }));
  };

  const updateOwnerContacts = (
    field: "names" | "emails" | "phones",
    values: string[],
  ) => {
    setDraft((current) => {
      const legal = (current.legalAdministration ?? {}) as Record<
        string,
        unknown
      >;
      const ownerContacts = (legal.ownerContacts as Record<
        string,
        unknown
      >) ?? { names: [], emails: [], phones: [] };
      return {
        ...current,
        legalAdministration: {
          ...legal,
          ownerContacts: { ...ownerContacts, [field]: values },
        } as never,
      };
    });
  };

  const updatePaymentStages = (stages: ProjectPaymentStage[]) => {
    setDraft((current) => ({
      ...current,
      commercialsAndClaims: {
        ...(current.commercialsAndClaims as object),
        paymentStages: stages,
      } as never,
    }));
  };

  const updateExclusionsList = (
    field: "ownerResponsibility" | "variationRequired",
    values: string[],
  ) => {
    updateSectionField("exclusionsAndRisks", field, values);
  };

  const updateSourceDocument = (
    kind: "tender" | "contract",
    field: "fileName" | "url",
    value: string,
  ) => {
    setDraft((current) => {
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

  const updateAutomationTrigger = (
    field: "orderReminders" | "rainDelayCalculations" | "noticeCountdowns",
    value: boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      automationTriggers: {
        ...(current.automationTriggers ?? {}),
        [field]: value,
      } as never,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetchJson<ProjectDetail>(
        `/api/projects/${project.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requirements: draft }),
        },
        "Unable to update project",
      );
      toast.success("Project sections updated");
      setDraft((response.data.requirements ?? draft) as RequirementsData);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update project",
      );
    } finally {
      setSaving(false);
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
  const automation = draft.automationTriggers ?? {
    orderReminders: false,
    rainDelayCalculations: false,
    noticeCountdowns: false,
  };
  const ownerContacts = (
    draft.legalAdministration as Record<string, unknown> | undefined
  )?.ownerContacts as
    | { names?: string[]; emails?: string[]; phones?: string[] }
    | undefined;

  return (
    <section className="space-y-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <CardTitle className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Project Information
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Extracted from the tender and contract documents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {failCount > 0 ? (
              <Badge className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">
                {failCount} issue{failCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
            {warnCount > 0 ? (
              <Badge className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                {warnCount} warning{warnCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
            <Button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-teal-600 text-white hover:bg-teal-700"
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          {/* Overview fields */}
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label="Project Name"
              value={draft.projectName}
              onChange={(v) =>
                setDraft((c) => ({ ...c, projectName: v ?? "" }))
              }
            />
            <TextField
              label="Project Type"
              value={draft.projectType}
              onChange={(v) =>
                setDraft((c) => ({ ...c, projectType: v ?? "" }))
              }
            />
            <FieldShell label="Version">
              <p className="flex h-9 items-center rounded-lg border border-slate-100 bg-slate-50 px-3 text-sm text-slate-500">
                v{draft.version ?? 1}
              </p>
            </FieldShell>
          </div>
          <TextField
            label="Summary"
            value={draft.summary}
            onChange={(v) => setDraft((c) => ({ ...c, summary: v ?? "" }))}
            multiline
          />

          {/* Source documents */}
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

          {/* Automation triggers */}
          <div className="grid gap-3 md:grid-cols-3">
            <AutomationToggle
              label="Order Reminders"
              description="Notify when material orders are due"
              checked={Boolean(automation.orderReminders)}
              onChange={(v) => updateAutomationTrigger("orderReminders", v)}
            />
            <AutomationToggle
              label="Notice Countdowns"
              description="Track contractual notice periods"
              checked={Boolean(automation.noticeCountdowns)}
              onChange={(v) => updateAutomationTrigger("noticeCountdowns", v)}
            />
            <AutomationToggle
              label="Rain Delay Calculations"
              description="Auto-extend dates for weather delays"
              checked={Boolean(automation.rainDelayCalculations)}
              onChange={(v) =>
                updateAutomationTrigger("rainDelayCalculations", v)
              }
            />
          </div>

          {/* Conflicts */}
          {conflicts.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Conflicts Between Tender and Contract
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
          <Accordion type="single" className="space-y-2">
            {sectionKeys.map((key) => {
              const meta = SECTION_META[key];
              const Icon = meta.icon;
              const sectionData = (draft[key] as unknown as Record<string, unknown>) ?? {};
              const sectionValidations = validations.filter(
                (v) => v.section === key,
              );
              const sectionFailCount = sectionValidations.filter(
                (v) => v.severity === "fail",
              ).length;

              return (
                <AccordionItem
                  key={key}
                  value={key}
                  className="rounded-xl border border-slate-200 bg-white px-4"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-3 text-left">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-slate-700">
                            {meta.label}
                          </p>
                          <p className="text-xs text-slate-400">
                            {meta.description}
                          </p>
                        </div>
                      </div>
                      {sectionFailCount > 0 ? (
                        <Badge className="rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-100">
                          {sectionFailCount} issue
                          {sectionFailCount === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pb-4 pt-1 overflow-y-auto max-h-[75vh] no-scrollbar">
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
                        onChange={updateOwnerContacts}
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

                    {key === "exclusionsAndRisks" ? (
                      <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2">
                        <TagListField
                          label="Owner Responsibility"
                          values={
                            (sectionData.ownerResponsibility as string[]) ?? []
                          }
                          onChange={(v) =>
                            updateExclusionsList("ownerResponsibility", v)
                          }
                        />
                        <TagListField
                          label="Variation Required"
                          values={
                            (sectionData.variationRequired as string[]) ?? []
                          }
                          onChange={(v) =>
                            updateExclusionsList("variationRequired", v)
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
