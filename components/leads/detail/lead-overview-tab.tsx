"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BadgeDollarSign,
  CircleAlert,
  Loader2,
  Signpost,
  UserRound,
  Users,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { rebaseTrackedFields } from "@/lib/leads/lead-form-sync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BUDGET_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  stageGroupsFor,
  closureReasonCopy,
  parseLikelihood,
  isLostStage,
  leadToFormData,
  type LeadDetailFormData,
} from "@/lib/leads/lead-helpers";
import { updateLead } from "@/lib/leads/leads-service";
import { formatFyQuarter, fyQuarterOf } from "@/lib/leads/fy-quarter";
import { stageDef } from "@/lib/leads/pipeline-stages";
import type { Lead, LeadSource, LeadStage } from "@/lib/leads/types";
import { stageToPrismaMap } from "@/types/lead";
import { currency } from "@/utils/formatters";
import { cn } from "@/lib/utils";

const FIELD_LABEL_CLASS = "gap-1 text-xs font-medium text-muted-foreground";
const FIELD_CONTROL_CLASS = "h-9 rounded-lg bg-card text-sm";

/* ── Section definitions ──────────────────────────────────────────────── */

type LeadSectionKey =
  | "contact"
  | "sourceStage"
  | "assignedBudget"
  | "dealEconomics"
  | "lostReason";

const SECTION_ORDER: LeadSectionKey[] = [
  "contact",
  "sourceStage",
  "assignedBudget",
  "dealEconomics",
  "lostReason",
];

const SECTION_META: Record<
  LeadSectionKey,
  { label: string; description: string; icon: React.ElementType }
> = {
  contact: {
    label: "Contact fields",
    description: "Primary and secondary client details",
    icon: UserRound,
  },
  sourceStage: {
    label: "Source and stage details",
    description: "Where the lead came from and where it sits in the pipeline",
    icon: Signpost,
  },
  assignedBudget: {
    label: "Assigned and budget",
    description: "Owner and the budget discussed with the client",
    icon: Users,
  },
  dealEconomics: {
    label: "Deal economics",
    description: "Deal value, likelihood and expected close",
    icon: BadgeDollarSign,
  },
  lostReason: {
    // Static because SECTION_META is module-scope; the field's own label is
    // stage-aware via closureReasonCopy, which is what the user reads.
    label: "Closure reason",
    description: "Why this lead did not convert",
    icon: CircleAlert,
  },
};

/**
 * The form fields each section owns. Dirty state, the save payload and the
 * post-save baseline reset are all derived from this one list, so a field can
 * never be editable in a section that does not save it.
 */
const SECTION_FIELDS: Record<
  LeadSectionKey,
  readonly (keyof LeadDetailFormData)[]
> = {
  contact: [
    "name",
    "phone",
    "email",
    "location",
    "secondaryName",
    "secondaryPhone",
    "secondaryEmail",
  ],
  sourceStage: ["sourceDetail", "stage", "urgent"],
  assignedBudget: ["assignedId", "budget"],
  dealEconomics: [
    "estimatedValue",
    "estimatedValueSource",
    "probabilityOverride",
    "expectedCloseDate",
    "estimatedStartDate",
  ],
  lostReason: ["lostReason"],
};

/**
 * Every field the sections read for dirtiness or write on save.
 *
 * All primitives, deliberately: `type`, `notesDoc` and `annotationsToCreate`
 * are on LeadDetailFormData but belong to no section, so identity comparison is
 * a sound test of "did the operator touch this" for everything listed here.
 */
const TRACKED_FIELDS: readonly (keyof LeadDetailFormData)[] = Array.from(
  new Set(Object.values(SECTION_FIELDS).flat()),
);

/* ── Payload + validation ─────────────────────────────────────────────── */

type SectionPayload = Parameters<typeof updateLead>[1];

/**
 * Clamp and round at the source. The likelihood input is free-typed, so 150 or
 * 79.6 would otherwise fail Zod's int 0-100 rule and reject the whole save
 * behind a generic toast that names no field.
 */
