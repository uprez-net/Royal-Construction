import { NextRequest, NextResponse } from "next/server";
import { ClientSecretCredential } from "@azure/identity";
import { fromZonedTime } from "date-fns-tz";
import { getGraphConfig } from "@/lib/graph/config";
import { createGraphContext } from "@/lib/graph/client";
import { DEFAULT_BUSINESS_EMAIL } from "@/lib/graph/mailbox";
import { generateInPersonConsultationEmail } from "@/lib/graph/Email/in-person-consultation-email";
import { MAX_CONSULTATION_VENUE_LENGTH } from "@/lib/leads/consultation-venue";
import { createLead, findLeadById, updateLead } from "@/lib/data/leads";
import { authorizeLeadAccess } from "@/lib/data/offer-access";
import { verifyBookConsultationToken } from "@/lib/leads/book-consultation-token";
import prisma from "@/lib/prisma";
import { createLeadTask } from "@/lib/domain/leads/tasks";
import {
  bookConsultation,
  consultationBookingKey,
} from "@/lib/domain/leads/booking";
import { anonymousPrincipal } from "@/lib/domain/principal";
import {
  sydneyDateOnly,
  sydneyTimeOnly,
  sydneyTimeZoneAbbreviation,
} from "@/lib/dates/sydney";
import type { HistoryItem } from "@/lib/leads/types";
import BookConsultantScheduleMeeting from "@/lib/graph/Email/book-consultant-ScheduleMeeting";
import { render } from "@react-email/components";

const NOTE_ACTION = "NOTE";
const NOTE_SOURCE_DETAIL = "Book consultation form";

const BOOKING_TIMEZONE = "Australia/Sydney";

// This route is open. Anonymous is the honest value for its caller: a lead id
// arriving here is a claim to be proved, which resolveLeadClaim does, not an
// identity to be trusted.
const ANONYMOUS_BOOKING = anonymousPrincipal("public booking form");

// Graph wants a naive local string, "YYYY-MM-DDTHH:mm:ss", alongside a
// separate timeZone field. Module scope because the idempotency key is built
// from the same reading, before the event payload is assembled.
const pad = (n: number) => n.toString().padStart(2, "0");
const formatToGraphDateTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const SLOT_DURATION_MS = 60 * 60 * 1000;

// calendarView's boundary behaviour is not documented, so the window is padded
// and the overlap decided here. A day of padding catches long and all-day
// events that begin before the slot and run into it.
const CONFLICT_WINDOW_PAD_MS = 24 * 60 * 60 * 1000;

// showAs values that mean the calendar owner is genuinely unavailable. 'free'
// and 'workingElsewhere' deliberately do not block.
const BLOCKING_SHOW_AS = new Set(["busy", "oof", "tentative"]);

interface GraphDateTime {
  dateTime?: string;
  timeZone?: string;
}

interface CalendarViewEvent {
  subject?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  isCancelled?: boolean;
  showAs?: string;
}

interface CalendarViewPage {
  value?: CalendarViewEvent[];
  "@odata.nextLink"?: string;
}

