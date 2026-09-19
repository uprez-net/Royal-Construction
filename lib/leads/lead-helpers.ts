import {
  HistoryItem,
  Lead,
  LeadSource,
  LeadStage,
  ProjectType,
  EmailTemplate,
  LeadNoteAnnotationInput,
  LeadRichTextDocument,
} from "@/lib/leads/types";
// import { FollowupCalendarCreation } from "@/lib/leads/leads-service";
import type { LeadStage as DBLeadStage } from "@prisma/client";
import { coerceLeadNotesDocument } from "@/lib/rich-text/lead-notes";
import { stageDef } from "@/lib/leads/pipeline-stages";
import { sydneyDateOnly, sydneyTimeOnly } from "@/lib/dates/sydney";
import { resolveLeadNotesTextOr } from "@/lib/leads/notes-text";

/* ── Constants ────────────────────────────────────────── */

export const PROJECT_TYPE_OPTIONS: ProjectType[] = [
  "Not Specified",
  "New Home",
  "Duplex",
  "Renovation",
  "Granny Flat",
  "Townhouse",
  "Dual Occupancy",
  "Single Storey",
  "Double Storey",
  "House and Granny",
  "Knockdown and rebuild",
  "House + land package",
];

export const LEAD_SOURCE_OPTIONS: LeadSource[] = [
  "Google Ads",
  "Referral",
  "Facebook Ads",
  "Walk-in",
  "Repeat Client",
  "Website",
  "Personal",
  "Business",
];

/**
 * The picker, in groups.
 *
 * "Closed" rather than "Disqualified" for the third group: Disqualified is one
 * of the three stages inside it, so reusing the word would leave people
 * guessing whether a filter meant the group or the stage.
 *
 * Meeting Scheduled and In Follow-up are gone. Both described a scheduled task
 * rather than progress, and completing one wrote CONTACTED, which is why 6 of
 * the 11 Contacted leads on production got there by having the work done
 * properly. They are tasks now, carried by followupDate and meetingDate.
 *
 * Won and Cancelled are gone too: nothing in any calculation could tell either
 * apart from Converted and Lost.
 */
export const LEAD_STAGE_GROUPS: { label: string; stages: LeadStage[] }[] = [
  {
    label: "Active",
    stages: [
      "New",
      "Contacted",
      "Discovery",
      "Qualified",
      "Quoted",
      "Negotiating",
    ],
  },
  { label: "Won", stages: ["Converted"] },
  // No Response has its own group because it does not behave like the two
  // below it. Its outcome is STALLED, not LOST: it counts in nothing, and
  // — unlike Disqualified and Lost — its tasks stay live and its reminders
  // keep firing, which is deliberate. A lead that stopped answering is
  // exactly the one carrying "call again in three months". Grouping it under
  // "Closed" made two neighbouring options behave differently with nothing
  // on screen to say so.
  { label: "Stalled", stages: ["No Response"] },
  { label: "Closed", stages: ["Disqualified", "Lost"] },
];

/** Flat order, for the filter chips and anything that wants one list. */
export const LEAD_STAGE_OPTIONS: LeadStage[] = LEAD_STAGE_GROUPS.flatMap(
  (g) => g.stages,
);

export const HISTORY_TYPE_OPTIONS: HistoryItem["type"][] = [
  "system",
  "call",
  "email",
  "referral",
];

export const BUDGET_OPTIONS = [
  "Not Discussed",
  "$200K - $350K",
  "$350K - $500K",
  "$500K - $700K",
  "$700K+",
];

export interface BudgetBracket {
  /** Lower bound, in dollars. */
  min: number;
  /**
   * Upper bound, in dollars. On the open-ended top bracket this is a display
   * cap chosen so a bar has something to fill against — it is NOT a real
   * ceiling, and `isOpenEnded` is what callers must branch on before labelling
   * it as one.
   */
  max: number;
  isOpenEnded: boolean;
}

/**
 * `Lead.budget` is a rough free-text note, not structured money — the column
 * holds a label such as "$350K - $500K" and the type permits arbitrary strings.
 * This is the only place that reads numbers out of those labels, and it is
 * deliberately a lookup rather than a regex: only the five options an operator
 * can actually pick are meaningful, and anything else (including
 * "Not Discussed", hand-typed text, and legacy values) has no defensible
 * numeric reading and returns null so the caller can hide the affordance
 * instead of inventing a range.
 *
 * `estimatedValue` remains the source of truth for money — see Lead in
 * lib/leads/types.ts. Treat a bracket as a fallback for display only.
 */
