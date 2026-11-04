import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import { authorizeProject } from "../access/projects";
import type { DomainPrincipal } from "../principal";

/**
 * Dismiss the alerts on some of a project's bookings.
 *
 * Remembered against the status each booking holds now, so it is the same for
 * everyone on the shared login and survives a reload, and the alert comes back
 * by itself once the booking moves — a dismissed "has not responded" returns
 * as something new if the tradie then declines. Conditional on that status, so
 * a booking that moved between the screen loading and the click is not
 * silenced for a status nobody saw.
 */
export async function dismissTradieScheduleAlerts(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly scheduleIds: readonly string[];
  },
  db: DomainDb,
): Promise<{ readonly dismissed: readonly string[] }> {
  await authorizeProject(principal, input.projectId, db);

  const ids = [...new Set(input.scheduleIds)];
  const bookings = await db.tradieSchedule.findMany({
    select: { id: true, status: true },
    where: { id: { in: ids }, projectId: input.projectId },
  });
  if (bookings.length !== ids.length) {
    throw new DomainNotFoundError(
      "One or more of those bookings is not on this project.",
    );
  }

  const now = new Date();
  const dismissed: string[] = [];
  for (const booking of bookings) {
    const result = await db.tradieSchedule.updateMany({
      data: { alertDismissedAt: now, alertDismissedStatus: booking.status },
      where: { id: booking.id, status: booking.status },
    });
    if (result.count === 1) dismissed.push(booking.id);
  }

  return { dismissed };
}