// Graph hands back a naive wall clock plus a separate timeZone field. Passing
// that straight to new Date() reinterprets it as server-local — on a UTC host
// that silently shifts every Sydney event by 10-11 hours.
function parseGraphDateTime(value?: GraphDateTime): Date | null {
  const dateTime = value?.dateTime;
  if (!dateTime) return null;

  const parsed = /(?:Z|[+-]\d{2}:?\d{2})$/.test(dateTime)
    ? new Date(dateTime)
    : fromZonedTime(dateTime, value?.timeZone || "UTC");

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Returns the subject of the first event overlapping the slot, or null if the
// slot is free. Throws if availability cannot be established — the caller must
// treat that as "do not book".
async function findConflictingEvent(
  accessToken: string,
  senderUpn: string,
  slotStart: Date,
  slotEnd: Date,
): Promise<string | null> {
  const windowStart = new Date(slotStart.getTime() - CONFLICT_WINDOW_PAD_MS);
  const windowEnd = new Date(slotEnd.getTime() + CONFLICT_WINDOW_PAD_MS);

  // No Prefer: outlook.timezone here, deliberately. The header never affects how
  // the window parameters are read (they carry their own offset via toISOString),
  // and omitting it makes Graph return start/end in UTC, which parses without
  // ambiguity. $filter is undocumented on calendarView, so cancelled and
  // non-blocking events are filtered below rather than in the query.
  let nextUrl: string | undefined =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUpn)}/calendar/calendarView`
    + `?startDateTime=${encodeURIComponent(windowStart.toISOString())}`
    + `&endDateTime=${encodeURIComponent(windowEnd.toISOString())}`
    + `&$select=subject,start,end,isCancelled,showAs&$top=1000`;

  let pagesFetched = 0;

  while (nextUrl && pagesFetched < 10) {
    const response = await fetch(nextUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(
        `calendarView returned ${response.status}: ${await response.text()}`,
      );
    }

    const page = (await response.json()) as CalendarViewPage;

    for (const event of page.value ?? []) {
      if (event.isCancelled) continue;
      if (event.showAs && !BLOCKING_SHOW_AS.has(event.showAs)) continue;

      const eventStart = parseGraphDateTime(event.start);
      const eventEnd = parseGraphDateTime(event.end);
      if (!eventStart || !eventEnd) continue;

      // Half-open overlap: a 10:00-11:00 event must not block an 11:00 booking.
      if (eventStart < slotEnd && eventEnd > slotStart) {
        return event.subject || "(untitled event)";
      }
    }

    nextUrl = page["@odata.nextLink"];
    pagesFetched += 1;
  }

  if (nextUrl) {
    throw new Error(
      "calendarView paging did not terminate; availability is unverified.",
    );
  }

  return null;
}

// Sydney, not the machine. These carry the actual consultation time, and every
// server process runs UTC.
const toDateOnly = sydneyDateOnly;
const toTimeOnly = sydneyTimeOnly;

/**
 * Who this booking is for, as far as the caller can prove it.
 *
 * Three outcomes, and the middle one is the reason this returns a union rather
 * than `number | null`:
 *
 *   anonymous    — no lead named. A prospect booking off the public page.
 *                  Legitimate, and the booking creates a fresh lead.
 *   lead         — a lead named AND proven, by a signed booking token or by a
 *                  signed-in staff session.
 *   unauthorized — a lead named but NOT proven. Previously indistinguishable
 *                  from `anonymous`, which meant a caller guessing lead ids got
 *                  a calendar event and an email anyway and merely lost the
 *                  database write. The caller has to be refused instead.
 */
type LeadClaim =
  | { kind: "anonymous" }
  | { kind: "lead"; leadId: number }
  | { kind: "unauthorized" };

async function resolveLeadClaim(
  body: Record<string, unknown>,
): Promise<LeadClaim> {
  const rawId = body.id;
  const hasId =
    typeof rawId === "number"
    || (typeof rawId === "string" && rawId.trim().length > 0);
  if (!hasId) {
    return { kind: "anonymous" };
  }

  const leadId = typeof rawId === "number" ? rawId : Number(rawId);
  if (!Number.isSafeInteger(leadId) || leadId <= 0) {
    return { kind: "unauthorized" };
  }

  const token =
    typeof body.bookingToken === "string" ? body.bookingToken.trim() : "";
  if (token && verifyBookConsultationToken(token, leadId)) {
    return { kind: "lead", leadId };
  }

  const access = await authorizeLeadAccess(leadId);
  if (access.ok) {
    return { kind: "lead", leadId };
  }

  return { kind: "unauthorized" };
}

/**
 * The MEETING task the Follow-ups tab reads. Every booking gets one, whichever
 * lead it lands on.
 *
 * The Graph event (and, in person, the confirmation email) already exists by
 * the time this runs, so a failed task must not fail the booking: the client
 * has their confirmation either way. Log loudly and keep the lead write.
 */
async function createMeetingTask(
  leadId: number,
  meetingAt: Date,
  taskNote: string,
): Promise<void> {
  try {
    await createLeadTask(
      {
        leadId,
        type: "MEETING",
        dueDate: meetingAt,
        dueTime: toTimeOnly(meetingAt),
        notes: taskNote,
      },
      prisma,
    );
  } catch (taskError) {
    console.error(
      `Booking saved but the meeting task was not created for lead ${leadId}`,
      taskError,
    );
  }
}

async function upsertBookingNotes({
  existingLeadId,
  name,
  email,
  notes,
  noteDetail,
  meetingMode,
  taskNote,
  /** When the consultation actually is. */
  meetingAt,
}: {
  existingLeadId: number | null;
  name: string;
  email: string;
  notes: string;
  noteDetail: string;
  /** "Online" or "Offline" — the same two values the meeting review modal writes. */
  meetingMode: "Online" | "Offline";
  taskNote: string;
  meetingAt: Date;
}): Promise<number | null> {
  const now = new Date();
  const noteEntry: HistoryItem = {
    date: toDateOnly(now),
    time: toTimeOnly(now),
    action: NOTE_ACTION,
    detail: noteDetail,
    type: "system",
  };

  if (existingLeadId !== null) {
    const existingLead = await findLeadById(existingLeadId);
    if (!existingLead) {
      throw new Error(`Lead ${existingLeadId} was not found.`);
    }
    await updateLead(existingLead.id, {
      // Lead.notes is deliberately left alone. Overwriting it put this booking's
      // agenda where the sales notes belong, and everything that reads that
      // column — the offer pre-fill's "# Sales notes" block above all — then
      // described the booking instead. The agenda's home is the history entry
      // below, which is where the Notes tab puts a note too.
      //
      // Not 'Meeting Scheduled'. That stage was retired: it described a booked
      // task rather than progress, and completing it wrote CONTACTED. The lead
      // is in Discovery, and the booking is a task.
      // No stage at all here in fact: updateLead advances a lead into Discovery
      // when work is scheduled and leaves anything further on alone.
      meetingDate: meetingAt.toISOString(),
      meetingTime: toTimeOnly(meetingAt),
      meetingMode,
      // Only the new entry. Handing back the merged list re-inserted every row
      // the lead already had, once per booking.
      history: [noteEntry],
    });
    await createMeetingTask(existingLead.id, meetingAt, taskNote);
    return existingLead.id;
  }

  const created = await createLead(
    {
      name: name.trim() || "Client",
      phone: "",
      email: email.trim(),
      location: "",
      source: "Website",
      sourceDetail: NOTE_SOURCE_DETAIL,
      stage: "Discovery",
      budget: "Not Discussed",
      type: ["Not Specified"],
      notes,
      meetingDate: meetingAt.toISOString(),
      meetingTime: toTimeOnly(meetingAt),
      meetingMode,
      followupNotes: "",
      urgent: false,
      history: [
        {
          action: NOTE_ACTION,
          detail: noteDetail,
          type: "system",
          actionDate: now.toISOString(),
        },
      ],
    },
    { skipWelcomeEmail: true },
  );

  // createLead answers with a conflict object rather than a lead when the
  // email already belongs to one. That lead still gets the MEETING task: the
  // booking happened, and the task is the only place the office would see it.
  // Nothing else on that lead is touched — the caller proved only that they
  // can type its email address, not that they own the record — and the
  // invitation or confirmation went to that same address regardless.
  const leadId =
    created && typeof created === "object" && "id" in created
      ? Number(created.id)
      : created && typeof created === "object" && "existingLead" in created
        ? Number(created.existingLead.id)
        : null;

  if (leadId === null || !Number.isSafeInteger(leadId)) {
    console.error(
      "Booking made but no lead could be resolved for its meeting task",
    );
    return null;
  }

  // The Follow-ups tab reads tasks, so a booking that only set meetingDate on
  // the lead would be invisible there.
  await createMeetingTask(leadId, meetingAt, taskNote);
  return leadId;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const { name = "Client", email, startDateTime, notes } = body;

    if (!name || !email || !startDateTime) {
      return NextResponse.json(
        { error: "Missing name, email, or startDateTime" },
        { status: 400 },
      );
    }

    // Strictly `true`: anything else, including a missing field from an older
    // copy of the page, is the online booking this route has always made.
    const inPerson = body.inPerson === true;
    const venue = typeof body.venue === "string" ? body.venue.trim() : "";
    if (inPerson && !venue) {
      return NextResponse.json(
        { error: "Please enter where the in-person meeting will be held." },
        { status: 400 },
      );
    }
    if (inPerson && venue.length > MAX_CONSULTATION_VENUE_LENGTH) {
      return NextResponse.json(
        {
          error: `The venue must be ${MAX_CONSULTATION_VENUE_LENGTH} characters or fewer.`,
        },
        { status: 400 },
      );
    }

    // Resolved HERE, before anything with an outside effect.
    //
    // This used to sit 37 lines further down, after the Graph event had already
    // been created and the invitation already sent from the company mailbox. So
    // a request naming a lead it could not prove it owned was refused only the
    // database write — the calendar entry and the email had already gone out,
    // against the builder's real availability and to an address of the sender's
    // choosing. Authorisation that runs after the side effect is not
    // authorisation.
    const leadClaim = await resolveLeadClaim(body as Record<string, unknown>);
    if (leadClaim.kind === "unauthorized") {
      // Deliberately a refusal rather than a silent downgrade to an anonymous
      // booking: the caller named a specific lead, so proceeding would attach
      // this booking to a stranger's record or, failing that, quietly drop it.
      return NextResponse.json(
        { error: "This booking link is no longer valid. Request a new one." },
        { status: 403 },
      );
    }

    const config = getGraphConfig();
    if (config.mode !== "app-only" || !config.senderUpn) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const senderUpn = config.senderUpn;
    const credential = new ClientSecretCredential(
      config.tenantId,
      config.clientId,
      config.clientSecret,
    );
    const tokenResult = await credential.getToken(
      "https://graph.microsoft.com/.default",
    );
    const accessToken = tokenResult?.token;

    if (!accessToken) throw new Error("Unable to acquire Graph access token");

    const start = new Date(startDateTime);

    // Calculate end time locally (adds 1 hour, automatically handles day rollovers like 23:30 -> 00:30)
    const endDateTimeObj = new Date(start.getTime() + 60 * 60 * 1000);

    const graphStartStr = formatToGraphDateTime(start);
    const graphEndStr = formatToGraphDateTime(endDateTimeObj);

    // The event below is created as a wall-clock time in Australia/Sydney, so
    // the conflict check has to compare the same instant — not the server-local
    // reading of the incoming string.
    const slotStart = fromZonedTime(graphStartStr, BOOKING_TIMEZONE);
    const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MS);

    // Idempotency key for this exact slot and client, resolved before the
    // calendar is touched. Two submissions of the same form — a double-click,
    // or a retry after a timeout — used to race past the conflict check below
    // and create two Teams meetings and two invitations.
    // Pre-flight only: the command builds the real key. Doing it here means a
    // malformed time or a missing email is a 400 before the calendar is even
    // queried, rather than a 500 from inside the effect.
    try {
      consultationBookingKey({
        email,
        name,
        startsAt: fromZonedTime(
          formatToGraphDateTime(new Date(startDateTime)),
          BOOKING_TIMEZONE,
        ),
      });
    } catch (keyError) {
      return NextResponse.json(
        {
          error:
            keyError instanceof Error
              ? keyError.message
              : "That appointment could not be read.",
        },
        { status: 400 },
      );
    }

    // The booking UI is not a reliable guard: it can only reflect what it was
    // able to load. This is the check that actually prevents a double booking,
    // so an unverifiable calendar refuses the booking rather than risking one.
    let conflict: string | null;
    try {
      conflict = await findConflictingEvent(
        accessToken,
        config.senderUpn,
        slotStart,
        slotEnd,
      );
    } catch (availabilityError) {
      console.error(
        "Could not verify calendar availability:",
        availabilityError,
      );
      return NextResponse.json(
        {
          error:
            "We could not confirm that time is still free. Please try again.",
        },
        { status: 503 },
      );
    }

    if (conflict) {
      // Deliberately not logging the conflicting event's subject — meeting
      // titles carry client names and other personal detail.
      console.warn(
        `Rejected booking at ${slotStart.toISOString()}; slot already occupied.`,
      );
      return NextResponse.json(
        { error: "That time has just been taken. Please choose another slot." },
        { status: 409 },
      );
    }

    // Helper: Format Date object to requested email display strings
    const formatDisplayDate = (d: Date) =>
      d.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }); // "Saturday 6 June 2026"

    const formatDisplayTime = (d: Date) => {
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const ampm = hours >= 12 ? "pm" : "am";
      const formattedHours = (hours % 12 || 12).toString().padStart(2, "0");
      const formattedMinutes = minutes.toString().padStart(2, "0");
      return `${formattedHours}:${formattedMinutes} ${ampm}`;
    };

    const displayDate = formatDisplayDate(start);
    // Derived from slotStart, the real instant, so the label agrees with the
    // calendar invitation sitting beside it in the same email. Hardcoded
    // "AEST", it disagreed with every booking made on daylight saving.
    const displayTime = `${formatDisplayTime(start)} - ${formatDisplayTime(endDateTimeObj)} (${sydneyTimeZoneAbbreviation(slotStart)})`;

    const trimmedNotes = typeof notes === "string" ? notes.trim() : "";

    // In person, the client gets a templated confirmation email with the venue
    // rather than a Teams invitation. The office calendar still gets the event
    // — it is what the availability check reads — but without the client on
    // it, so they are not sent a second, link-less invitation beside the email.
    const inPersonEmail = inPerson
      ? generateInPersonConsultationEmail({
          name,
          formattedDate: displayDate,
          formattedTime: displayTime,
          venue,
          agenda: trimmedNotes,
          signatureEmail: process.env.BUSINESS_EMAIL || DEFAULT_BUSINESS_EMAIL,
        })
      : null;

    const emailHtml = inPersonEmail
      ? inPersonEmail.html
      : await render(
          BookConsultantScheduleMeeting({
            name,
            formattedDate: displayDate,
            formattedTime: displayTime,
          }),
        );

    const attendees: {
      emailAddress: { address: string; name: string };
      type: "required" | "optional";
    }[] = inPerson
      ? []
      : [{ emailAddress: { address: email, name }, type: "required" }]; // Main Lead

    // Add CC from .env if it exists (Graph API uses 'optional' type for CC)
    const ccEmail = process.env.MAIL_ID_CC;
    if (ccEmail) {
      attendees.push({
        emailAddress: { address: ccEmail, name: "Admin" },
        type: "optional", // This acts as the CC in Outlook Calendar
      });
    }

    const event = {
      subject: inPerson
        ? `In-person consultation with ${name} - Royal Constructions`
        : `Consultation with ${name} - Royal Constructions`,
      body: {
        contentType: "HTML",
        content: emailHtml,
      },
      start: { dateTime: graphStartStr, timeZone: "Australia/Sydney" },
      end: { dateTime: graphEndStr, timeZone: "Australia/Sydney" },
      attendees: attendees,
      ...(inPerson
        ? { location: { displayName: venue }, isOnlineMeeting: false }
        : {
            location: { displayName: "Microsoft Teams Meeting" },
            isOnlineMeeting: true,
            onlineMeetingProvider: "teamsForBusiness",
          }),
    };

    const appointmentLabel = inPerson
      ? `${displayDate} at ${displayTime}, in person at ${venue}`
      : `${displayDate} at ${displayTime}, online (Microsoft Teams)`;
    const baseTaskNote = inPerson
      ? `In-person consultation at ${venue}`
      : "Online consultation (Microsoft Teams) booked from the website";
    const noteDetail =
      trimmedNotes.length > 0
        ? `${trimmedNotes}\n\nAppointment: ${appointmentLabel}`
        : `Appointment: ${appointmentLabel}`;

    // The meeting and the record of it are one effect now. Creating the event
    // and then failing to save the lead used to answer 500 while the client
    // kept an invitation nobody in the office could see.
    let booked: Awaited<ReturnType<typeof bookConsultation>>;
    try {
      booked = await bookConsultation(
        ANONYMOUS_BOOKING,
        { email, name, startsAt: slotStart },
        prisma,
        async () => {
          const response = await fetch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUpn)}/events`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                // Forces Graph to return the join URL.
                Prefer: 'outlook.timezone="Australia/Sydney"',
              },
              body: JSON.stringify(event),
            },
          );
          if (!response.ok) {
            const detail = await response.text();
            console.error("Graph event create failed:", detail);
            throw new Error("Failed to create event");
          }
          const eventData = await response.json();

          // After the event, so a client is never told about a meeting the
          // calendar refused. A failed send does NOT fail the booking: the slot
          // is taken and the lead is about to be written, so throwing would
          // leave the client reading "could not book" about a meeting that
          // exists. It is reported instead — on the meeting task, where the
          // office looks, and in the response, so the page can tell the client.
          let confirmationSent = true;
          if (inPersonEmail) {
            try {
              const mail = await createGraphContext(config);
              await mail.sendMail({
                to: email,
                subject: inPersonEmail.subject,
                body: inPersonEmail.html,
                // Comma-separated, per lib/graph/mailbox.ts.
                cc: (ccEmail ?? "")
                  .split(",")
                  .map((address) => address.trim())
                  .filter(Boolean),
              });
            } catch (mailError) {
              confirmationSent = false;
              console.error(
                "In-person booking made but the confirmation email failed",
                mailError,
              );
            }
          }

          const leadId = await upsertBookingNotes({
            existingLeadId: leadClaim.kind === "lead" ? leadClaim.leadId : null,
            name,
            email,
            notes: trimmedNotes,
            noteDetail,
            meetingMode: inPerson ? "Offline" : "Online",
            taskNote: confirmationSent
              ? baseTaskNote
              : `${baseTaskNote}. The confirmation email to the client FAILED to send — contact them with the venue and time.`,
            // slotStart, not `start`. `start` is the Sydney wall clock carried
            // as UTC, which is what the Graph payload needs and exactly wrong
            // for a stored instant: a 3:00 PM booking was saved as 15:00Z and
            // read back as 1:00 AM the next day, so the client's invitation and
            // the builder's own task list disagreed by ten hours. slotStart is
            // the same moment the conflict check already uses.
            meetingAt: slotStart,
          });
          return {
            confirmationSent,
            joinUrl: eventData?.onlineMeeting?.joinUrl || null,
            leadId,
          };
        },
      );
    } catch (bookingError) {
      console.error("Booking failed", bookingError);
      return NextResponse.json(
        {
          error:
            "We could not complete that booking. Please try again, or call us.",
        },
        { status: 500 },
      );
    }

    // A replay answers with the first attempt's meeting rather than making a
    // second one, and says so, so the page does not claim a fresh booking.
    return NextResponse.json({
      success: true,
      joinUrl: booked.joinUrl,
      alreadyBooked: booked.alreadyBooked,
      confirmationSent: booked.confirmationSent,
    });
  } catch (error) {
    console.error("Book consultant failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