const BUDGET_BRACKETS: Record<string, BudgetBracket> = {
  "$200K - $350K": { min: 200_000, max: 350_000, isOpenEnded: false },
  "$350K - $500K": { min: 350_000, max: 500_000, isOpenEnded: false },
  "$500K - $700K": { min: 500_000, max: 700_000, isOpenEnded: false },
  "$700K+": { min: 700_000, max: 1_000_000, isOpenEnded: true },
};

export function budgetBracket(
  budget: string | null | undefined,
): BudgetBracket | null {
  if (!budget) return null;
  return BUDGET_BRACKETS[budget.trim()] ?? null;
}

/**
 * The stage list to render in a picker for a lead currently on `current`.
 *
 * LEAD_STAGE_OPTIONS hides Won and Cancelled, but a lead can still BE on one:
 * the header badge picker builds its own list from STAGE_STYLES and offers all
 * thirteen. Radix Select fills the trigger by portalling text out of the
 * MATCHING item, and its placeholder only covers "" and undefined — so a value
 * with no item renders the trigger completely blank, not even "Select a stage".
 *
 * Appending the current stage keeps that lead readable without making a hidden
 * stage newly selectable for anyone else.
 */
/**
 * The grouped picker for a lead currently on `current`.
 *
 * Same contract as stageOptionsFor: a lead sitting on a stage the groups do not
 * carry still gets an entry, so it renders and can keep what it has. Rows hold
 * the four retired stages until the data migration has run everywhere, and
 * Radix fills the trigger by portalling text out of the MATCHING item, so a
 * value with no item renders the trigger completely blank.
 */
export function stageGroupsFor(
  current: LeadStage,
): { label: string; stages: LeadStage[] }[] {
  if (LEAD_STAGE_OPTIONS.includes(current)) return LEAD_STAGE_GROUPS;
  return [...LEAD_STAGE_GROUPS, { label: "Retired", stages: [current] }];
}

export function stageOptionsFor(current: LeadStage): LeadStage[] {
  return LEAD_STAGE_OPTIONS.includes(current)
    ? LEAD_STAGE_OPTIONS
    : [...LEAD_STAGE_OPTIONS, current];
}

export const STAGE_STYLES: Record<LeadStage, string> = {
  New: "stage-badge-info",
  Contacted: "stage-badge-warning",
  Discovery: "stage-badge-info",
  Qualified: "stage-badge-purple",
  Quoted: "stage-badge-accent",
  Negotiating: "stage-badge-pink",
  Won: "stage-badge-success",
  Lost: "stage-badge-danger",
  "Meeting Scheduled": "stage-badge-info",
  "In Follow-up": "stage-badge-warning",
  "No Response": "stage-badge-danger",
  Converted: "stage-badge-success",
  Cancelled: "stage-badge-danger",
  Disqualified: "stage-badge-danger",
};

/* ── Types ────────────────────────────────────────────── */

export interface LeadDetailFormData {
  name: string;
  phone: string;
  email: string;
  location: string;
  secondaryName: string;
  secondaryEmail: string;
  secondaryPhone: string;
  sourceDetail: LeadSource;
  stage: LeadStage;
  assignedId?: string | null;
  assignedUser?: { id: string; name: string; email: string } | null;
  /** Free-text note only — `estimatedValue` is the source of truth for KPIs. */
  budget: string;
  /** Empty string means "not recorded"; the input is numeric text. */
  estimatedValue: string;
  estimatedValueSource: "OFFER" | "MANUAL" | null;
  /** Empty string means "inherit the stage default". */
  probabilityOverride: string;
  expectedCloseDate: string;
  type: ProjectType[];
  notes: string;
  notesDoc: LeadRichTextDocument;
  annotationsToCreate: LeadNoteAnnotationInput[];
  followupDate: string;
  followupTime: string;
  urgent: boolean;
  lostReason: string;
}

