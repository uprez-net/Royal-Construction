import {
  Prisma,
  TradeSelectionStatus,
  TradieApprovalActionType,
  TradieApprovalStatus,
  TradieScheduleStatus,
} from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import { recordTradieActivity } from "../audit/tradie-activity-log";
import { INACTIVE_SCHEDULE_STATUSES } from "./lifecycle";
import { LIVE_SELECTION_STATUSES } from "./selection-rules";
import { settleTradeCancellation } from "./trade-selection";

export async function listTradieApprovals(
  principal: DomainPrincipal,
  input: {
    status?: TradieApprovalStatus;
    actionType?: TradieApprovalActionType;
    query: string;
    limit: number;
  },
  db: DomainDb,
) {
  requireAdminPrincipal(principal);
  const query = input.query.trim();
  return db.tradieApproval.findMany({
    where: {
      status: input.status,
      actionType: input.actionType,
      ...(query
        ? {
            tradie: {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { trade: { contains: query, mode: "insensitive" as const } },
                { email: { contains: query, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    include: {
      tradie: { select: { id: true, name: true, trade: true } },
      user: { select: { name: true } },
    },
  });
}

export async function getTradieApproval(
  principal: DomainPrincipal,
  approvalId: string,
  db: DomainDb,
) {
  requireAdminPrincipal(principal);
  const approval = await db.tradieApproval.findUnique({
    where: { id: approvalId },
    include: {
      tradie: { select: { id: true, name: true, trade: true, email: true } },
      user: { select: { name: true } },
    },
  });
  if (!approval) throw new DomainNotFoundError("Approval request not found.");
  return approval;
}

/**
 * Resolve one tradie approval and its requested change as one transaction.
 *
 * The App approval page and Eve used to carry near-identical copies of this
 * state machine. The important part is that resolving is a yes/no decision on
 * the stored request: an approver cannot replace the requested price or point
 * an approval at a different schedule while deciding it.
 */
export type ResolveTradieApprovalInput = {
  readonly approvalId: string;
  /** App supplies this as an input-contract check; Eve resolves by id. */
  readonly actionType?: TradieApprovalActionType;
  readonly resolution: "approved" | "rejected";
  readonly rejectionReason?: string | null;
  readonly incidentResolution?: string | null;
  /**
   * A removal approve only: the ids of the unfinished bookings the approver
   * was shown. The removal cancels every one, so it is refused without them,
   * and refused unless they are exactly the tradie's unfinished bookings now
   * (issue #526). Ids, not a count: one booking done and another added keeps
   * the count and would cancel a booking nobody reviewed.
   */
  readonly reviewedBookingIds?: readonly string[] | null;
};

export type ResolvedTradieApproval = {
  readonly approvalId: string;
  readonly actionType: TradieApprovalActionType;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly tradieTrade: string;
  readonly resolution: "approved" | "rejected";
  readonly affected: Record<string, unknown>;
};

export async function resolveTradieApproval(
  principal: DomainPrincipal,
  input: ResolveTradieApprovalInput,
  db: DomainDb,
): Promise<ResolvedTradieApproval> {
  requireAdminPrincipal(principal);

  if (input.resolution === "rejected" && !input.rejectionReason?.trim()) {
    throw new DomainValidationError("A rejection reason is required.");
  }

  const run = async (tx: DomainDb): Promise<ResolvedTradieApproval> => {
    const claimed = await tx.tradieApproval.updateMany({
      data: {
        pendingDeletionKey: null,
        rejectionReason:
          input.resolution === "approved"
            ? null
            : (input.rejectionReason?.trim() ?? null),
        status:
          input.resolution === "approved"
            ? TradieApprovalStatus.APPROVED
            : TradieApprovalStatus.REJECTED,
      },
      where: {
        id: input.approvalId,
        status: TradieApprovalStatus.PENDING,
      },
    });
    if (claimed.count !== 1) {
      throw new DomainTransitionError(
        "That approval is no longer pending; refresh the queue before deciding.",
      );
    }

    const approval = await tx.tradieApproval.findUnique({
      select: {
        actionType: true,
        id: true,
        tradie: { select: { id: true, name: true, trade: true } },
        tradieId: true,
        updationData: true,
      },
      where: { id: input.approvalId },
    });
    if (!approval) throw new DomainNotFoundError("Approval request not found.");
    if (
      input.actionType !== undefined
      && approval.actionType !== input.actionType
    ) {
      throw new DomainValidationError(
        "Approval action type does not match the request.",
        "actionType",
      );
    }

    const payload = asRecord(approval.updationData);
    const approved = input.resolution === "approved";
    let affected: Record<string, unknown> = {};

    if (approved) {
      switch (approval.actionType) {
        case TradieApprovalActionType.PRICE_CHANGE: {
          const amount = payload?.newHourlyRate;
          if (
            typeof amount !== "number"
            || !Number.isFinite(amount)
            || amount < 0
          ) {
            throw new DomainValidationError(
              "This price change request has no valid recorded amount.",
            );
          }
          const unit = payload?.newPriceUnit;
          await tx.tradie.update({
            data: {
              lastQuotedPrice: amount,
              ...(unit === "HOURLY" || unit === "FIXED"
                ? { lastQuotedPriceUnit: unit }
                : {}),
            },
            where: { id: approval.tradieId },
          });
          affected = { amount, unit: unit ?? null };
          break;
        }

        case TradieApprovalActionType.TRADIE_REMOVAL: {
          // The same bookings getTradieRemovalImpact shows the approver.
          const bookings = await tx.tradieSchedule.findMany({
            where: {
              tradieId: approval.tradieId,
              status: { notIn: INACTIVE_SCHEDULE_STATUSES },
            },
            select: { id: true, projectId: true },
          });
          const reviewed = input.reviewedBookingIds;
          if (!reviewed) {
            throw new DomainValidationError(
              "Approving a removal cancels the tradie's unfinished bookings, so it needs the bookings that were reviewed. Open the request to review them.",
              "reviewedBookingIds",
            );
          }
          const reviewedSet = new Set(reviewed);
          if (
            reviewedSet.size !== bookings.length
            || bookings.some((booking) => !reviewedSet.has(booking.id))
          ) {
            throw new DomainTransitionError(
              `This tradie's unfinished bookings changed since they were reviewed (${bookings.length} now). Review them again before approving.`,
            );
          }
          const archived = await tx.tradie.updateMany({
            where: { id: approval.tradieId, archivedAt: null },
            data: { archivedAt: new Date(), isFavourite: false },
          });
          if (archived.count !== 1) {
            throw new DomainTransitionError(
              "This tradie has already been removed.",
            );
          }
          const cancelled = await tx.tradieSchedule.updateMany({
            where: {
              tradieId: approval.tradieId,
              status: { notIn: INACTIVE_SCHEDULE_STATUSES },
            },
            data: { status: TradieScheduleStatus.CANCELLED },
          });
          // These requests can no longer be acted on after removal. Incident
          // resolution stays available so existing incidents can be closed.
          await tx.tradieApproval.updateMany({
            where: {
              tradieId: approval.tradieId,
              status: TradieApprovalStatus.PENDING,
              actionType: { not: TradieApprovalActionType.INCIDENT_RESOLUTION },
            },
            data: {
              status: TradieApprovalStatus.REJECTED,
              pendingDeletionKey: null,
              rejectionReason: "Tradie removed from the active directory.",
            },
          });
          // A removed tradie cannot hold a trade. Left alone, an active
          // selection would block anyone else being chosen, and one waiting on
          // the cancellation just rejected above would wait for ever.
          const endedSelections = await tx.tradeSelection.updateMany({
            data: {
              cancelledAt: new Date(),
              status: TradeSelectionStatus.CANCELLED,
            },
            where: {
              status: { in: [...LIVE_SELECTION_STATUSES] },
              tradieId: approval.tradieId,
            },
          });
          await recordTradieActivity(
            {
              data: {
                cancelledBookings: cancelled.count,
                tradieId: approval.tradieId,
              },
              principal,
              type: "removedFromDirectory",
            },
            tx,
          );
          affected = {
            archived: true,
            cancelledSchedules: cancelled.count,
            endedSelections: endedSelections.count,
            projectIds: [
              ...new Set(bookings.map((booking) => booking.projectId)),
            ],
          };
          break;
        }

        case TradieApprovalActionType.INCIDENT_RESOLUTION: {
          const incidentId = stringValue(payload?.incidentId);
          const resolution = input.incidentResolution?.trim();
          if (!incidentId) {
            throw new DomainValidationError(
              "This incident approval has no incident reference.",
            );
          }
          if (!resolution) {
            throw new DomainValidationError(
              "An incident resolution note is required.",
              "incidentResolution",
            );
          }
          const incident = await tx.tradieIncident.findFirst({
            select: { id: true },
            where: { id: incidentId, tradieId: approval.tradieId },
          });
          if (!incident) {
            throw new DomainNotFoundError(
              "The incident could not be found for this tradie.",
            );
          }
          await tx.tradieIncident.update({
            data: { resolution, status: "RESOLVED" },
            where: { id: incident.id },
          });
          await recordTradieActivity(
            {
              data: { resolution, tradieId: approval.tradieId },
              principal,
              type: "incidentResolved",
            },
            tx,
          );
          affected = { incidentId: incident.id, status: "RESOLVED" };
          break;
        }

        case TradieApprovalActionType.SCHEDULE_APPROVAL: {
          const scheduleId = stringValue(payload?.scheduleId);
          if (!scheduleId) {
            throw new DomainValidationError(
              "This schedule approval has no schedule reference.",
            );
          }
          const changed = await tx.tradieSchedule.updateMany({
            data: {
              reminderSentAt: null,
              status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
            },
            where: {
              id: scheduleId,
              status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
              tradieId: approval.tradieId,
            },
          });
          if (changed.count !== 1) {
            throw new DomainTransitionError(
              "This schedule is no longer awaiting admin approval.",
            );
          }
          await recordScheduleDecision(
            principal,
            approval.tradieId,
            payload,
            TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
            tx,
          );
          affected = {
            scheduleId,
            status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
          };
          break;
        }

        case TradieApprovalActionType.SCHEDULE_DELETION: {
          const scheduleId = stringValue(payload?.scheduleId);
          if (!scheduleId) {
            throw new DomainValidationError(
              "This deletion approval has no schedule reference.",
            );
          }
          const projectId = stringValue(payload?.projectId);
          const project = projectId
            ? await tx.project.findUnique({
                select: { siteManagerId: true },
                where: { id: projectId },
              })
            : null;
          const deleted = await tx.tradieSchedule.deleteMany({
            where: { id: scheduleId, tradieId: approval.tradieId },
          });
          if (deleted.count === 1 && projectId) {
            await recordTradieActivity(
              {
                data: {
                  milestoneId: stringValue(payload?.milestoneId),
                  projectId,
                  scheduleId,
                  scheduledDate:
                    stringValue(payload?.scheduledDate)?.slice(0, 10) ?? null,
                  tradieId: approval.tradieId,
                },
                principal,
                type: "bookingDeleted",
              },
              tx,
            );
          }
          // The booking row is gone by now, so everything the adapter needs to
          // describe it — the date a site manager reads in the notification,
          // the milestone the activity entry is filed against — has to come off
          // the request that recorded them. Dropping them here left the site
          // manager a message reading "booking on  was removed".
          affected = {
            deleted: deleted.count === 1,
            milestoneId: stringValue(payload?.milestoneId),
            milestoneName: stringValue(payload?.milestoneName),
            projectId,
            projectName: stringValue(payload?.projectName),
            scheduleId,
            scheduledDate: stringValue(payload?.scheduledDate),
            siteManagerId: project?.siteManagerId ?? null,
          };
          break;
        }

        case TradieApprovalActionType.TRADE_CANCELLATION: {
          affected = await settleTradeCancellation(
            { id: approval.id, payload, tradieId: approval.tradieId },
            true,
            tx,
          );
          await recordCancellationDecision(
            principal,
            approval.tradieId,
            affected,
            true,
            tx,
          );
          break;
        }
      }
    } else if (
      approval.actionType === TradieApprovalActionType.TRADE_CANCELLATION
    ) {
      affected = await settleTradeCancellation(
        { id: approval.id, payload, tradieId: approval.tradieId },
        false,
        tx,
      );
      await recordCancellationDecision(
        principal,
        approval.tradieId,
        affected,
        false,
        tx,
      );
    } else if (
      approval.actionType === TradieApprovalActionType.SCHEDULE_APPROVAL
    ) {
      const scheduleId = stringValue(payload?.scheduleId);
      if (scheduleId) {
        const declined = await tx.tradieSchedule.updateMany({
          data: { status: TradieScheduleStatus.DECLINED },
          where: {
            id: scheduleId,
            status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
            tradieId: approval.tradieId,
          },
        });
        if (declined.count === 1) {
          await recordScheduleDecision(
            principal,
            approval.tradieId,
            payload,
            TradieScheduleStatus.DECLINED,
            tx,
          );
        }
        affected = { scheduleId, status: TradieScheduleStatus.DECLINED };
      }
    }

    return {
      actionType: approval.actionType,
      affected,
      approvalId: approval.id,
      resolution: input.resolution,
      tradieId: approval.tradie.id,
      tradieName: approval.tradie.name,
      tradieTrade: approval.tradie.trade,
    };
  };

  // A removal approve (the only caller that sends reviewed bookings) runs
  // Serializable: a booking added between the review check and the
  // cancellation aborts the approve instead of being cancelled unreviewed.
  // Only that one: the bulk approve runs five resolves at once, and
  // Serializable on all of them would abort each other on these small tables.
  if (!("$transaction" in db)) return run(db);
  return input.reviewedBookingIds
    ? db.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    : db.$transaction(run);
}

/** An admin's decision on a booking's approval, on the tradie's history. */
async function recordScheduleDecision(
  principal: DomainPrincipal,
  tradieId: string,
  payload: Record<string, unknown> | null,
  to: TradieScheduleStatus,
  tx: DomainDb,
): Promise<void> {
  const scheduleId = stringValue(payload?.scheduleId);
  const projectId = stringValue(payload?.projectId);
  if (!scheduleId || !projectId) return;
  await recordTradieActivity(
    {
      data: {
        from: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        milestoneId: stringValue(payload?.milestoneId),
        projectId,
        scheduleId,
        to,
        tradieId,
      },
      principal,
      type: "bookingStatusChanged",
    },
    tx,
  );
}

/** An admin's decision on releasing a selected tradie. */
async function recordCancellationDecision(
  principal: DomainPrincipal,
  tradieId: string,
  affected: Record<string, unknown>,
  approved: boolean,
  tx: DomainDb,
): Promise<void> {
  const projectId = stringValue(affected.projectId);
  if (!projectId) return;
  await recordTradieActivity(
    {
      data: {
        approved,
        cancelledBookings:
          typeof affected.cancelledSchedules === "number"
            ? affected.cancelledSchedules
            : 0,
        projectId,
        trade: stringValue(affected.trade) ?? "the trade",
        tradieId,
      },
      principal,
      type: "tradeCancellationResolved",
    },
    tx,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
