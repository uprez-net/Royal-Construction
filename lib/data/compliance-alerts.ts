"use server";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  CompliancePartyType,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { notifyCompliance } from "@/lib/compliance/notify";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  type CertifierEngagementDetail,
} from "@/types/compliance";
import { logAction } from "./actionLog";

/**
 * Conditions raised on a compliance file, and closing them out.
 *
 * The two that exist today came from the same observation: the flow is not a
 * pipeline that only ever moves forward. A title search arrives off a register
 * that has not caught up with settlement and has to be asked for again; an
 * architect looks at the proposal and says it cannot go through as a CDC at
 * all. Both arrive mid-flow and both change what the file needs from that
 * moment.
 *
 * They are found differently, which is the more interesting half. The architect
 * tells us, so that one is read off their reply. Nobody tells us about the title
 * search -- the surveyor who ordered it never knew who bought the place -- so
 * that one is checked against the document itself, on both the inbound and the
 * manual upload path.
 *
 * Modelled as rows rather than as engagement flags because each one has a
 * lifetime, a raiser and a resolution, and because there is nothing to stop the
 * same condition arising twice on one job.
 */

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`certifier-engagement-${projectId}`, CACHE_PROFILES.SHORT);
}

/** How each alert reads in a notification and in the audit trail. */
const ALERT_TITLE: Readonly<Record<ComplianceAlertType, string>> = {
  [ComplianceAlertType.STALE_TITLE_SEARCH]:
    "Title search does not name the owners",
  [ComplianceAlertType.DA_APPROVAL_REQUIRED]:
    "Development approval required",
};

export async function complianceAlertTitle(
  type: ComplianceAlertType,
): Promise<string> {
  return ALERT_TITLE[type];
}

async function reloadEngagement(
  projectId: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: certifierEngagementInclude,
  });
  if (!engagement) {
    throw new Error(`Project ${projectId} has no compliance file.`);
  }
  return engagement;
}

/**
 * Raises an alert, or returns the one already open.
 *
 * Deduplicated on `(engagement, type, OPEN)` rather than blindly created: the
 * architect saying "this needs a DA" on three consecutive emails is one
 * condition, and three rows would mean three things for an admin to close and
 * three chances to leave one of them open, silently suppressing the 10.7
 * certificate long after the question was settled.
 *
 * A resolved alert of the same type is deliberately not in the way. If the
 * condition genuinely recurs -- a second title search that is also stale -- it
 * is a new alert with its own resolution.
 */
export async function raiseComplianceAlert(params: {
  projectId: string;
  engagementId: string;
  type: ComplianceAlertType;
  raisedByParty?: CompliancePartyType | null;
  detail?: string | null;
}): Promise<{ alertId: string; created: boolean }> {
  const open = await prisma.complianceAlert.findFirst({
    where: {
      engagementId: params.engagementId,
      type: params.type,
      status: ComplianceAlertStatus.OPEN,
    },
    select: { id: true },
  });
  if (open) {
    return { alertId: open.id, created: false };
  }

  const alert = await prisma.complianceAlert.create({
    data: {
      engagementId: params.engagementId,
      type: params.type,
      raisedByParty: params.raisedByParty ?? null,
      detail: params.detail ?? null,
    },
    select: { id: true },
  });

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceAlertRaised", {
        projectId: params.projectId,
        engagementId: params.engagementId,
        alertId: alert.id,
        alertType: params.type,
        raisedBy: params.raisedByParty ?? "an admin",
      }),
    );
    await notifyCompliance("complianceAlertRaised", params.projectId, {
      alertId: alert.id,
      alertTitle: ALERT_TITLE[params.type],
      detail: params.detail ?? "",
    });
  });

  return { alertId: alert.id, created: true };
}

/**
 * Closes an open alert of one type, on the system's own authority.
 *
 * For the case where the thing the alert was waiting for is something we can
 * check rather than something a person has to judge: a replacement title search
 * lands, the owner comparison passes, and the condition is answered. Leaving it
 * open would ask an admin to confirm what has already been verified, which is
 * asking them to rubber-stamp it -- and an alert that outlives its cause is how
 * a screen full of alerts stops being read.
 *
 * `resolvedById` stays null, which is what distinguishes this from a person
 * closing it; the note says what was checked. Returns whether it closed one, so
 * the caller can log the difference between "fixed" and "was never flagged".
 */
export async function resolveComplianceAlertBySystem(params: {
  projectId: string;
  engagementId: string;
  type: ComplianceAlertType;
  resolutionNote: string;
}): Promise<boolean> {
  const claim = await prisma.complianceAlert.updateMany({
    where: {
      engagementId: params.engagementId,
      type: params.type,
      status: ComplianceAlertStatus.OPEN,
    },
    data: {
      status: ComplianceAlertStatus.RESOLVED,
      resolvedAt: new Date(),
      resolutionNote: params.resolutionNote,
    },
  });

  if (claim.count === 0) {
    return false;
  }

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceAlertResolved", {
        projectId: params.projectId,
        engagementId: params.engagementId,
        // updateMany does not hand back ids. The type identifies the condition
        // and at most one of them is ever open, so the trail loses nothing.
        alertId: params.type,
        alertType: params.type,
        resolvedBy: "the system",
      }),
    );
  });

  return true;
}

/**
 * Closes an alert.
 *
 * Guarded on the alert still being open, so two admins clicking at once produce
 * one resolution and one no-op rather than the second overwriting the first's
 * note and timestamp.
 *
 * The note is required by the validator rather than here: what closed a
 * condition is the only part of it worth reading back later, and "resolved" on
 * its own tells the next person nothing about whether the replacement title
 * search was actually checked.
 */
export async function resolveComplianceAlert(params: {
  projectId: string;
  alertId: string;
  resolvedById: string;
  resolvedByName: string;
  resolutionNote: string;
}): Promise<CertifierEngagementDetail> {
  const alert = await prisma.complianceAlert.findUnique({
    where: { id: params.alertId },
    select: { id: true, engagementId: true, type: true, status: true },
  });
  if (!alert) {
    throw new Error("No such compliance alert.");
  }

  const claim = await prisma.complianceAlert.updateMany({
    where: { id: params.alertId, status: ComplianceAlertStatus.OPEN },
    data: {
      status: ComplianceAlertStatus.RESOLVED,
      resolvedById: params.resolvedById,
      resolvedAt: new Date(),
      resolutionNote: params.resolutionNote,
    },
  });

  if (claim.count === 1) {
    after(async () => {
      revalidateEngagement(params.projectId);
      await logAction(
        createActivityLogEntry("complianceAlertResolved", {
          projectId: params.projectId,
          engagementId: alert.engagementId,
          alertId: alert.id,
          alertType: alert.type,
          resolvedBy: params.resolvedByName,
        }),
      );
    });
  }

  return reloadEngagement(params.projectId);
}
