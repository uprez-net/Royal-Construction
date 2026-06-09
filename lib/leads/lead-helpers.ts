import {
  HistoryItem,
  Lead,
  LeadSource,
  LeadStage,
  ProjectType,
  EmailTemplate,
} from "@/lib/leads/types";
import { FollowupCalendarCreation } from "@/lib/leads/leads-service";

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
  "Won",
  "Lost",
  "Meeting Scheduled",
  "In Follow-up",
  "No Response",
  "Converted",
  "Cancelled",
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
  followupDate: string;
  followupTime: string;
  urgent: boolean;
  lostReason: string;
  historyEntries: HistoryItem[];
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

  const values: Record<string, string> = {
    name: lead.name,
    location: lead.location,
    type: typeStr,
    phone: lead.phone,
    project: `${typeStr} at ${lead.location}`,
    notes: lead.notes || "Previous discussion details",
    amount: lead.budget !== "Not Discussed" ? lead.budget : "TBD",
    duration: "6-8 months",
    date: formatShortDate(new Date()),
    time: "10:00 AM",
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
      "Welcome new clients to Royal Constructions. Makes the builder appointment booking the first action, then requests land information, project priorities, build type, location, timeline, existing documents, and design ideas.",
    Quotation:
      "Send a professional and customized project quotation. Details the scope of work, budget, itemized breakdowns, and easy next steps for client approval.",
    "Follow-up":
      "Keep the momentum going with qualified leads. Recaps previous consultations, addresses open questions, and prompts for scheduling next steps.",
    Catalogue:
      "Provide clients with our comprehensive finishes and material catalogue. Designed to let clients browse exterior cladding, finishes, and paint selections.",
    Variation:
      "Formal project variation summary. Details requested changes, contract adjustments, revised pricing, and options for sign-off.",
    Promotion:
      "Offer a special limited-time promotional discount or upgrade bundle to incentivize hot leads to move forward with signing.",
    Meeting:
      "Confirm a site meeting or consultant visit details. Includes appointment date, time, location maps, and contact information.",
    Update:
      "Auto-generated construction milestone progress update. Informs the client about current status, completed tasks, and upcoming milestones.",
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
    followupDate: lead.followupDate || "",
    followupTime: lead.followupTime || "",
    urgent: Boolean(lead.urgent),
    lostReason: lead.lostReason || "",
    historyEntries: lead.history || [],
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