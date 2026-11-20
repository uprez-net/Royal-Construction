"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  Check,
  Clock,
  Calendar as CalendarIcon,
  Video,
  MapPin,
  ArrowRight,
  Loader2,
} from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DEFAULT_CONSULTATION_VENUE,
  MAX_CONSULTATION_VENUE_LENGTH,
} from "@/lib/leads/consultation-venue";
import { sydneyTimeZoneAbbreviation } from "@/lib/dates/sydney";
import {
  CONSULTATION_DURATIONS_MINUTES,
  DEFAULT_CONSULTATION_MINUTES,
  consultationDurationLabel,
  consultationHours,
  consultationStartTimes,
  type ConsultationDurationMinutes,
} from "@/lib/domain/leads/consultation-hours";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// ─── Royal Constructions Light Theme ────────────────────────────────────────
// Brand tokens live in globals.css as CSS variables; Tailwind arbitrary-value
// classes (e.g. `bg-[var(--royal-gold)]`) reference them directly so the
// design system stays the single source of truth.

const LOGO_URL = "/logo-1024x713.png";
const NOTES_HELPER =
  "Include land size/status, project scope, room counts, granny flat needs, facade/material preferences, timeline, approval status, and quoting/readiness status.";

// The server pins Graph output to Sydney via `Prefer: outlook.timezone`, and
// the booking flow interprets the slot string as Sydney wall clock. Every date
// key and slot instant here is therefore derived in Sydney so the UI cannot
// drift from the server when a visitor's browser is in another timezone.
const BOOKING_TIMEZONE = "Australia/Sydney";

type DayBusy = { intervals: { start: Date; end: Date }[]; allDay: boolean };

// Graph (with Prefer: outlook.timezone) hands back a naive Sydney wall-clock
// string with no offset. If an offset is present we can parse it directly;
// otherwise the string has to be anchored to Sydney before it becomes an
// instant, or `new Date()` would reinterpret it in the browser's zone.
function parseEventInstant(dateTime: string): Date {
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(dateTime);
  const instant = hasOffset
    ? new Date(dateTime)
    : fromZonedTime(dateTime, BOOKING_TIMEZONE);
  return Number.isNaN(instant.getTime()) ? new Date(NaN) : instant;
}

// The hours and the lengths come from lib/domain/leads/consultation-hours.ts,
// which the booking route checks too: the page offers exactly what the route
// will take, and a request for anything else is refused there.
const generateTimeSlots = (date: Date | null, minutes: number) =>
  date ? consultationStartTimes(date.getDay(), minutes) : [];

/** "2 PM" style, from a whole-hour count. */
const formatHour = (hour: number) =>
  `${hour % 12 || 12}:00 ${hour >= 12 ? "PM" : "AM"}`;