// Was a local clamp with `Number(value) || 0`, which turned an unparseable
// typo into a real 0% forecast and silently zeroed the deal's weighted
// contribution. parseLikelihood treats unparseable as "no override" and is
// shared with the save path, so preview and persistence cannot disagree.

function buildSectionPayload(
  key: LeadSectionKey,
  form: LeadDetailFormData,
): SectionPayload {
  switch (key) {
    case "contact":
      return {
        name: form.name,
        phone: form.phone,
        email: form.email,
        location: form.location,
        secondaryName: form.secondaryName || null,
        secondaryEmail: form.secondaryEmail || null,
        secondaryPhone: form.secondaryPhone || null,
      };

    case "sourceStage":
      return {
        source: form.sourceDetail,
        sourceDetail: form.sourceDetail,
        stage: form.stage,
        urgent: form.urgent,
        // Stage and lost reason are one decision even though they live in two
        // sections: moving out of a lost stage has to clear the reason in the
        // same write, exactly as the modal's single save did.
        lostReason: isLostStage(form.stage) ? form.lostReason : "",
      };

    case "assignedBudget":
      return {
        assignedId: form.assignedId || null,
        budget: form.budget,
      };

    case "dealEconomics":
      return {
        estimatedValue: form.estimatedValue === "" ? null : form.estimatedValue,
        estimatedValueSource: form.estimatedValueSource,
        probabilityOverride: parseLikelihood(form.probabilityOverride),
        expectedCloseDate: form.expectedCloseDate || null,
        estimatedStartDate: form.estimatedStartDate || null,
      };

    case "lostReason":
      return { lostReason: form.lostReason };
  }
}

/** Returns the message to show, or `null` when the section may be saved. */
function validateSection(
  key: LeadSectionKey,
  form: LeadDetailFormData,
): string | null {
  switch (key) {
    case "contact": {
      if (!form.name.trim()) return "Enter the primary client's name.";
      // The API treats a lead email as required-when-present (#110), so an
      // empty or malformed value is rejected server-side; say so here instead.
      if (!form.email.trim()) return "Enter the primary client's email.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
        return "Enter a valid email address.";
      return null;
    }

    case "sourceStage":
      // Same guard the modal used before every update, applied at the point the
      // stage actually changes.
      return isLostStage(form.stage) && !form.lostReason.trim()
        ? `Add a lost reason before moving this lead to ${form.stage}.`
        : null;

    case "dealEconomics": {
      if (form.estimatedValue !== "") {
        const value = Number(form.estimatedValue);
        if (!Number.isFinite(value) || value < 0)
          return "Deal value must be a non-negative number.";
      }
      if (
        form.probabilityOverride !== ""
        && !Number.isFinite(Number(form.probabilityOverride))
      )
        return "Likelihood must be a number between 0 and 100.";
      return null;
    }

    case "lostReason":
      return isLostStage(form.stage) && !form.lostReason.trim()
        ? `Enter why this lead is ${form.stage.toLowerCase()}.`
        : null;

    default:
      return null;
  }
}

/* ── Component ────────────────────────────────────────────────────────── */

