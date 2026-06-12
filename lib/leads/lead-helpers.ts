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
import { FollowupCalendarCreation } from "@/lib/leads/leads-service";
import { coerceLeadNotesDocument } from "@/lib/rich-text/lead-notes";

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

export const LEAD_STAGE_OPTIONS: LeadStage[] = [
  "New",
  "Contacted",
  "Qualified",
  "Quoted",
  "Negotiating",
  //"Won",
  "Lost",
  "Meeting Scheduled",
  "In Follow-up",
  "No Response",
  "Converted",
  //"Cancelled",
  "Disqualified",
];

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

export const STAGE_STYLES: Record<LeadStage, string> = {
  New: "stage-badge-info",
  Contacted: "stage-badge-warning",
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
  sourceDetail: LeadSource;
  stage: LeadStage;
  assignedId?: string | null;
  assignedUser?: { id: string; name: string; email: string } | null;
  budget: string;
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
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatFollowup(date: string | null, time?: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}${time ? " " + time : ""}`;
}

export function formatShortDate(date: Date): string {
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

export function hydrateSubject(text: string, lead: Lead): string {
  const typeStr = Array.isArray(lead.type)
    ? (lead.type[0] ?? "New Home Build")
    : lead.type;
  const followup = lead.followupDate
    ? formatFollowup(lead.followupDate, lead.followupTime)
    : "next step";
  const source = lead.sourceDetail || lead.source || "Royal Constructions enquiry";
  const location = lead.location || "NSW";

  const values: Record<string, string> = {
    name: lead.name,
    location,
    type: typeStr,
    phone: lead.phone,
    project: `${typeStr} at ${location}`,
    notes: lead.notes || "Previous discussion details",
    amount: lead.budget !== "Not Discussed" ? lead.budget : "TBD",
    budget: lead.budget || "Not Discussed",
    source,
    stage: lead.stage,
    followup,
    assignee: lead.assignedUser?.name || "Royal Constructions team",
    duration: "6-8 months",
    date: formatShortDate(new Date()),
    time: lead.followupTime || "10:00 AM",
    milestone: "Foundation Complete",
    nextMilestone: "Frame Stage",
    originalAmount: "$480,000",
    variationAmount: "$4,500",
    revisedAmount: "$484,500",
  };

  return text.replace(
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
    sourceDetail: (lead.sourceDetail || lead.source) as LeadSource,
    stage: lead.stage,
    assignedId: lead.assignedId || null,
    assignedUser: lead.assignedUser || null,
    budget: lead.budget || "",
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

export async function createCalendarEventIfValid(
  lead: {
    name: string;
    email: string;
    followupDate: string;
    followupTime: string;
  },
  showToast: (msg: string, type?: "success" | "info") => void,
): Promise<boolean> {
  if (!lead.followupDate || !lead.followupTime) {
    showToast("Please provide follow-up date and time.", "info");
    return false;
  }
  const result = await FollowupCalendarCreation(
    lead.name,
    lead.email,
    lead.followupDate,
    lead.followupTime,
  );
  if (result !== "Follow-up calendar event successfully created") {
    console.error("Failed to create calendar event:", result);
    showToast(
      "Failed to create follow-up calendar event. Please try again.",
      "info",
    );
    return false;
  }
  return true;
}

export function shouldCreateCalendarEvent(
  originalLead: Lead,
  formData: LeadDetailFormData,
): boolean {
  const isNewlyMovingToFollowup =
    originalLead.stage !== formData.stage &&
    formData.stage === "In Follow-up";

  const isReschedulingFollowup =
    (formData.followupDate !== originalLead.followupDate ||
      formData.followupTime !== originalLead.followupTime) &&
    formData.stage === "In Follow-up" &&
    originalLead.stage === "In Follow-up";

const isFollowupDateTimeAdded =
    !!((!originalLead.followupDate || !originalLead.followupTime) &&
    formData.followupDate &&
    formData.followupTime);

  return isNewlyMovingToFollowup || isReschedulingFollowup || isFollowupDateTimeAdded;
}

export function buildCalendarHistoryEntry(
  date: string,
  time: string,
): HistoryItem {
  return {
    action: "Calendar event creation for Followup Stage",
    detail: `Calendar event created for Followup Stage at Time ${date} at ${time}`,
    type: "system",
    date,
    time,
  };
}

/* ── Stage helpers ────────────────────────────────────── */

export function isLostStage(stage: LeadStage): boolean {
  return stage === "Lost" || stage === "Cancelled" || stage === "Disqualified";
}

export function isTerminalStage(stage: LeadStage): boolean {
  return ["Won", "Lost", "Cancelled", "Disqualified"].includes(stage);
}