function BookingContent() {
  const searchParams = useSearchParams();
  const TeammateName = searchParams.get("TeammateName") || "";
  const initialName = searchParams.get("name") || "";
  const initialEmail = searchParams.get("email") || "";
  const initialId = searchParams.get("id") || "";
  const bookingToken = searchParams.get("bookingToken") || "";

  const [clientName, setClientName] = useState(initialName);
  const [clientEmail, setClientEmail] = useState(initialEmail);
  const [notes, setNotes] = useState("");
  const [inPerson, setInPerson] = useState(false);
  const [venue, setVenue] = useState(DEFAULT_CONSULTATION_VENUE);
  // False when the booking went through but the in-person confirmation email
  // did not; the client has to be told, or they never learn the venue.
  const [confirmationSent, setConfirmationSent] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] =
    useState<ConsultationDurationMinutes>(DEFAULT_CONSULTATION_MINUTES);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [booked, setBooked] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [busySlotsMap, setBusySlotsMap] = useState<Record<string, DayBusy>>({});
  // An unreadable calendar must block booking, not fall through to an empty
  // busy map — that would render every slot, including taken ones, as free.
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const timeSlots = generateTimeSlots(selectedDate, durationMinutes);

  useEffect(() => {
    async function fetchCalendar() {
      try {
        const res = await fetch("/api/graph/read-calender-dateTime?days=60");
        const data = await res.json();
        if (res.ok && data.success) {
          const map: Record<string, DayBusy> = {};
          data.events.forEach(
            (event: {
              start?: { dateTime?: string };
              end?: { dateTime?: string };
              isAllDay?: boolean;
            }) => {
              const startStr = event.start?.dateTime;
              const endStr = event.end?.dateTime;
              // All-day events don't carry meaningful clock times — gate on
              // isAllDay explicitly and block the whole day rather than running
              // them through the interval logic.
              if (event.isAllDay) {
                if (!startStr) return;
                const key = formatInTimeZone(
                  parseEventInstant(startStr),
                  BOOKING_TIMEZONE,
                  "yyyy-MM-dd",
                );
                if (!map[key]) map[key] = { intervals: [], allDay: false };
                map[key].allDay = true;
                return;
              }
              if (!startStr || !endStr) return;
              const startInstant = parseEventInstant(startStr);
              const endInstant = parseEventInstant(endStr);
              if (
                Number.isNaN(startInstant.getTime())
                || Number.isNaN(endInstant.getTime())
              )
                return;
              const key = formatInTimeZone(
                startInstant,
                BOOKING_TIMEZONE,
                "yyyy-MM-dd",
              );
              if (!map[key]) map[key] = { intervals: [], allDay: false };
              map[key].intervals.push({ start: startInstant, end: endInstant });
            },
          );
          setBusySlotsMap(map);
        } else {
          console.error("Calendar unavailable", data?.error ?? res.status);
          setCalendarError("We could not load current availability.");
        }
      } catch (err) {
        console.error("Failed to fetch calendar", err);
        setCalendarError("We could not load current availability.");
      } finally {
        setLoading(false);
      }
    }
    fetchCalendar();
  }, []);

  const handleBook = async () => {
    const trimmedName = clientName.trim();
    const trimmedEmail = clientEmail.trim();
    if (!trimmedName || !trimmedEmail) {
      setError("Please enter your name and email to continue.");
      return;
    }
    if (!selectedDate || !selectedTime) {
      setError("Please select a date and time slot.");
      return;
    }
    const trimmedVenue = venue.trim();
    if (inPerson && !trimmedVenue) {
      setError("Please enter where the in-person meeting will be held.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const year = selectedDate.getFullYear();
    const month = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
    const day = selectedDate.getDate().toString().padStart(2, "0");
    const startDateTime = `${year}-${month}-${day}T${selectedTime}:00`;
    try {
      const res = await fetch("/api/graph/book-consultant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(initialId ? { id: Number(initialId) } : {}),
          ...(bookingToken ? { bookingToken } : {}),
          name: trimmedName,
          email: trimmedEmail,
          startDateTime,
          durationMinutes,
          notes: notes.trim(),
          ...(inPerson ? { inPerson: true, venue: trimmedVenue } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmationSent(data.confirmationSent !== false);
        setBooked(true);
      } else {
        setError(data.error || "Failed to book consultation.");
      }
    } catch (err) {
      console.error("Booking failed", err);
      setError("An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  // Slots are generated from `selectedDate`'s local wall-clock Y/M/D (the same
  // getters handleBook uses to build the booking string), then re-anchored to
  // Sydney as an instant. That keeps the date key and overlap check aligned with
  // the server regardless of the visitor's browser timezone, matching the
  // Sydney label that's already shown next to every slot.
  const slotInstant = (date: Date, time: string) => {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    return fromZonedTime(`${y}-${m}-${d}T${time}:00`, BOOKING_TIMEZONE);
  };

  // AEST or AEDT, for the date actually being booked. Both labels on this page
  // read "AEST" whatever the date, so from October to April the client chose
  // "4:00 pm (AEST)" and the calendar invitation that arrived said 4pm AEDT.
  // Midday when no slot is picked yet: the abbreviation is the same all day.
  const selectedZoneLabel = selectedDate
    ? sydneyTimeZoneAbbreviation(
        slotInstant(selectedDate, selectedTime || "12:00"),
      )
    : "AEST";

  // The whole meeting has to be free, not just its first hour: a two-hour
  // booking at 2pm runs into a 3pm event.
  const isSlotBusy = (
    date: Date,
    time: string,
    minutes: number = durationMinutes,
  ) => {
    const slotStart = slotInstant(date, time);
    const slotEnd = new Date(slotStart.getTime() + minutes * 60 * 1000);
    const dateKey = formatInTimeZone(slotStart, BOOKING_TIMEZONE, "yyyy-MM-dd");
    const day = busySlotsMap[dateKey];
    if (!day) return false;
    if (day.allDay) return true;
    // Half-open overlap, matching book-consultant/route.ts: an event ending at
    // a slot's start must not block it (10:00-11:00 event leaves 11:00 bookable).
    return day.intervals.some((iv) => iv.start < slotEnd && iv.end > slotStart);
  };

  const isDateFullyBooked = (date: Date) => {
    const expectedSlots = generateTimeSlots(date, durationMinutes);
    if (expectedSlots.length === 0) return false;
    return expectedSlots.every((slot) => isSlotBusy(date, slot));
  };

  const tomorrow = new Date(new Date().setDate(new Date().getDate() + 1));
  tomorrow.setHours(0, 0, 0, 0);

  const isDateDisabled = (date: Date) =>
    date < tomorrow || isDateFullyBooked(date);

  const formatDateLong = (date: Date) =>
    date.toLocaleDateString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const formatTimeDisplay = (time: string) => {
    const [h] = time.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${hour12}:00 ${ampm}`;
  };

  /** "2:00 PM – 3:30 PM". */
  const formatTimeRange = (time: string, minutes: number) => {
    const [h] = time.split(":").map(Number);
    const end = h * 60 + minutes;
    const endHour = Math.floor(end / 60);
    const endMinutes = (end % 60).toString().padStart(2, "0");
    const endLabel = `${endHour % 12 || 12}:${endMinutes} ${endHour >= 12 ? "PM" : "AM"}`;
    return `${formatTimeDisplay(time)} – ${endLabel}`;
  };

  /**
   * Picking a longer meeting can leave the chosen start with no room before
   * closing, or running into a booked hour. Clear it then, rather than leave a
   * slot selected that the list no longer offers.
   */
  const chooseDuration = (minutes: ConsultationDurationMinutes) => {
    setDurationMinutes(minutes);
    if (
      selectedDate
      && selectedTime
      && (!generateTimeSlots(selectedDate, minutes).includes(selectedTime)
        || isSlotBusy(selectedDate, selectedTime, minutes))
    ) {
      setSelectedTime(null);
    }
  };

  const displayName = clientName.trim() || "Client";

  // ─── Booked confirmation screen ───────────────────────────────────────────
  if (booked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
        <Card className="w-full max-w-md border-border text-center shadow-sm">
          <CardContent className="pt-10 pb-8">
            <div className="mx-auto mb-6 flex h-18 w-18 items-center justify-center rounded-full bg-success-light">
              <Check className="h-9 w-9 text-success" />
            </div>
            <h1 className="mb-3 font-condensed text-2xl font-medium uppercase tracking-tight text-foreground">
              Consultation Booked
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your meeting has been scheduled.
            </p>
            <div className="mt-8 rounded-md border border-border bg-muted px-5 py-4">
              <div className="flex items-center justify-center gap-2.5">
                {inPerson ? (
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-[13px] text-muted-foreground">
                  {!inPerson
                    ? `An invite has also been sent to ${clientEmail}`
                    : confirmationSent
                      ? `A confirmation with the venue details has been sent to ${clientEmail}`
                      : `In person at ${venue.trim()}`}
                </span>
              </div>
            </div>
            {!confirmationSent && (
              <Alert className="mt-4 text-left">
                <AlertDescription>
                  Your meeting is booked, but we could not email your
                  confirmation. Our team will be in touch, or call us on 1300
                  832 355.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      {/* ═══ HEADER ═══ */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Image
            height={1200}
            width={720}
            src={LOGO_URL}
            alt="Royal Constructions"
            className="h-12 w-auto object-contain"
          />
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <span className="text-xs font-medium text-muted-foreground">
              Booking System
            </span>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="mx-auto max-w-3xl px-6 pt-10 pb-16">
        <div className="mb-10 text-center">
          <Badge
            variant="outline"
            className="mb-5 gap-2 rounded-full border-transparent bg-royal-gold-light px-4 py-1.5 text-xs font-semibold tracking-wide text-royal-gold-ink-text"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            SCHEDULE MEETING
          </Badge>
          <h1 className="mb-2 font-condensed text-[1.75rem] font-medium uppercase leading-[1.2] tracking-wide text-foreground">
            Schedule Your
            <br />
            Consultation Meeting
          </h1>
          {!TeammateName ? (
            <p className="text-sm font-normal text-muted-foreground">
              Welcome,{" "}
              <strong className="font-semibold text-foreground">
                {displayName}
              </strong>
              . Please choose a convenient date and time below.
            </p>
          ) : null}
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              Loading availability...
            </p>
          </div>
        ) : calendarError ? (
          /* Availability is unknown, so no slot can be offered honestly. Showing
             the picker here would present taken slots as free. */
          <Card className="border-border shadow-sm">
            <CardContent className="px-6 py-10 text-center">
              <p className="text-[15px] font-medium text-foreground">
                {calendarError}
              </p>
              <p className="mx-auto mt-2.5 mb-5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                To avoid booking a time that is already taken, online booking is
                paused. Please try again, or contact us directly and we will
                arrange your consultation.
              </p>
              <Button
                onClick={() => window.location.reload()}
                className="bg-royal-gold-ink text-card hover:bg-royal-gold-ink-hover"
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {/* ═══ CONTACT DETAILS ═══ */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[17px] font-semibold">
                  {TeammateName ? "Client Details" : "Your Details"}
                </CardTitle>
                <CardDescription className="text-[13px] font-normal">
                  Confirm your contact details so we can send the invite.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="booking-name"
                      className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      Full Name
                    </Label>
                    <Input
                      id="booking-name"
                      name="name"
                      autoComplete="name"
                      type="text"
                      value={clientName}
                      onChange={(event) => setClientName(event.target.value)}
                      placeholder="e.g. Jaswinder Singh"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="booking-email"
                      className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      Email
                    </Label>
                    <Input
                      id="booking-email"
                      name="email"
                      autoComplete="email"
                      type="email"
                      value={clientEmail}
                      onChange={(event) => setClientEmail(event.target.value)}
                      placeholder="e.g. name@email.com"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ═══ NOTES ═══ */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[17px] font-semibold">
                  {TeammateName ? "Agenda" : "Project Notes"}
                </CardTitle>
                <CardDescription className="text-[13px] font-normal">
                  {NOTES_HELPER}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="booking-notes"
                    className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Notes
                  </Label>
                  {/* The AI rewrite calls /api/ai, which needs a signed-in
                      session. A TeammateName means a staff member opened this
                      from the app; a client on the public link would only ever
                      see the button fail. */}
                  <Textarea
                    id="booking-notes"
                    name="notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Example sample notes: I am looking at a 550 square meter block. I want a 2 bedroom, 2 toilet main build..."
                    rows={5}
                    aiRewrite={Boolean(TeammateName)}
                    className={TeammateName ? undefined : "min-h-30 resize-y"}
                    textareaClassName={
                      TeammateName ? "min-h-30 resize-y" : undefined
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* ═══ MEETING TYPE ═══ */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[17px] font-semibold">
                  Meeting Type
                </CardTitle>
                <CardDescription className="text-[13px] font-normal">
                  Meetings are held online over Microsoft Teams unless you
                  choose to meet in person.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id="booking-in-person"
                    checked={inPerson}
                    onCheckedChange={(checked) => setInPerson(checked === true)}
                  />
                  <Label
                    htmlFor="booking-in-person"
                    className="cursor-pointer text-sm font-medium text-foreground"
                  >
                    In person
                  </Label>
                </div>
                {inPerson && (
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="booking-venue"
                      className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      Venue
                    </Label>
                    <Input
                      id="booking-venue"
                      name="venue"
                      autoComplete="street-address"
                      type="text"
                      value={venue}
                      maxLength={MAX_CONSULTATION_VENUE_LENGTH}
                      onChange={(event) => setVenue(event.target.value)}
                      placeholder={DEFAULT_CONSULTATION_VENUE}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ═══ DATE & TIME SELECTION (SIDE BY SIDE) ═══ */}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-[17px] font-semibold">
                    Select Date &amp; Time
                  </CardTitle>
                </div>
                <CardDescription className="text-[13px] font-normal">
                  Choose a date from tomorrow onwards, then pick an available
                  time slot.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Chosen before the day and the time, because it decides
                    both: a longer meeting has fewer starts that finish by
                    closing, and a day with one free hour has nothing for a
                    two-hour one. */}
                <div
                  role="radiogroup"
                  aria-label="Meeting length"
                  className="space-y-2"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Meeting Length
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {CONSULTATION_DURATIONS_MINUTES.map((minutes) => {
                      const isSelected = durationMinutes === minutes;
                      return (
                        <button
                          key={minutes}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => chooseDuration(minutes)}
                          className={cn(
                            "rounded-md border px-3.5 py-2 text-sm font-medium transition-colors",
                            isSelected
                              ? "border-royal-gold-ink bg-royal-gold-light text-royal-gold-ink-text"
                              : "border-border bg-card text-foreground hover:bg-muted",
                          )}
                        >
                          {consultationDurationLabel(minutes)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                  {/* Left Column: Date Picker */}
                  <div className="flex justify-center md:border-r md:border-border md:pr-8">
                    <Calendar
                      mode="single"
                      selected={selectedDate ?? undefined}
                      onSelect={(date) => {
                        setSelectedDate(date ?? null);
                        setSelectedTime(null);
                      }}
                      disabled={isDateDisabled}
                      className="rounded-md border border-border p-3"
                      captionLayout="dropdown"
                    />
                  </div>

                  {/* Right Column: Time Slots */}
                  <div>
                    {selectedDate ? (
                      <>
                        <div className="mb-2 flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium text-muted-foreground">
                            {formatDateLong(selectedDate)}
                          </span>
                        </div>
                        <div className="mb-4 rounded-md border border-border bg-muted px-2.5 py-1.5">
                          <p className="text-[11px] font-medium text-foreground">
                            {selectedDate.getDay() === 0
                            || selectedDate.getDay() === 6
                              ? "Weekend Hours"
                              : "Weekday Hours"}
                            :{" "}
                            {formatHour(
                              consultationHours(selectedDate.getDay()).open,
                            )}{" "}
                            -{" "}
                            {formatHour(
                              consultationHours(selectedDate.getDay()).close,
                            )}{" "}
                            ({selectedZoneLabel})
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          {timeSlots.map((time) => {
                            const busy = isSlotBusy(selectedDate, time);
                            const isSelected = selectedTime === time;
                            return (
                              <button
                                key={time}
                                disabled={busy}
                                onClick={() => setSelectedTime(time)}
                                className={cn(
                                  "flex flex-col items-center justify-center rounded-md border px-2 py-3 transition-colors",
                                  busy
                                    ? "cursor-not-allowed border-border bg-muted"
                                    : isSelected
                                      ? "border-royal-gold-ink bg-royal-gold-light cursor-pointer"
                                      : "border-border bg-card cursor-pointer hover:bg-muted",
                                )}
                              >
                                <span
                                  className={cn(
                                    "text-sm font-medium",
                                    busy
                                      ? "text-muted-foreground"
                                      : isSelected
                                        ? "text-royal-gold-ink-text"
                                        : "text-foreground",
                                  )}
                                >
                                  {formatTimeDisplay(time)}
                                </span>
                                {busy && (
                                  <span className="mt-1 text-[9px] font-semibold uppercase text-muted-foreground">
                                    Booked
                                  </span>
                                )}
                                {isSelected && !busy && (
                                  <span className="mt-1 text-[9px] font-semibold uppercase text-royal-gold-ink-text">
                                    Selected
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center text-muted-foreground">
                        <CalendarIcon className="mb-4 h-10 w-10 opacity-40" />
                        <p className="text-[13px]">
                          Please select a date first to view available times.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ═══ SUMMARY & CONFIRM ═══ */}
            {selectedDate && selectedTime && (
              <Card className="border-border shadow-sm">
                <CardContent className="pt-6">
                  <div className="mb-5 flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                      {inPerson ? (
                        <MapPin className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Video className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h4 className="text-[17px] font-semibold text-foreground">
                        Consultation Summary
                      </h4>
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                        {/* "2-hour", as the old "1-hour" read. */}
                        {consultationDurationLabel(durationMinutes).replace(
                          / hours?$/,
                          "-hour",
                        )}{" "}
                        {inPerson
                          ? "in-person meeting"
                          : "Microsoft Teams meeting"}
                      </p>
                    </div>
                  </div>

                  <div className="mb-5 grid grid-cols-2 gap-3">
                    <div className="rounded-md border border-border bg-muted px-4 py-3.5">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Date
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        {formatDateLong(selectedDate)}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted px-4 py-3.5">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Time
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        {formatTimeRange(selectedTime, durationMinutes)} (
                        {selectedZoneLabel})
                      </div>
                    </div>
                    {inPerson && (
                      <div className="col-span-2 rounded-md border border-border bg-muted px-4 py-3.5">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Venue
                        </div>
                        <div className="text-sm font-medium break-words text-foreground">
                          {venue.trim() || "Enter a venue above"}
                        </div>
                      </div>
                    )}
                  </div>

                  {error && (
                    <Alert
                      variant="destructive"
                      className="mb-4 justify-center text-center"
                    >
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    onClick={handleBook}
                    disabled={submitting}
                    className="w-full gap-2 bg-royal-gold-ink py-6 text-[15px] font-semibold text-card hover:bg-royal-gold-ink-hover"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4.5 w-4.5 animate-spin" />
                        <span>Booking Consultation...</span>
                      </>
                    ) : (
                      <>
                        <span>Confirm Meeting</span>
                        <ArrowRight className="h-4.5 w-4.5" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="border-t border-border bg-card px-6 py-5 text-center">
        <p className="text-xs font-normal text-muted-foreground">
          © {new Date().getFullYear()} Royal Constructions NSW · Unit 3, 36
          Turner Road Smeaton Grange NSW 2567
        </p>
      </div>
    </div>
  );
}

export default function BookConsultationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background font-sans text-muted-foreground">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              Loading booking page...
            </p>
          </div>
        </div>
      }
    >
      <BookingContent />
    </Suspense>
  );
}
