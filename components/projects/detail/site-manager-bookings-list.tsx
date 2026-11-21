import { TradieScheduleStatus } from "@prisma/client";

import { TableCard } from "@/components/common/list-toolbar";
import { CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bookingLastDay } from "@/lib/domain/tradies/alert-rules";
import { bookingTrade } from "@/lib/domain/tradies/request-rules";
import { formatSydneyDate } from "@/lib/dates/sydney";
import type { ProjectDetail } from "@/types/project";

// What a site manager sees on the Tradies tab: who is booked on this project,
// for what, and when. Read-only, with no prices, quote state or buttons; the
// booking, reminder and quote actions are the office's (`viewerAccess.book`).

// Booked means the tradie is coming (or came): a request, a quote or a
// booking still waiting on the office is not shown as one.
const BOOKED = new Set<TradieScheduleStatus>([
  TradieScheduleStatus.CONFIRMED,
  TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
  TradieScheduleStatus.COMPLETED,
]);

export function SiteManagerBookingsList({
  project,
}: {
  project: Pick<ProjectDetail, "tradieSchedules">;
}) {
  const bookings = project.tradieSchedules
    .filter((booking) => BOOKED.has(booking.status))
    .sort(
      (a, b) =>
        new Date(a.scheduledDate).getTime()
        - new Date(b.scheduledDate).getTime(),
    );

  return (
    <TableCard
      header={
        <CardTitle as="h2" className="text-base font-semibold text-foreground">
          Tradies booked
        </CardTitle>
      }
    >
      {bookings.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          No tradies booked yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tradie</TableHead>
                <TableHead>Trade</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => {
                const days = Math.max(1, booking.durationDays);
                const first = new Date(booking.scheduledDate);
                const last = new Date(`${bookingLastDay(booking)}T00:00:00Z`);
                return (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">
                      {booking.tradie.name}
                    </TableCell>
                    <TableCell>{bookingTrade(booking)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {days === 1
                        ? formatSydneyDate(first)
                        : `${formatSydneyDate(first)} – ${formatSydneyDate(last)}`}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {days === 1 ? "1 day" : `${days} days`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </TableCard>
  );
}
