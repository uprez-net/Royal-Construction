import type { DomainDb } from "../../db";
import { cap, DEAD_BOOKINGS, type BuiltBriefing } from "./briefing-lines";
import type { VoiceCallerPrincipal } from "./identity";
import { currentVoiceTradie } from "./relationships";
import {
  addDays,
  bookingStatus,
  field,
  spokenDate,
  startOfSydneyDay,
} from "./speech";

// TRADIE: only their own bookings, with the project name, site address and
// activity they need to turn up. No prices, other trades, customer details
// or notes.

export async function tradieBriefing(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
  now: Date,
): Promise<BuiltBriefing> {
  const tradie = await currentVoiceTradie(caller, db);
  const today = startOfSydneyDay(now);
  // Resolved through the tradie's own engagement: the booking is found by
  // tradieId, and the project and activity come from the booking.
  const bookings = await db.tradieSchedule.findMany({
    orderBy: { scheduledDate: "asc" },
    select: {
      durationDays: true,
      id: true,
      milestone: { select: { name: true } },
      project: { select: { id: true, location: true, name: true } },
      scheduledDate: true,
      status: true,
      trade: true,
    },
    take: 10,
    where: {
      scheduledDate: { gte: addDays(today, -14), lt: addDays(today, 90) },
      status: { notIn: DEAD_BOOKINGS },
      tradieId: tradie.id,
    },
  });
  const lines = bookings.length
    ? [
        "Their bookings with Royal Constructions (from two weeks ago to three months ahead):",
        ...bookings.map((booking) => {
          const what = [
            booking.milestone ? field(booking.milestone.name) : null,
            booking.trade ? field(booking.trade, 40) : null,
          ]
            .filter(Boolean)
            .join(", ");
          const days =
            booking.durationDays > 1 ? ` for ${booking.durationDays} days` : "";
          return `- ${what || "Work"} at ${field(booking.project.name)}, ${field(booking.project.location)}: the current schedule shows ${spokenDate(booking.scheduledDate, now)}${days}; booking ${bookingStatus(booking.status)}.`;
        }),
      ]
    : [
        "No bookings are on file for them in the next three months; offer the team.",
      ];
  return {
    recordIds: [
      `tradie:${tradie.id}`,
      ...bookings.map((b) => `booking:${b.id}`),
    ],
    text: cap(lines),
  };
}
