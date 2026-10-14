"use client";

import { useMemo, type ComponentProps } from "react";
import { format } from "date-fns";

import { CalendarDayButton } from "@/components/ui/calendar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  bookingsOn,
  describeBooking,
  type TradieBooking,
} from "./tradie-bookings";

/**
 * A calendar day button that marks the days a tradie is already booked, for
 * the booking and reschedule pickers alike. Needs a `TooltipProvider` above
 * the calendar.
 *
 * Marked, not disabled: the office may book a tradie onto two jobs on one
 * day, so a booked day stays pickable and just says what is on it.
 */
export function useBookedDayButton(bookings: readonly TradieBooking[]) {
  return useMemo(() => {
    function BookedAwareDayButton(
      props: ComponentProps<typeof CalendarDayButton>,
    ) {
      const booked = bookingsOn(bookings, format(props.day.date, "yyyy-MM-dd"));
      if (booked.length === 0) return <CalendarDayButton {...props} />;
      // The tooltip hangs off a wrapper because CalendarDayButton keeps its
      // own ref.
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block w-full">
              <CalendarDayButton
                {...props}
                className={cn(
                  props.className,
                  "bg-warning-light text-warning-ink hover:bg-warning/30",
                )}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="flex-col items-start">
            <span className="font-medium">Already booked</span>
            {booked.map((booking) => (
              <span key={booking.scheduleId}>{describeBooking(booking)}</span>
            ))}
          </TooltipContent>
        </Tooltip>
      );
    }
    return BookedAwareDayButton;
  }, [bookings]);
}
