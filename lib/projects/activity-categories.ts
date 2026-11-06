// How a project's activity-log entry reads on the History timeline: the
// category it is grouped and filtered under, and its title.
//
// `ActivityLog.type` is a free-form string written by many call sites in two
// spellings ("fileUploaded", "file-deleted"), so the category is read from the
// words in it rather than from a list that a new type would silently miss.

import { toLabel } from "@/utils/formatters";

export const ACTIVITY_CATEGORIES = [
  "compliance",
  "documents",
  "variations",
  "financials",
  "tradies",
  "milestones",
  "site",
  "email",
  "project",
  "other",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_CATEGORY_LABEL: Readonly<
  Record<ActivityCategory, string>
> = {
  compliance: "Compliance",
  documents: "Documents",
  variations: "Variations",
  financials: "Financials",
  tradies: "Tradies",
  milestones: "Milestones",
  site: "Site updates",
  email: "Email",
  project: "Project",
  other: "Activity",
};

// First match wins, so the more specific words come first: a compliance
// document upload is compliance, and a milestone photo is a document.
const CATEGORY_RULES: ReadonlyArray<readonly [RegExp, ActivityCategory]> = [
  [
    /complian|certifier|checklist|outreach|council|basix|bushfire/,
    "compliance",
  ],
  [/file|photo|document|upload|attachment/, "documents"],
  [/sitemanager|startdate|projectcreated/, "project"],
  [/variation/, "variations"],
  [/invoice|payment|claim|xero|price|spend|budget/, "financials"],
  [/tradie|booking|trade|quote|incident|schedule|directory/, "tradies"],
  [/milestone|stage/, "milestones"],
  [/site/, "site"],
  [/email|mail|message|reply/, "email"],
  [/project|manager|start/, "project"],
];

export function activityCategory(type: string): ActivityCategory {
  const words = type.toLowerCase();
  return (
    CATEGORY_RULES.find(([pattern]) => pattern.test(words))?.[1] ?? "other"
  );
}

/** Titles worth more than the type's own words. */
const TITLES: Readonly<Record<string, string>> = {
  projectCreated: "Project created",
  siteManagerAssigned: "Site manager assigned",
  projectStartDateChanged: "Start date moved",
  fileUploaded: "Document uploaded",
  "file-deleted": "Document deleted",
  "site-update": "Site update posted",
  newMilestonePhotoUploaded: "Milestone photos uploaded",
  milestoneStatusChanged: "Milestone status changed",
  milestonePriceChanged: "Milestone price changed",
  milestoneAdded: "Milestone added",
  variationCreated: "Variation raised",
  variationUpdated: "Variation updated",
  tradieScheduleCreated: "Tradie booked",
  tradieScheduleUpdated: "Booking decision",
  tradieScheduleQuoted: "Tradie quoted",
  tradieScheduleAvailable: "Tradie confirmed availability",
  tradieScheduleRescheduled: "Booking rescheduled",
  tradieScheduleDeleted: "Booking removed",
  tradieScheduleDeletionRequested: "Booking removal requested",
  invoiceRecorded: "Tradie invoice recorded",
  invoiceVoided: "Tradie invoice voided",
  invoiceAllocated: "Tradie invoice allocated",
  outlookEmailSent: "Email sent",
};

/** "complianceDocumentUploaded" → "Compliance document uploaded". */
export function activityTitle(type: string): string {
  const known = TITLES[type];
  if (known) return known;
  const label = toLabel(type);
  return label.charAt(0) + label.slice(1).toLowerCase();
}