/* ── Formatting ───────────────────────────────────────── */

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatFollowup(
  date: string | null,
  time?: string | null,
): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}${time ? " " + time : ""}`;
}

export function formatLeadTaskDue(
  dueDate: string | null,
  dueTime?: string | null,
): string {
  if (!dueDate) return "No date";
  const label = new Date(dueDate).toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
  });
  return dueTime ? `${label} · ${dueTime}` : label;
}

export function sortLeadOpenTasks<
  T extends { id: number; dueDate: string | null; dueTime: string | null },
>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.dueDate === b.dueDate) {
      return (a.dueTime ?? "").localeCompare(b.dueTime ?? "") || a.id - b.id;
    }
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

export function formatShortDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

export function normalizeTypes(
  types: string | string[] | null | undefined,
): ProjectType[] {
  if (!types) return ["Not Specified"];
  if (Array.isArray(types))
    return types.length > 0 ? (types as ProjectType[]) : ["Not Specified"];
  const normalized = types
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return normalized.length > 0
    ? (normalized as ProjectType[])
    : ["Not Specified"];
}

export function dialablePhone(phone: string) {
  return phone.replace(/[^0-9+]/g, "");
}

/* ── Email helpers ────────────────────────────────────── */

const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;

/**
 * Placeholders that are a date or a time, and so can legitimately have no
 * value. Everything else in `values` carries its own sensible fallback.
 */
const DATE_PLACEHOLDERS = ["followup", "meeting", "time"] as const;

/**
 * Remove a placeholder that resolved to nothing, along with the word holding
 * it to the sentence.
 *
 * Substituting a filler string was the old approach and it read as a mistake
 * to the client: `{followup}` became the literal "next step", so the Meeting
 * subject went out as "Site visit for Jane - Kellyville on next step". Leaving
 * it empty instead is no better on its own — that ships "... Kellyville on "
 * with a dangling preposition.
 *
 * So the connector goes with it. Only the separators the shipped templates
 * actually use are recognised; anything else is left alone rather than guessed
 * at, which at worst leaves the sentence exactly as it reads today.
 */
export function dropEmptyPlaceholders(
  text: string,
  emptyKeys: readonly string[],
): string {
  return emptyKeys
    .reduce(
      (out, key) =>
        out.replace(
          new RegExp(
            `[ \\t]*(?:[-,:;]|\\b(?:on|at|by|for)\\b)?[ \\t]*\\{${key}\\}`,
            "gi",
          ),
          "",
        ),
      text,
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*[-,:;]$/, "")
    .trim();
}

/**
 * Replace `{placeholder}` tokens in a subject or body with this lead's values.
 *
 * Every value carries a sensible fallback except the dates, which can
 * legitimately be absent — a lead with no upcoming follow-up is the normal
 * state once the work is done, and a lead with no booked consultation is the
 * normal state before one. Those are removed along with the word holding them
 * to the sentence rather than filled with a stand-in; see
 * `dropEmptyPlaceholders`.
 *
 * An unknown key is left as-is (`{foo}` stays `{foo}`) so a typo in a template
 * is visible rather than silently blank.
 *
 * @param text - The template text, typically a subject line or rendered body.
 * @param lead - The lead whose values fill the placeholders.
 * @returns The text with placeholders resolved.
 */
export function hydrateVariable(text: string, lead: Lead): string {
  const typeStr = Array.isArray(lead.type)
    ? (lead.type[0] ?? "New Home Build")
    : lead.type;
  // Empty, not "next step". A lead with no upcoming follow-up is the normal
  // state once the work is done — see resolveFollowup — so this is a case to
  // render honestly, not to paper over.
  const followup = formatFollowup(lead.followupDate, lead.followupTime);
  // The booked consultation, which is a different appointment from the
  // follow-up. The Meeting subject quoted {followup} while its body confirmed
  // the site visit, so the two halves of one email disagreed.
  const meeting = formatFollowup(lead.meetingDate ?? null, lead.meetingTime);
  const source =
    lead.sourceDetail || lead.source || "Royal Constructions enquiry";
  const location = lead.location || "NSW";

  const values: Record<string, string> = {
    name: lead.name,
    location,
    type: typeStr,
    phone: lead.phone,
    project: `${typeStr} at ${location}`,
    notes: resolveLeadNotesTextOr(lead, "Previous discussion details"),
    amount: lead.budget !== "Not Discussed" ? lead.budget : "TBD",
    budget: lead.budget || "Not Discussed",
    source,
    stage: lead.stage,
    followup,
    meeting,
    assignee: lead.assignedUser?.name || "Royal Constructions team",
    duration: "6-8 months",
    date: formatShortDate(new Date()),
    // Not "10:00 AM". Inventing a time is how the Meeting email came to tell
    // clients a site visit was booked for a time nobody had agreed.
    time: lead.followupTime ?? "",
    milestone: "Foundation Complete",
    nextMilestone: "Frame Stage",
    originalAmount: "$480,000",
    variationAmount: "$4,500",
    revisedAmount: "$484,500",
  };

  // Strip the date placeholders that have no value BEFORE substituting, so the
  // connector holding them to the sentence goes too. Substituting first would
  // leave "on " with nothing after it.
  const emptied = DATE_PLACEHOLDERS.filter((key) => values[key] === "");

  return dropEmptyPlaceholders(text, emptied).replace(
    PLACEHOLDER_PATTERN,
    (_, key) => values[key] ?? `{${key}}`,
  );
}

export function previewTemplateText(text: string) {
  return text.replace(PLACEHOLDER_PATTERN, "...");
}

export function getTemplateDescription(template: EmailTemplate): string {
  const descriptions: Record<string, string> = {
    Welcome:
      "Welcome the lead by name and references their project type, location, source, current stage, budget, notes, and next follow-up where available.",
    Quotation:
      "Send a professional quotation summary using the lead's project type, location, budget range, stage, notes, and next action.",
    "Follow-up":
      "Follow up with the selected lead using their CRM notes, stage, source, budget range, location, and scheduled follow-up.",
    Catalogue:
      "Send the finishes catalogue with a lead snapshot so material choices are anchored to the project type and location.",
    Variation:
      "Formal variation summary with the selected lead's project context and notes for cleaner handoff.",
    Promotion:
      "Promotional offer tailored to the lead's project type, stage, budget range, and next follow-up.",
    Meeting:
      "Confirm a site meeting or consultant visit using the lead's follow-up date, time, location, notes, and project type.",
    Update:
      "Project update template with CRM lead context so the message stays connected to the right project and stage.",
    Portfolio:
      "Share the builder profile and portfolio with a personalized snapshot of the lead's project type, location, and enquiry details.",
  };
  return (
    descriptions[template.category] ??
    "Curated and professionally designed email template adhering to brand standards to streamline client communications."
  );
}

/* ── Lead ↔ FormData conversion ───────────────────────── */

export function leadToFormData(lead: Lead): LeadDetailFormData {
  return {
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    location: lead.location,
    secondaryName: lead.secondaryName ?? "",
    secondaryEmail: lead.secondaryEmail ?? "",
    secondaryPhone: lead.secondaryPhone ?? "",
    sourceDetail: (lead.sourceDetail || lead.source) as LeadSource,
    stage: lead.stage,
    assignedId: lead.assignedId || null,
    assignedUser: lead.assignedUser || null,
    budget: lead.budget || "",
    estimatedValue: lead.estimatedValue ?? "",
    estimatedValueSource: lead.estimatedValueSource ?? null,
    probabilityOverride:
      lead.probabilityOverride === null ||
      lead.probabilityOverride === undefined
        ? ""
        : String(lead.probabilityOverride),
    // <input type="date"> wants YYYY-MM-DD, not a full ISO timestamp.
    expectedCloseDate: lead.expectedCloseDate
      ? lead.expectedCloseDate.slice(0, 10)
      : "",
    type: normalizeTypes(lead.type),
    notes: lead.notes || "",
    notesDoc: coerceLeadNotesDocument(lead.notesDoc, lead.notes || ""),
    annotationsToCreate: [],
    followupDate: lead.followupDate || "",
    followupTime: lead.followupTime || "",
    urgent: Boolean(lead.urgent),
    lostReason: lead.lostReason || "",
  };
}

/* ── Calendar event helpers ───────────────────────────── */

// export async function createCalendarEventIfValid(
//   lead: {
//     name: string;
//     email: string;
//     followupDate: string;
//     followupTime: string;
//   },
//   showToast: (msg: string, type?: "success" | "info") => void,
// ): Promise<boolean> {
//   if (!lead.followupDate || !lead.followupTime) {
//     showToast("Please provide follow-up date and time.", "info");
//     return false;
//   }
//   const result = await FollowupCalendarCreation(
//     lead.name,
//     lead.email,
//     lead.followupDate,
//     lead.followupTime,
//   );
//   if (result !== "Follow-up calendar event successfully created") {
//     console.error("Failed to create calendar event:", result);
//     showToast(
//       "Failed to create follow-up calendar event. Please try again.",
//       "info",
//     );
//     return false;
//   }
//   return true;
// }

export function shouldSetFollowupStage(
  originalLead: Lead,
  formData: LeadDetailFormData,
): boolean {
  const isNewlyMovingToFollowup =
    originalLead.stage !== formData.stage && formData.stage === "In Follow-up";

  const isReschedulingFollowup =
    (formData.followupDate !== originalLead.followupDate ||
      formData.followupTime !== originalLead.followupTime) &&
    formData.stage === "In Follow-up" &&
    originalLead.stage === "In Follow-up";

  const isFollowupDateTimeAdded = !!(
    (!originalLead.followupDate || !originalLead.followupTime) &&
    formData.followupDate &&
    formData.followupTime
  );

  return (
    isNewlyMovingToFollowup || isReschedulingFollowup || isFollowupDateTimeAdded
  );
}

export function buildFollowupHistoryEntry(
  date: string,
  time: string,
): HistoryItem {
  return {
    action: "New Followup Stage Created",
    detail: `Followup Stage at Time ${date} at ${time}`,
    type: "system",
    date,
    time,
  };
}

/**
 * The entry a stage transition writes. Records where the lead came from, which
 * the stage column alone cannot say once it has been overwritten.
 */
export function buildStageChangedHistoryEntry(
  from: DBLeadStage,
  to: DBLeadStage,
  at: Date = new Date(),
): HistoryItem {
  return {
    action: "Stage changed",
    detail: `${stageDef(from).label} → ${stageDef(to).label}`,
    type: "system",
    date: sydneyDateOnly(at),
    time: sydneyTimeOnly(at),
  };
}

/** The entry a task writes when it is booked. */
export function buildTaskAddedHistoryEntry(
  summary: string,
  at: Date = new Date(),
): HistoryItem {
  return {
    action: "Task added",
    detail: summary,
    type: "system",
    date: sydneyDateOnly(at),
    time: sydneyTimeOnly(at),
  };
}

/** The entry a task writes when it is closed out. */
export function buildTaskCompletedHistoryEntry(
  summary: string,
  at: Date = new Date(),
): HistoryItem {
  return {
    action: "Task completed",
    detail: summary,
    type: "system",
    date: sydneyDateOnly(at),
    time: sydneyTimeOnly(at),
  };
}

export function buildFollowupConfirmedHistoryEntry(): HistoryItem {
  const now = new Date();
  return {
    action: "Follow-up confirmed",
    detail: "The follow-up was completed and acknowledged.",
    type: "system",
    date: sydneyDateOnly(now),
    time: sydneyTimeOnly(now),
  };
}

export function buildFollowupRescheduledHistoryEntry(
  nextDate: string,
  nextTime: string,
  note?: string,
): HistoryItem {
  return {
    action: "Follow-up rescheduled",
    detail: `Follow-up moved to ${nextDate} ${nextTime}${note ? ` \nNOTE: (${note})` : ""}`,
    type: "system",
    date: nextDate,
    time: nextTime,
  };
}

export function buildFollowupNotRequiredHistoryEntry(
  note?: string,
): HistoryItem {
  const now = new Date();
  return {
    action: "Follow-up not required",
    detail: `No additional follow-up is required for this lead.${note ? ` \nNOTE: (${note})` : ""}`,
    type: "system",
    date: sydneyDateOnly(now),
    time: sydneyTimeOnly(now),
  };
}

export function buildFollowupCompletedHistoryEntry(note?: string): HistoryItem {
  const now = new Date();
  return {
    action: "Follow-up completed",
    detail: `The follow-up was completed and acknowledged.${note ? ` \nNOTE: (${note})` : ""}`,
    type: "system",
    date: sydneyDateOnly(now),
    time: sydneyTimeOnly(now),
  };
}

export function buildMeetingDidNotTakePlaceHistoryEntry(
  reason?: string,
): HistoryItem {
  const now = new Date();
  return {
    action: "Meeting did not take place",
    detail: `The scheduled meeting did not occur and needs rescheduling.${reason ? ` \nREASON: (${reason})` : ""}`,
    type: "system",
    date: sydneyDateOnly(now),
    time: sydneyTimeOnly(now),
  };
}

export function buildMeetingReviewedHistoryEntry(input: {
  meetingMode: string;
  discussionNotes: string;
  buildScope: string;
}): HistoryItem {
  const now = new Date();
  return {
    action: "Meeting reviewed",
    detail: `Mode: ${input.meetingMode}. Discussion: ${input.discussionNotes || "No discussion notes"}. Scope: ${input.buildScope || "No build scope"}.`,
    type: "system",
    date: sydneyDateOnly(now),
    time: sydneyTimeOnly(now),
  };
}

/* ── Stage helpers ────────────────────────────────────── */

export function isLostStage(stage: LeadStage): boolean {
  return stage === "Lost" || stage === "Cancelled" || stage === "Disqualified";
}

/** A deal that closed successfully. "Converted" is Royal Constructions' word
 *  for it; Won is the same thing and is currently hidden from the picker. */
export function isWonStage(stage: LeadStage): boolean {
  return stage === "Won" || stage === "Converted";
}

export function isTerminalStage(stage: LeadStage): boolean {
  // Converted belongs here. Leaving it out is why a won deal still showed a
  // Call button and no Archive button — the row actions treated the one label
  // operators can actually pick as though the lead were still open.
  return isWonStage(stage) || isLostStage(stage);
}

export function isQuotingStage(stage: LeadStage): boolean {
  // isWonStage, not a bare "Won". This list named Won and missed Converted,
  // and Converted is the label operators actually pick, so in practice no won
  // lead ever showed Check Offer. Exactly the defect isTerminalStage had.
  //
  // And it happened again with the ladder change: the list still named the two
  // retired stages and never gained Discovery, which replaced them. That hid
  // Check with Offer from 33 of the 59 leads on staging, every one of them in
  // the stage where scoping a build actually happens.
  return (
    isWonStage(stage) ||
    ["Discovery", "Qualified", "Quoted", "Negotiating"].includes(stage) ||
    // Retired, kept until no row holds them.
    ["In Follow-up", "Meeting Scheduled"].includes(stage)
  );
}

/**
 * Metrics whose cohort cannot be drawn as chips.
 *
 * The KPI cards select groups that span hidden stages: "converted" means Won
 * plus Converted and Won has no chip, "lost" includes Cancelled which has none
 * either. Editing one of those cohorts chip by chip left the invisible half
 * selected on its own, so clicking the Converted chip to clear it filtered the
 * table to Won with no chip highlighted to explain why.
 */
const KPI_COHORT_METRICS = ["total", "converted", "pendingFollowup", "lost"];

export function isKpiCohortMetric(
  activeMetric: string | null | undefined,
): boolean {
  if (!activeMetric) return false;
  return KPI_COHORT_METRICS.some((metric) => activeMetric.includes(metric));
}
/**
 * Wording for the mandatory reason on a closed-unsuccessful lead.
 *
 * `isLostStage` groups Cancelled with Lost, so making Cancelled selectable
 * turns on a required field labelled "Lost reason" for a lead that was not
 * lost. The reason is stored in the same `lostReason` column either way —
 * only the wording changes.
 */
export function closureReasonCopy(stage: LeadStage): {
  label: string;
  noun: string;
  placeholder: string;
} {
  if (stage === "Cancelled") {
    return {
      label: "Cancellation reason",
      noun: "cancellation reason",
      placeholder: "e.g. Client postponed the build, finance fell through",
    };
  }
  return {
    label: "Lost reason",
    noun: "lost reason",
    placeholder: "e.g. Went with another builder, budget too low",
  };
}

/**
 * Parse the free-typed likelihood field into a per-lead probability override.
 *
 * Blank means "no override" and so does anything unparseable. Rounding a typo
 * down to 0 would be worse than ignoring it: 0% is a legitimate forecast value
 * that removes the deal's weighted contribution entirely, so a stray keystroke
 * would silently shrink the pipeline. Valid input is clamped to 0-100 and
 * rounded, because Zod enforces an int in that range and rejecting the payload
 * would take every unrelated edit in the modal down with it.
 */
export function parseLikelihood(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}
