"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parse, startOfDay } from "date-fns";
import { CalendarIcon, Info, Loader2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  EmailPreviewFrame,
  type EmailPreviewFrameHandle,
} from "@/components/common/email-preview-frame";
import { useBookedDayButton } from "@/components/projects/detail/modal/booked-day-button";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import {
  getTradieBookings,
  rescheduleTradieScheduleAction,
} from "@/lib/data/tradieSchedules";
import type { TradieBooking } from "@/components/projects/detail/modal/tradie-bookings";
import { rescheduleOutcome } from "@/lib/domain/tradies/reschedule-rules";
import { useAppDispatch } from "@/lib/store/hooks";
import { updateProjectTradieSchedule } from "@/lib/store/slices/projectsSlice";
import { cn } from "@/lib/utils";
import type { TradieScheduleListItem } from "@/types/project";
import { generateTradieRescheduleEmail } from "@/utils/generate-email";

/** A booking date as `YYYY-MM-DD`, whichever shape the list item carries. */
function bookingDay(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : format(new Date(value), "yyyy-MM-dd");
}

/** `YYYY-MM-DD` shifted by whole days, without a timezone in the way. */
function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const displayDay = (day: string) =>
  format(parse(day, "yyyy-MM-dd", new Date()), "EEE d MMM yyyy");

/**
 * Move a booking to another day — the site is not ready, the slab was rained
 * off — and tell the tradie.
 *
 * What happens to the booking is `rescheduleOutcome`'s decision, the same one
 * the server applies, and the dialog says it before anything is pressed:
 *
 * - approved (confirmed, or waiting on the tradie's final word): it stays
 *   approved and only needs the tradie to confirm the new date;
 * - not yet approved: the tradie gets a follow-up with the date updated, asking
 *   them to confirm their availability again.
 *
 * Starts on the next day, which is the usual move.
 */
