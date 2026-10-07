import { TradieScheduleStatus } from "@prisma/client";
import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainTransitionError } from "../errors";
import { scheduleTotalCost } from "../../../utils/calculations";

/** Completed, declined and cancelled bookings no longer reserve work. */
export const INACTIVE_SCHEDULE_STATUSES = [
  TradieScheduleStatus.DECLINED,
  TradieScheduleStatus.COMPLETED,
  TradieScheduleStatus.CANCELLED,
];

export async function requireActiveTradie(tradieId: string, db: DomainDb) {
  const tradie = await db.tradie.findUnique({ where: { id: tradieId } });
  if (!tradie) throw new DomainNotFoundError("Tradie not found.");
  if (tradie.archivedAt) {
    throw new DomainTransitionError(
      "This tradie has been removed from the active directory.",
    );
  }
  return tradie;
}

/** Removed bookings remain in history but cannot inflate milestone spend. */
export function tradieScheduleSpend(schedule: {
  status: TradieScheduleStatus;
  requiresQuote: boolean;
  quotedPrice: string | null;
  durationDays: number;
  tradie: {
    lastQuotedPrice?: string | null;
    lastQuotedPriceUnit: "HOURLY" | "FIXED";
  };
}): number {
  if (schedule.status === TradieScheduleStatus.CANCELLED) return 0;
  return schedule.requiresQuote
    ? parseFloat(schedule.quotedPrice ?? "0")
    : scheduleTotalCost(
        parseFloat(schedule.tradie.lastQuotedPrice ?? "0"),
        schedule.durationDays,
        schedule.tradie.lastQuotedPriceUnit,
      );
}
