import { differenceInDays } from "date-fns";

import type {
  ProjectDetail,
  TradieScheduleListItem,
  TradieScheduleWithTradieAndMilestone,
  TradieUrgentReminderItem,
} from "@/types/project";

/**
 * The payload the tradie dialogs take, built from a booking on the project
 * page.
 *
 * One builder for the Tradies tab and the Alerts card. The Alerts card had its
 * own, which fell back to the literal strings "Site Manager Email" and "Site
 * Manager Phone" when a project had no site manager — text the reminder then
 * put in front of the tradie.
 */
export function toScheduleListItem(
  project: Pick<ProjectDetail, "id" | "name" | "siteManager">,
  tradie: TradieScheduleWithTradieAndMilestone,
  options: { includeQuote: boolean },
): TradieScheduleListItem {
  return {
    id: tradie.id,
    tradieId: tradie.tradie.id,
    tradieName: tradie.tradie.name,
    lastQuotedPriceUnit: tradie.tradie.lastQuotedPriceUnit,
    tradeType: tradie.tradie.trade,
    abn: tradie.tradie.abn,
    projectId: project.id,
    projectName: project.name,
    milestoneId: tradie.milestone?.id,
    milestoneName: tradie.milestone?.name,
    taskLabel: tradie.milestone?.name
      ? `${tradie.tradie.trade} for ${tradie.milestone.name}`
      : tradie.tradie.trade,
    scheduledDate: new Date(tradie.scheduledDate).toISOString(),
    durationDays: tradie.durationDays,
    status: tradie.status,
    // The row carries a real `updatedAt`; this used to be `new Date()`.
    updatedAt: new Date(tradie.updatedAt).toISOString(),
    reminderSentAt: tradie.reminderSentAt
      ? new Date(tradie.reminderSentAt).toISOString()
      : undefined,
    contact: {
      email: tradie.tradie.email,
      phone: tradie.tradie.phone,
      additionalEmails: tradie.tradie.additionalEmails,
    },
    siteManager: {
      name: project.siteManager?.name ?? "Unassigned",
      email: project.siteManager?.email ?? "",
      phone: project.siteManager?.phone ?? "",
    },
    isFavourite: tradie.tradie.isFavourite,
    note: tradie.tradie.note,
    requiresQuote: options.includeQuote ? tradie.requiresQuote : false,
    quotedPrice: options.includeQuote
      ? (tradie.quotedPrice ?? undefined)
      : undefined,
  };
}

/** The payload the booking details dialog takes. */
export function toScheduleDetailsItem(
  project: Pick<ProjectDetail, "name" | "siteManager">,
  tradie: TradieScheduleWithTradieAndMilestone,
  now: Date = new Date(),
): TradieUrgentReminderItem {
  return {
    id: tradie.id,
    tradieName: tradie.tradie.name,
    lastQuotedPriceUnit: tradie.tradie.lastQuotedPriceUnit,
    tradeType: tradie.tradie.trade,
    abn: tradie.tradie.abn,
    projectName: project.name,
    milestoneName: tradie.milestone?.name,
    taskLabel: tradie.milestone?.name
      ? `${tradie.tradie.trade} for ${tradie.milestone.name}`
      : tradie.tradie.trade,
    scheduledDate: new Date(tradie.scheduledDate).toISOString(),
    daysLeft: differenceInDays(new Date(tradie.scheduledDate), now),
    status: tradie.status,
    reminderSentAt: tradie.reminderSentAt
      ? new Date(tradie.reminderSentAt).toISOString()
      : undefined,
    contact: {
      email: tradie.tradie.email,
      phone: tradie.tradie.phone,
      additionalEmails: tradie.tradie.additionalEmails,
    },
    siteManager: {
      name: project.siteManager?.name ?? "Unassigned",
      email: project.siteManager?.email ?? "",
      phone: project.siteManager?.phone ?? "",
    },
  };
}