export function LeadOverviewTab({
  lead,
  availableUsers,
  onLeadUpdate,
}: {
  lead: Lead;
  availableUsers: { id: string; name: string }[];
  onLeadUpdate: (lead: Lead) => void;
}) {
  const formId = useId();
  const fieldId = (name: string) => `${formId}-${name}`;

  const baseline = useMemo(() => leadToFormData(lead), [lead]);
  const [form, setForm] = useState<LeadDetailFormData>(baseline);

  // The lead changes underneath this form, and the form has to follow it.
  //
  // The header badge writes the stage through its own updateLead call and the
  // page hands the new lead back down, so `baseline` moves — but `form` was
  // seeded once at mount and never did. The Source and stage section went on
  // showing the stage the page had loaded with, flagged itself `Unsaved`, and
  // offered a Save primed to write that stale stage back over the new one. On
  // staging that was a QUOTED lead with a Save that would have written
  // DISCOVERY: a silent two-stage regression for someone doing nothing worse
  // than tidying an `Unsaved` chip they did not create.
  //
  // Only untouched fields are adopted. A field the operator has actually edited
  // stays theirs, so a stage change elsewhere cannot discard half-typed work in
  // another section — the same rule handleSectionSave already follows when it
  // re-seeds just the fields a save wrote.
  //
  // Adjusted during render rather than in an effect. This is React's documented
  // pattern for state derived from props: the component re-renders before
  // committing, so the stale value is never painted.
  const [syncedBaseline, setSyncedBaseline] = useState(baseline);
  if (!Object.is(syncedBaseline, baseline)) {
    setSyncedBaseline(baseline);
    setForm((prev) =>
      rebaseTrackedFields(prev, syncedBaseline, baseline, TRACKED_FIELDS),
    );
  }
  const [savingSection, setSavingSection] = useState<LeadSectionKey | null>(
    null,
  );
  // Sections stay independently open — unlike the project accordion, which is
  // single-open, because a lead's stage and its lost reason are read together.
  const [openSections, setOpenSections] = useState<string[]>(["contact"]);

  const patch = (updates: Partial<LeadDetailFormData>) =>
    setForm((prev) => ({ ...prev, ...updates }));

  const isSectionDirty = (key: LeadSectionKey) =>
    SECTION_FIELDS[key].some(
      (field) => !Object.is(form[field], baseline[field]),
    );

  const handleSectionSave = async (key: LeadSectionKey) => {
    const message = validateSection(key, form);
    if (message) {
      toast.error(message);
      return;
    }

    setSavingSection(key);
    try {
      const updated = await updateLead(lead.id, buildSectionPayload(key, form));
      if (!updated) return;

      // Re-seed only what this save actually wrote, so a normalised value stops
      // reading as dirty while edits pending in other sections survive.
      const saved = leadToFormData(updated);
      const writtenFields: (keyof LeadDetailFormData)[] = [
        ...SECTION_FIELDS[key],
        // Sent by the stage-adjacent rules in buildSectionPayload rather than
        // by the section's own inputs.
        ...(key === "sourceStage" ? (["lostReason"] as const) : []),
      ];

      setForm((prev) => {
        const next = { ...prev };
        for (const field of writtenFields) {
          (next as Record<string, unknown>)[field] = saved[field];
        }
        return next;
      });

      onLeadUpdate(updated);
      toast.success(`${SECTION_META[key].label} saved`);
    } catch (error) {
      console.error(`Failed to save the ${key} section`, error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save this section. Please try again.",
      );
    } finally {
      setSavingSection(null);
    }
  };

  /* ── Deal economics derived values ─────────────────────────────────── */
  // form.stage is the UI label; the stage ladder is keyed by the Prisma enum.
  const stageProbability = stageDef(stageToPrismaMap[form.stage]).probability;

  const expectedCloseQuarter = useMemo(() => {
    if (!form.expectedCloseDate) return null;
    // Read the date as Sydney noon so the quarter matches what the forecast
    // computes — a bare YYYY-MM-DD parses as UTC midnight and can slip a day.
    const parsed = new Date(`${form.expectedCloseDate}T12:00:00+10:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    const { fy, quarter } = fyQuarterOf(parsed);
    return formatFyQuarter(fy, quarter);
  }, [form.expectedCloseDate]);

  const weightedPreview = useMemo(() => {
    const value = Number(form.estimatedValue);
    if (!form.estimatedValue || !Number.isFinite(value) || value <= 0)
      return null;
    // Same parse the save uses. null means "no override", which is exactly
    // what resolveProbability falls back on server-side — the stage default.
    const pct = parseLikelihood(form.probabilityOverride) ?? stageProbability;
    return {
      equation: `${currency.format(value)} × ${pct}%`,
      amount: currency.format((value * pct) / 100),
    };
  }, [form.estimatedValue, form.probabilityOverride, stageProbability]);

  const lostReasonRequired = isLostStage(form.stage);
  const lostReasonMissing = lostReasonRequired && !form.lostReason.trim();
  const lostReasonErrorId = fieldId("lost-reason-error");

  const renderSectionBody = (key: LeadSectionKey) => {
    switch (key) {
      case "contact":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Primary Client" htmlFor={fieldId("name")}>
              <Input
                id={fieldId("name")}
                className={FIELD_CONTROL_CLASS}
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                aria-invalid={!form.name.trim()}
              />
            </Field>
            <Field label="Phone" htmlFor={fieldId("phone")}>
              <Input
                id={fieldId("phone")}
                className={FIELD_CONTROL_CLASS}
                value={form.phone}
                onChange={(e) => patch({ phone: e.target.value })}
              />
            </Field>
            <Field label="Email" htmlFor={fieldId("email")}>
              <Input
                id={fieldId("email")}
                type="email"
                className={FIELD_CONTROL_CLASS}
                value={form.email}
                onChange={(e) => patch({ email: e.target.value })}
                aria-invalid={!form.email.trim()}
              />
            </Field>
            <Field label="Location" htmlFor={fieldId("location")}>
              <Input
                id={fieldId("location")}
                className={FIELD_CONTROL_CLASS}
                value={form.location}
                onChange={(e) => patch({ location: e.target.value })}
              />
            </Field>
            <Field label="Secondary Client" htmlFor={fieldId("secondary-name")}>
              <Input
                id={fieldId("secondary-name")}
                className={FIELD_CONTROL_CLASS}
                value={form.secondaryName}
                onChange={(e) => patch({ secondaryName: e.target.value })}
              />
            </Field>
            <Field label="Secondary Phone" htmlFor={fieldId("secondary-phone")}>
              <Input
                id={fieldId("secondary-phone")}
                className={FIELD_CONTROL_CLASS}
                value={form.secondaryPhone}
                onChange={(e) => patch({ secondaryPhone: e.target.value })}
              />
            </Field>
            <Field label="Secondary Email" htmlFor={fieldId("secondary-email")}>
              <Input
                id={fieldId("secondary-email")}
                type="email"
                className={FIELD_CONTROL_CLASS}
                value={form.secondaryEmail}
                onChange={(e) => patch({ secondaryEmail: e.target.value })}
              />
            </Field>
          </div>
        );

      case "sourceStage":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Source Detail" htmlFor={fieldId("source-detail")}>
              <Select
                value={form.sourceDetail}
                onValueChange={(value) =>
                  patch({ sourceDetail: value as LeadSource })
                }
              >
                <SelectTrigger
                  id={fieldId("source-detail")}
                  className={cn(FIELD_CONTROL_CLASS, "w-full")}
                >
                  <SelectValue placeholder="Select a source" />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Stage" htmlFor={fieldId("stage")}>
              <Select
                value={form.stage}
                onValueChange={(value) => {
                  const next = value as LeadStage;
                  // Keep the reason text in form state when moving to an open
                  // stage — buildSectionPayload already drops it from the
                  // payload, so clearing here only destroyed what the user
                  // typed. Cancellations get reversed often ("client came
                  // back") and a mis-click used to wipe the reason.
                  patch({ stage: next });
                  // The reason becomes mandatory the moment the stage does, so
                  // open its section rather than hiding the blocker.
                  if (isLostStage(next))
                    setOpenSections((prev) =>
                      prev.includes("lostReason")
                        ? prev
                        : [...prev, "lostReason"],
                    );
                }}
              >
                <SelectTrigger
                  id={fieldId("stage")}
                  className={cn(FIELD_CONTROL_CLASS, "w-full")}
                >
                  <SelectValue placeholder="Select a stage" />
                </SelectTrigger>
                <SelectContent>
                  {stageGroupsFor(form.stage).map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.stages.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="flex items-center gap-2 md:col-span-2">
              <Checkbox
                id={fieldId("urgent")}
                checked={form.urgent}
                onCheckedChange={(checked) =>
                  patch({ urgent: checked === true })
                }
              />
              <Label htmlFor={fieldId("urgent")} className={FIELD_LABEL_CLASS}>
                Urgent
              </Label>
            </div>
          </div>
        );

      case "assignedBudget":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Assigned To" htmlFor={fieldId("assigned-to")}>
              <Select
                value={form.assignedId || "unassigned"}
                onValueChange={(value) =>
                  patch({ assignedId: value === "unassigned" ? null : value })
                }
              >
                <SelectTrigger
                  id={fieldId("assigned-to")}
                  className={cn(FIELD_CONTROL_CLASS, "w-full")}
                >
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Budget discussed — rough note"
              htmlFor={fieldId("budget")}
            >
              <Select
                value={form.budget}
                onValueChange={(value) => patch({ budget: value })}
              >
                <SelectTrigger
                  id={fieldId("budget")}
                  className={cn(FIELD_CONTROL_CLASS, "w-full")}
                >
                  <SelectValue placeholder="Not Discussed" />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        );

      case "dealEconomics":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Deal value" htmlFor={fieldId("estimated-value")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={fieldId("estimated-value")}
                    type="number"
                    min={0}
                    step={1000}
                    className={FIELD_CONTROL_CLASS}
                    value={form.estimatedValue}
                    onChange={(e) =>
                      // Typing takes ownership: this lead stops following the
                      // offer price.
                      patch({
                        estimatedValue: e.target.value,
                        estimatedValueSource: "MANUAL",
                      })
                    }
                  />
                  {form.estimatedValueSource === "OFFER" ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
                      style={{
                        background: "var(--info-light)",
                        color: "var(--info-ink)",
                      }}
                    >
                      From offer
                    </span>
                  ) : null}
                </div>
              </Field>
              {form.estimatedValueSource === "MANUAL" ? (
                <button
                  type="button"
                  className="mt-1 text-xs underline"
                  onClick={() =>
                    // Clear only the ownership flag, never the figure. Nulling
                    // the value would drop this lead out of pipeline totals
                    // until someone happened to re-save the offer workspace.
                    patch({ estimatedValueSource: null })
                  }
                >
                  Follow the offer price again
                </button>
              ) : (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Follows the quoted contract price once an offer exists.
                </span>
              )}
            </div>

            <div>
              <Field label="Likelihood" htmlFor={fieldId("probability")}>
                <Input
                  id={fieldId("probability")}
                  type="number"
                  min={0}
                  max={100}
                  className={FIELD_CONTROL_CLASS}
                  // The stage default is the PLACEHOLDER, never the value —
                  // writing it in would silently convert every lead to a
                  // manual override.
                  placeholder={String(stageProbability)}
                  value={form.probabilityOverride}
                  onChange={(e) =>
                    patch({ probabilityOverride: e.target.value })
                  }
                />
              </Field>
              <span className="mt-1 block text-xs text-muted-foreground">
                {form.stage} default is {stageProbability}%
              </span>
            </div>

            <div>
              <Field label="Expected close" htmlFor={fieldId("expected-close")}>
                <Input
                  id={fieldId("expected-close")}
                  type="date"
                  className={FIELD_CONTROL_CLASS}
                  value={form.expectedCloseDate}
                  onChange={(e) => patch({ expectedCloseDate: e.target.value })}
                />
              </Field>
              {expectedCloseQuarter ? (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Lands in {expectedCloseQuarter}
                </span>
              ) : null}
            </div>

            <div>
              <Field
                label="Est. start date"
                htmlFor={fieldId("estimated-start")}
              >
                <Input
                  id={fieldId("estimated-start")}
                  type="date"
                  className={FIELD_CONTROL_CLASS}
                  value={form.estimatedStartDate}
                  onChange={(e) =>
                    patch({ estimatedStartDate: e.target.value })
                  }
                />
              </Field>
              <span className="mt-1 block text-xs text-muted-foreground">
                The date from which this lead enters HBCF capacity planning.
              </span>
            </div>

            {weightedPreview ? (
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2.5 text-xs md:col-span-2">
                <span>
                  Counts toward the forecast as{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {weightedPreview.equation}
                  </span>
                </span>
                <span className="font-heading text-lg font-semibold tabular-nums">
                  {weightedPreview.amount}
                </span>
              </div>
            ) : null}
          </div>
        );

      case "lostReason":
        // The modal only rendered this block for a lost stage. The section
        // itself always exists here so the sections are stable, but the
        // input stays behind the same condition.
        return lostReasonRequired ? (
          <div className="rounded-[8px] border border-(--destructive)/30 bg-destructive-light p-4">
            <Label
              htmlFor={fieldId("lost-reason")}
              className="text-sm font-medium text-destructive"
            >
              {closureReasonCopy(form.stage).label}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id={fieldId("lost-reason")}
              className={cn(
                "mt-1 bg-card",
                FIELD_CONTROL_CLASS,
                lostReasonMissing
                  && "border-destructive ring-1 ring-(--destructive)/20",
              )}
              placeholder={closureReasonCopy(form.stage).placeholder}
              value={form.lostReason}
              onChange={(e) => patch({ lostReason: e.target.value })}
              required
              aria-invalid={lostReasonMissing}
              aria-describedby={
                lostReasonMissing ? lostReasonErrorId : undefined
              }
            />
            {lostReasonMissing ? (
              <p
                id={lostReasonErrorId}
                className="mt-1.5 text-xs font-medium text-destructive"
              >
                Enter why this lead is {form.stage.toLowerCase()} before saving.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            A reason is only recorded once the stage is Lost, Cancelled or
            Disqualified. Change the stage in
            <span className="font-medium"> Source and stage details</span> to
            add one.
          </p>
        );
    }
  };

  return (
    <section className="space-y-4">
      <Card className="border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 px-4 pb-4 sm:px-6">
          <CardTitle
            as="h2"
            className="text-base font-semibold text-foreground"
          >
            Lead information
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Each section saves on its own. A Save button appears once that
            section has unsaved changes.
          </p>
        </CardHeader>

        <CardContent className="px-4 pt-4 sm:px-6 sm:pt-5">
          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="space-y-2"
          >
            {SECTION_ORDER.map((key) => {
              const meta = SECTION_META[key];
              const Icon = meta.icon;
              const dirty = isSectionDirty(key);
              const saving = savingSection === key;
              const saveButton = (className?: string) => (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleSectionSave(key)}
                  disabled={saving}
                  aria-busy={saving}
                  aria-label={`Save ${meta.label}`}
                  className={className}
                >
                  {saving ? (
                    <>
                      <Loader2
                        className="mr-1.5 size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                      Saving…
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              );

              return (
                <AccordionItem
                  key={key}
                  value={key}
                  className="rounded-xl border border-border bg-card px-3 sm:px-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 pr-1 sm:gap-3 sm:pr-3 text-left">
                          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                            <span className="hidden size-8 shrink-0 items-center sm:flex justify-center rounded-lg bg-muted text-muted-foreground">
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
                          {dirty ? (
                            <span className="rounded-full bg-warning-light px-2.5 py-0.5 text-xs font-medium text-warning-ink">
                              Unsaved
                            </span>
                          ) : null}
                        </div>
                      </AccordionTrigger>
                    </div>

                    {/* Sibling of the trigger, never nested inside it — a
                        button within a button is invalid and unreachable by
                        keyboard. Living here also means a dirty section can be
                        saved without expanding it. */}
                    {dirty ? saveButton() : null}
                  </div>

                  <AccordionContent className="space-y-4 pt-1 pb-4">
                    {renderSectionBody(key)}
                    {/* On a phone the header's Save has scrolled away by the
                        time the last field in a long section is filled in. */}
                    {dirty ? saveButton("w-full md:hidden") : null}
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

/* ── Field shell, matching the project detail form treatment ──────────── */

function Field({
  label,
  htmlFor,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
        {label}
      </Label>
      {children}
    </div>
  );
}