export function RescheduleScheduleModal({
  schedule,
  open,
  onOpenChange,
  onDone,
}: {
  schedule: TradieScheduleListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const attemptKey = useIdempotencyKey();
  const previewRef = useRef<EmailPreviewFrameHandle | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentDay = bookingDay(schedule.scheduledDate);
  const outcome = rescheduleOutcome(schedule.status);
  const recipient = schedule.contact.email.trim();

  // The next day, unless that is already behind us: a booking whose date has
  // passed moves to today at the earliest.
  const [day, setDay] = useState(() => {
    const next = shiftDay(currentDay, 1);
    const today = format(new Date(), "yyyy-MM-dd");
    return next < today ? today : next;
  });
  const [durationDays, setDurationDays] = useState(schedule.durationDays);
  const [notify, setNotify] = useState(Boolean(recipient));
  const [error, setError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<TradieBooking[]>([]);

  // The tradie's other bookings, marked on the calendar. This one is left
  // out: the day it is moving off is not a clash.
  useEffect(() => {
    let cancelled = false;
    getTradieBookings(schedule.tradieId)
      .then((result) => {
        if (!cancelled && result.ok) {
          setBookings(
            result.bookings.filter(
              (booking) => booking.scheduleId !== schedule.id,
            ),
          );
        }
      })
      .catch(() => {
        // Unmarked days are a lesser view, not a reason to block the move.
      });
    return () => {
      cancelled = true;
    };
  }, [schedule.id, schedule.tradieId]);
  const DayButton = useBookedDayButton(bookings);

  const email = useMemo(
    () =>
      outcome
        ? generateTradieRescheduleEmail(
            {
              ...schedule,
              durationDays,
              scheduledDate: `${day}T00:00:00.000Z`,
            },
            {
              durationDays: schedule.durationDays,
              scheduledDate: `${currentDay}T00:00:00.000Z`,
            },
            outcome.notice,
          )
        : null,
    [currentDay, day, durationDays, outcome, schedule],
  );
  // The subject depends only on which email this is, which is fixed for the
  // dialog, so an edit to it survives a change of date.
  const [subject, setSubject] = useState(email?.subject ?? "");

  const unchanged =
    day === currentDay && durationDays === schedule.durationDays;
  const validDuration =
    Number.isInteger(durationDays) && durationDays >= 1 && durationDays <= 365;

  const handleSubmit = () => {
    if (!outcome || !email) return;
    setError(null);
    startTransition(async () => {
      const result = await rescheduleTradieScheduleAction({
        durationDays,
        email: notify
          ? {
              body: previewRef.current?.readHtml() ?? email.html,
              subject,
            }
          : null,
        expectedStatus: schedule.status,
        idempotencyKey: attemptKey.current(),
        scheduleId: schedule.id,
        scheduledDate: day,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      attemptKey.rotate();

      dispatch(
        updateProjectTradieSchedule({
          projectId: schedule.projectId,
          scheduleId: schedule.id,
          update: {
            alertDismissedStatus: null,
            durationDays: result.durationDays,
            reminderSentAt: null,
            scheduledDate: new Date(result.scheduledDate),
            status: result.status,
          },
        }),
      );

      const moved = `${schedule.tradieName}'s booking moved to ${displayDay(day)}.`;
      const withdrawn = result.withdrewApproval
        ? " The approval waiting for the old date was withdrawn."
        : "";
      if (result.email === "failed") {
        // Said loudly and kept on screen: the booking moved, the tradie was
        // not told, and only the office can fix that.
        toast.error(
          `${moved} But the email to ${schedule.tradieName} failed${result.emailError ? ` — ${result.emailError}` : ""}. Send them a reminder or call them.${withdrawn}`,
          { duration: Infinity },
        );
      } else if (result.email === "not-sent") {
        toast.warning(
          `${moved} ${schedule.tradieName} has not been emailed — let them know and record their answer.${withdrawn}`,
          { duration: 10_000 },
        );
      } else {
        toast.success(
          `${moved} ${schedule.tradieName} has been emailed to confirm the new date.${withdrawn}`,
        );
      }

      onOpenChange(false);
      onDone();
      router.refresh();
    });
  };

  const selected = parse(day, "yyyy-MM-dd", new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[14px] border border-border/70 bg-card p-0 shadow-2xl sm:max-w-3xl",
          "flex max-h-[90dvh] flex-col",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 text-left">
          <DialogTitle className="text-[18px] font-bold tracking-[-0.02em] text-foreground">
            Reschedule — {schedule.tradieName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {schedule.projectName} · {schedule.taskLabel} · currently{" "}
            {displayDay(currentDay)}
            {schedule.durationDays > 1
              ? ` for ${schedule.durationDays} days`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {!outcome ? (
            <p className="text-sm text-muted-foreground">
              This booking can no longer be rescheduled.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <div className="space-y-2">
                  <Label htmlFor="reschedule-date">New start date</Label>
                  <Popover modal>
                    <PopoverTrigger asChild>
                      <Button
                        id="reschedule-date"
                        type="button"
                        variant="outline"
                        className="w-full justify-start font-normal"
                      >
                        <CalendarIcon className="mr-2 size-4" aria-hidden="true" />
                        {displayDay(day)}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <TooltipProvider delayDuration={150}>
                        <Calendar
                          mode="single"
                          selected={selected}
                          defaultMonth={selected}
                          captionLayout="dropdown"
                          disabled={{ before: startOfDay(new Date()) }}
                          onSelect={(date) => {
                            if (date) setDay(format(date, "yyyy-MM-dd"));
                          }}
                          components={{ DayButton }}
                        />
                      </TooltipProvider>
                    </PopoverContent>
                  </Popover>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 7].map((offset) => (
                      <Button
                        key={offset}
                        type="button"
                        size="sm"
                        variant={
                          day === shiftDay(currentDay, offset)
                            ? "secondary"
                            : "ghost"
                        }
                        className="h-7 px-2 text-xs"
                        onClick={() => setDay(shiftDay(currentDay, offset))}
                      >
                        {offset === 1
                          ? "Next day"
                          : offset === 7
                            ? "A week later"
                            : `${offset} days later`}
                      </Button>
                    ))}
                  </div>
                  {bookings.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Days this tradie is booked elsewhere are marked in yellow
                      and can still be picked.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reschedule-duration">Duration (days)</Label>
                  <Input
                    id="reschedule-duration"
                    type="number"
                    min={1}
                    max={365}
                    inputMode="numeric"
                    value={Number.isNaN(durationDays) ? "" : durationDays}
                    onChange={(event) =>
                      setDurationDays(event.target.valueAsNumber)
                    }
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs leading-5 text-foreground">
                <p className="font-semibold">What happens to the booking</p>
                <p className="mt-1 text-muted-foreground">
                  {outcome.notice === "reconfirm-attendance"
                    ? `It stays approved — no new admin approval is needed. It waits on ${schedule.tradieName} to confirm they can attend the new date, and their "confirmed" reply settles it.`
                    : outcome.withdrawsApproval
                      ? `${schedule.tradieName} confirmed the old date, but it has not been approved yet. That approval is withdrawn, and the booking goes back to waiting on ${schedule.tradieName} to confirm the new date; their yes raises a fresh approval.`
                      : `It has not been approved yet. ${schedule.tradieName} is followed up with the new date and asked to confirm their availability again.`}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="reschedule-notify"
                    checked={notify}
                    disabled={!recipient}
                    onCheckedChange={(checked) => setNotify(checked === true)}
                  />
                  <Label
                    htmlFor="reschedule-notify"
                    className="text-sm leading-5 font-normal"
                  >
                    {recipient
                      ? `Email ${schedule.tradieName} (${recipient}) about the change`
                      : `${schedule.tradieName} has no email on file — call them about the change`}
                  </Label>
                </div>

                {notify && email ? (
                  <>
                    <div>
                      <Label
                        htmlFor="reschedule-subject"
                        className="mb-1.25 block text-[11.5px] font-semibold text-muted-foreground"
                      >
                        Subject
                      </Label>
                      <Input
                        id="reschedule-subject"
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                        className="text-[13px] font-semibold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-[11.5px] font-semibold text-muted-foreground">
                          Email
                        </Label>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                          <Info className="size-3" aria-hidden="true" />
                          Click to edit. Changing the date rewrites it.
                        </span>
                      </div>
                      <EmailPreviewFrame
                        ref={previewRef}
                        // Fit to width: the dialog scrolls, and fitting a long
                        // email to a fixed height shrank it to a narrow strip.
                        maxHeight={Infinity}
                        minScale={0.4}
                        html={email.html}
                        title={`Reschedule email to ${schedule.tradieName}`}
                      />
                    </div>
                  </>
                ) : null}
              </div>

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-[8px] bg-destructive-light px-3 py-2 text-[12px] text-destructive"
                >
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {error}
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border/70 px-6 py-4">
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={
              isPending
              || !outcome
              || unchanged
              || !validDuration
              || (notify && !subject.trim())
            }
            onClick={handleSubmit}
          >
            {isPending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
            ) : notify ? (
              <Send className="mr-1.5 size-4" aria-hidden="true" />
            ) : (
              <CalendarIcon className="mr-1.5 size-4" aria-hidden="true" />
            )}
            {notify ? "Reschedule & email tradie" : "Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
