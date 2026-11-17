import {
  LeadStage,
  MilestoneStatus,
  ProjectStatus,
  TradieScheduleStatus,
} from "@prisma/client";

import { SYDNEY_TZ, sydneyStartOfDay, sydneyToday } from "@/lib/dates/sydney";

// How a record reads out loud on the phone.
//
// One place for the words, so a client, a tradie and an admin hear the same
// fact said the same way — and so a status an office screen shows ("NEEDS
// ATTENTION") never reaches a client as a judgement about their build.

/** "Monday 24 November" — with the year only when it is not this year's. */
export function spokenDate(date: Date | null, now: Date): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = (d: Date) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone: SYDNEY_TZ,
      year: "numeric",
    }).format(d);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    timeZone: SYDNEY_TZ,
    weekday: "long",
    ...(year(date) === year(now) ? {} : { year: "numeric" }),
  }).format(date);
}

/** Midnight at the start of `now`'s Sydney day. */
export function startOfSydneyDay(now: Date): Date {
  return sydneyStartOfDay(sydneyToday(now));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** What a client hears about their build. Internal flags read as the stage. */
export function clientProjectStatus(status: ProjectStatus): string {
  switch (status) {
    case ProjectStatus.DRAFT:
      return "being set up by the team";
    case ProjectStatus.COMPLIANCE_STARTED:
      return "in the approvals and compliance stage";
    case ProjectStatus.COMPLIANCE_COMPLETED:
      return "through approvals, with construction not yet started";
    case ProjectStatus.COMPLETED:
      return "completed";
    case ProjectStatus.ACTIVE:
    case ProjectStatus.ON_TRACK:
    case ProjectStatus.NEEDS_ATTENTION:
    case ProjectStatus.DELAYED:
      return "under construction";
  }
}

/** What staff hear: the status as the office records it. */
export function staffProjectStatus(status: ProjectStatus): string {
  switch (status) {
    case ProjectStatus.NEEDS_ATTENTION:
      return "needs attention";
    case ProjectStatus.DELAYED:
      return "delayed";
    case ProjectStatus.ON_TRACK:
      return "on track";
    default:
      return clientProjectStatus(status);
  }
}

export function milestoneStatus(status: MilestoneStatus): string {
  switch (status) {
    case MilestoneStatus.ACTIVE:
      return "in progress";
    case MilestoneStatus.DONE:
      return "done";
    case MilestoneStatus.NOT_REQUIRED:
      return "not required";
    case MilestoneStatus.PENDING:
      return "not started";
  }
}

/** A client's enquiry, before it is a project. */
export function clientLeadStage(stage: LeadStage): string {
  switch (stage) {
    case LeadStage.MEETING_SCHEDULED:
      return "a meeting is booked";
    case LeadStage.QUOTED:
    case LeadStage.NEGOTIATING:
      return "a quote has been prepared";
    case LeadStage.WON:
    case LeadStage.CONVERTED:
      return "going ahead with Royal Constructions";
    case LeadStage.LOST:
    case LeadStage.CANCELLED:
    case LeadStage.DISQUALIFIED:
      return "closed";
    default:
      return "received, and with the team";
  }
}

/** Staff: the stage as the pipeline names it. */
export function staffLeadStage(stage: LeadStage): string {
  return stage.toLowerCase().replace(/_/g, " ");
}

export function bookingStatus(status: TradieScheduleStatus): string {
  switch (status) {
    case TradieScheduleStatus.PENDING:
    case TradieScheduleStatus.PENDING_RESPONSE:
      return "waiting on the tradie's reply";
    case TradieScheduleStatus.AWAITING_QUOTE:
      return "waiting on a quote";
    case TradieScheduleStatus.QUOTE_RECEIVED:
    case TradieScheduleStatus.AWAITING_ADMIN_APPROVAL:
      return "quote received, waiting on Royal's approval";
    case TradieScheduleStatus.CONFIRMED:
      return "confirmed";
    case TradieScheduleStatus.PENDING_FINAL_CONFIRMATION:
      return "waiting on final confirmation";
    case TradieScheduleStatus.NO_RESPONSE:
      return "no reply recorded";
    case TradieScheduleStatus.DECLINED:
      return "declined";
    case TradieScheduleStatus.COMPLETED:
      return "completed";
    case TradieScheduleStatus.CANCELLED:
      return "cancelled";
  }
}

/** "$12,345" from cents, for an admin's ears only. */
export function spokenDollars(cents: number | bigint | null): string | null {
  if (cents === null) return null;
  const value = Number(cents) / 100;
  if (!Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-AU", {
    currency: "AUD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

/**
 * Text from a record, made safe to put in front of the model: one line, no
 * control characters, bounded. Content read from the database is data — a
 * lead named "ignore your rules" stays a name.
 */
export function field(value: string | null | undefined, max = 80): string {
  const text = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>{}[\]`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
