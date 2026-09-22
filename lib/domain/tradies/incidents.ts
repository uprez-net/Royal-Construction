import {
  TradieApprovalActionType,
  type IncidentSeverity,
  type Prisma,
  type TradieIncident,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { assertCanReadTradieDirectory } from "../access/tradies";

// Reporting an incident against a tradie, with the evidence the reporter
// attached.
//
// Written twice, and the file handling was the difference:
//
//   The app attaches only files the reporter uploaded AND that are not yet on
//   a project, milestone, lead, compliance document or another incident, and
//   fails the whole report if any id misses. Eve matched on `uploadedBy` alone
//   — so an agent could move a file already attached to a project or a lead
//   onto the incident. `File.incidentId` cascades, so deleting that incident
//   would then delete the project's file with it.
//
// The app's is the canonical one. The notification and the cache expiry stay
// with the adapters.

export type ReportIncidentInput = {
  readonly tradieId: string;
  readonly incidentType: string;
  readonly severity: IncidentSeverity;
  readonly description: string;
  readonly fileIds?: readonly string[];
};

export type ReportedIncident = {
  readonly incident: TradieIncident;
  readonly approvalId: string;
  readonly tradieName: string;
  readonly tradieTrade: string;
};

/**
 * File an incident and queue it for admin resolution.
 *
 * The incident, its evidence and the approval request are one decision: an
 * incident filed without the evidence the reporter attached is a different
 * report from the one they made, so they go in one transaction.
 */
export async function reportTradieIncident(
  principal: DomainPrincipal,
  input: ReportIncidentInput,
  db: TransactionalDomainDb | Prisma.TransactionClient,
): Promise<ReportedIncident> {
  assertCanReadTradieDirectory(principal);

  const reporterId = attributionUserId(principal);
  if (reporterId === null) {
    throw new DomainValidationError(
      "Reporting an incident needs a signed-in user.",
    );
  }

  const run = async (tx: DomainDb): Promise<ReportedIncident> => {
    const tradie = await tx.tradie.findUnique({
      select: { id: true, name: true, trade: true },
      where: { id: input.tradieId },
    });
    if (!tradie) throw new DomainNotFoundError("Tradie not found");

    const fileIds = [...new Set(input.fileIds ?? [])];

    const incident = await tx.tradieIncident.create({
      data: {
        description: input.description,
        severity: input.severity,
        tradieId: tradie.id,
        type: input.incidentType,
      },
    });

    // The file ids come from the browser, or from an agent's tool call.
    // `connect` took any id, which moved another record's file onto this
    // incident — and File.incidentId cascades, so deleting the incident
    // deleted that file too. Attach only what the report actually uploaded:
    // the reporter's own files, not yet on a project, milestone, lead,
    // compliance document or incident.
    if (fileIds.length > 0) {
      const attached = await tx.file.updateMany({
        data: { incidentId: incident.id },
        where: {
          complianceDocumentId: null,
          id: { in: fileIds },
          incidentId: null,
          leadId: null,
          milestoneId: null,
          projectId: null,
          uploadedBy: reporterId,
        },
      });
      // Fail the report, as a missing id did under `connect`, rather than file
      // it without the evidence the reporter attached.
      if (attached.count !== fileIds.length) {
        throw new DomainValidationError(
          "Incident files are missing or belong to another record",
          "fileIds",
        );
      }
    }

    const approval = await tx.tradieApproval.create({
      data: {
        actionType: TradieApprovalActionType.INCIDENT_RESOLUTION,
        reason: input.description,
        requestedBy: reporterId,
        tradieId: tradie.id,
        updationData: {
          incidentDescription: input.description,
          incidentId: incident.id,
          incidentSeverity: input.severity,
          incidentType: input.incidentType,
        },
      },
      select: { id: true },
    });

    return {
      approvalId: approval.id,
      incident,
      tradieName: tradie.name,
      tradieTrade: tradie.trade,
    };
  };

  return "$transaction" in db ? db.$transaction(run) : run(db);
}
