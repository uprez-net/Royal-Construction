import {
  LeadStage as DBLeadStage,
  RunStatus,
  LeadEmails,
} from "@prisma/client";

export type LeadStage =
  | "New"
  | "Contacted"
  | "Discovery"
  | "Qualified"
  | "Quoted"
  | "Negotiating"
  | "Won"
  | "Lost"
  | "Meeting Scheduled"
  | "In Follow-up"
  | "No Response"
  | "Converted"
  | "Cancelled"
  | "Disqualified";
export type LeadSource =
  | "Google Ads"
  | "Referral"
  | "Facebook Ads"
  | "Walk-in"
  | "Repeat Client"
  | "Website"
  | "Personal"
  | "Business";
export type BudgetRange =
  | "Not Discussed"
  | "$200K - $350K"
  | "$350K - $500K"
  | "$500K - $700K"
  | "$700K+";
export type ProjectType =
  | "Not Specified"
  | "New Home"
  | "Duplex"
  | "Renovation"
  | "Granny Flat"
  | "Townhouse"
  | "Dual Occupancy"
  | "Single Storey"
  | "Double Storey"
  | "House and Granny"
  | "Knockdown and rebuild"
  | "House + land package";

export interface HistoryItem {
  date: string;
  time: string;
  action: string;
  detail: string;
  type: "system" | "call" | "email" | "referral" | "whatsapp" | "sms";
  author?: {
    id: string;
    name: string;
  } | null;
}

export interface LeadRichTextDocument {
  version: 1;
  html: string;
  plainText: string;
  value: LeadRichTextNode[];
}

export type LeadRichTextNode = {
  type?: string;
  text?: string;
  key?: unknown;
  value?: unknown;
  children?: LeadRichTextNode[];
  [key: string]: unknown;
};

export interface LeadNoteAnnotation {
  id: string;
  selectedText: string;
  comment: string;
  mentionedUserIds: string[];
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt?: string | null;
}

export interface LeadNoteAnnotationInput {
  selectedText: string;
  comment: string;
  mentionedUserIds: string[];
}

export interface Lead {
  id: number;
  name: string;
  phone: string;
  email: string;
  location: string;
  // Secondary client — optional second person co-owning the lead. The primary
  // name/phone/email remain the canonical client driver for actions/titles.
  secondaryName?: string | null;
  secondaryEmail?: string | null;
  secondaryPhone?: string | null;
  source: LeadSource;
  sourceDetail: string;
  stage: LeadStage;
  assignedId?: string | null; // <-- NEW: The User ID
  assignedUser?: {
    // <-- NEW: The populated User object from Prisma
    id: string;
    name: string;
    email: string;
  } | null;
  /** Free-text note only. `estimatedValue` is the source of truth for KPIs. */
  budget: BudgetRange | string;
  /** Money as string — Decimal cannot cross to a Client Component. */
  estimatedValue?: string | null;
  estimatedValueSource?: "OFFER" | "MANUAL" | null;
  /** Null inherits the stage default (lib/leads/pipeline-stages.ts). */
  probabilityOverride?: number | null;
  expectedCloseDate?: string | null;
  estimatedStartDate?: string | null;
  type: string;
  notes: string;
  notesDoc?: LeadRichTextDocument | null;
  noteAnnotations?: LeadNoteAnnotation[];
  meetingDate?: string | null;
  meetingTime?: string | null;
  meetingMode?: string | null;
  followupDate: string | null;
  followupTime: string | null;
  followupNotes: string;
  followupReminderSentAt?: string | null;
  meetingReminderSentAt?: string | null;
  /** Set when the task was closed out. The Follow-ups tab hides completed work. */
  followupCompletedAt?: string | null;
  meetingCompletedAt?: string | null;
  lostReason?: string;
  history: HistoryItem[];
  created: string;
  urgent: boolean;
  creatingOffer: boolean;
  runId: string | null;
  runStatus: RunStatus | null;
  emails: LeadEmails[];
  isArchived: boolean; // <-- NEW: Indicates if the lead is archived (soft-deleted)
  uploadedFiles: {
    id: string;
    name: string;
    size: number;
    url: string;
    /** MIME type; null for a file uploaded before it was kept. */
    fileType: string | null;
    /** ISO timestamp. */
    createdAt: string;
    /** "Lead › Documents" — where it was uploaded from. */
    origin: string | null;
    tags: string[];
  }[];
}

export interface LeadsStats {
  total: number;
  new: number;
  contacted: number;
  qualified: number;
  quoted: number;
  conversion: number;
  pendingFollowup: number;
  lost: number;
}

export interface EmailTemplate {
  id: number;
  subject: string;
  content?: string;
  category: string;
  body?: string;
}

export const LeadStageToLeadStageDBMapping: Record<LeadStage, DBLeadStage> = {
  New: DBLeadStage.NEW,
  Contacted: DBLeadStage.CONTACTED,
  Discovery: DBLeadStage.DISCOVERY,
  Qualified: DBLeadStage.QUALIFIED,
  Quoted: DBLeadStage.QUOTED,
  Negotiating: DBLeadStage.NEGOTIATING,
  Won: DBLeadStage.WON,
  Lost: DBLeadStage.LOST,
  "Meeting Scheduled": DBLeadStage.MEETING_SCHEDULED,
  "In Follow-up": DBLeadStage.IN_FOLLOW_UP,
  "No Response": DBLeadStage.NO_RESPONSE,
  Converted: DBLeadStage.CONVERTED,
  Cancelled: DBLeadStage.CANCELLED,
  Disqualified: DBLeadStage.DISQUALIFIED,
};

/**
 * Filter labels that are not stages but may still arrive in a bookmarked URL
 * or a saved MCP call.
 *
 * Without this an unknown label maps to undefined, lib/data/leads.ts strips
 * undefined out of the status array, the "is the array non-empty" guard then
 * skips the stage filter entirely, and the caller gets EVERY non-archived lead
 * back instead of an error — a wrong answer that looks like a working one.
 */
export const LEGACY_LEAD_STAGE_FILTER_ALIASES: Record<string, DBLeadStage> = {};

/**
 * Resolve a filter label to a DB stage, tolerating retired labels.
 *
 * `Object.hasOwn`, not a bare lookup: the label comes straight off a query
 * string, and a plain object inherits from Object.prototype, so `toString`,
 * `constructor` and `valueOf` all "resolve" to functions. Those would sail
 * past the unknown-label guard and end up in a Prisma `where` clause.
 */
export function resolveLeadStageFilter(label: string): DBLeadStage | undefined {
  if (Object.hasOwn(LeadStageToLeadStageDBMapping, label)) {
    return LeadStageToLeadStageDBMapping[label as LeadStage];
  }
  if (Object.hasOwn(LEGACY_LEAD_STAGE_FILTER_ALIASES, label)) {
    return LEGACY_LEAD_STAGE_FILTER_ALIASES[label];
  }
  return undefined;
}

/**
 * Parse a comma-separated `status` query param into DB stages, reporting any
 * label that did not resolve.
 *
 * Callers must treat a non-empty `unknown` as a bad request. Dropping unknown
 * labels silently is what turns `?status=Garbage` into an unfiltered read of
 * every lead in the table.
 */
export function parseLeadStageFilter(raw: string): {
  stages: DBLeadStage[];
  unknown: string[];
} {
  const stages: DBLeadStage[] = [];
  const unknown: string[] = [];
  for (const label of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const resolved = resolveLeadStageFilter(label);
    if (resolved) stages.push(resolved);
    else unknown.push(label);
  }
  return { stages, unknown };
}
