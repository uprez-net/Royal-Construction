import { NextRequest, NextResponse } from "next/server";
import { ClientSecretCredential } from "@azure/identity";
import { fromZonedTime } from "date-fns-tz";
import { getGraphConfig } from "@/lib/graph/config";
import { createLead, findLeadByEmail, updateLead } from "@/lib/data/leads";
import { createLeadTask } from "@/lib/data/lead-tasks";
import { sydneyDateOnly, sydneyTimeOnly } from "@/lib/dates/sydney";
import type { HistoryItem } from "@/lib/leads/types";
import BookConsultantScheduleMeeting from "@/lib/graph/Email/book-consultant-ScheduleMeeting";
import { render } from "@react-email/components";

const NOTE_ACTION = "NOTE";
const NOTE_SOURCE_DETAIL = "Book consultation form";

const BOOKING_TIMEZONE = "Australia/Sydney";
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
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUpn)}/calendar/calendarView` +
    `?startDateTime=${encodeURIComponent(windowStart.toISOString())}` +
    `&endDateTime=${encodeURIComponent(windowEnd.toISOString())}` +
    `&$select=subject,start,end,isCancelled,showAs&$top=1000`;

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

async function upsertBookingNotes({
  id,
  name,
  email,
  notes,
  noteDetail,
  /** When the consultation actually is. */
  meetingAt,
}: {
  id: number;
  name: string;
  email: string;
  notes: string;
  noteDetail: string;
  meetingAt: Date;
}) {
  const now = new Date();
  const noteEntry: HistoryItem = {
    date: toDateOnly(now),
    time: toTimeOnly(now),
    action: NOTE_ACTION,
    detail: noteDetail,
    type: "system",
  };

  const existingLead = await findLeadByEmail(id);
  if (existingLead) {
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
      meetingMode: "Online",
      // Only the new entry. Handing back the merged list re-inserted every row
      // the lead already had, once per booking.
      history: [noteEntry],
    });
    // The Graph event already exists by this point, so a failed task must not
    // fail the booking: the customer has the invitation either way. Log loudly
    // and let the lead keep the meetingDate that was just written.
    try {
      await createLeadTask({
        leadId: existingLead.id,
        type: "MEETING",
        dueDate: meetingAt,
        dueTime: toTimeOnly(meetingAt),
        notes: "Consultation booked from the website",
      });
    } catch (taskError) {
      console.error(
        "Booking saved but the meeting task was not created",
        taskError,
      );
    }
    return;
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
      meetingMode: "Online",
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

  // The Follow-ups tab reads tasks, so a booking that only set meetingDate on
  // the lead would be invisible there. createLead returns a conflict object
  // rather than a lead when the email already exists, hence the id check.
  if (created && typeof created === "object" && "id" in created) {
    try {
      await createLeadTask({
        leadId: Number(created.id),
        type: "MEETING",
        dueDate: meetingAt,
        dueTime: toTimeOnly(meetingAt),
        notes: "Consultation booked from the website",
      });
    } catch (taskError) {
      console.error("Lead created but the meeting task was not", taskError);
    }
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const { id, name = "Client", email, startDateTime, notes } = body;

    if (!name || !email || !startDateTime) {
      return NextResponse.json(
        { error: "Missing name, email, or startDateTime" },
        { status: 400 },
      );
    }

    const config = getGraphConfig();
    if (config.mode !== "app-only" || !config.senderUpn) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

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

    // Helper: Format Date object to Graph API accepted Local String "YYYY-MM-DDTHH:mm:ss"
    const pad = (n: number) => n.toString().padStart(2, "0");
    const formatToGraphDateTime = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

    const graphStartStr = formatToGraphDateTime(start);
    const graphEndStr = formatToGraphDateTime(endDateTimeObj);

    // The event below is created as a wall-clock time in Australia/Sydney, so
    // the conflict check has to compare the same instant — not the server-local
    // reading of the incoming string.
    const slotStart = fromZonedTime(graphStartStr, BOOKING_TIMEZONE);
    const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MS);

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
    const displayTime = `${formatDisplayTime(start)} - ${formatDisplayTime(endDateTimeObj)} (AEST)`;

    const emailHtml = await render(
      BookConsultantScheduleMeeting({
        name,
        formattedDate: displayDate,
        formattedTime: displayTime,
      }),
    );

    const attendees = [
      { emailAddress: { address: email, name }, type: "required" }, // Main Lead
    ];

    // Add CC from .env if it exists (Graph API uses 'optional' type for CC)
    const ccEmail = process.env.MAIL_ID_CC;
    if (ccEmail) {
      attendees.push({
        emailAddress: { address: ccEmail, name: "Admin" },
        type: "optional", // This acts as the CC in Outlook Calendar
      });
    }

    const event = {
      subject: `Consultation with ${name} - Royal Constructions`,
      body: {
        contentType: "HTML",
        content: emailHtml,
      },
      start: { dateTime: graphStartStr, timeZone: "Australia/Sydney" },
      end: { dateTime: graphEndStr, timeZone: "Australia/Sydney" },
      location: { displayName: "Microsoft Teams Meeting" },
      attendees: attendees,
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    };

    // ═══════════════════════════════════════════════════════
    // ADDED 'Prefer' HEADER TO FORCE GRAPH TO RETURN JOIN URL
    // ═══════════════════════════════════════════════════════
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUpn)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Prefer: 'outlook.timezone="Australia/Sydney"', // <--- THIS IS THE KEY
        },
        body: JSON.stringify(event),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("Graph event create failed:", detail);
      return NextResponse.json(
        { error: "Failed to create event" },
        { status: 500 },
      );
    }

    const eventData = await response.json();
    //console.log('---------Event created:', eventData);
    // ═══════════════════════════════════════════════════════
    // EXTRACT THE TEAMS MEETING LINK
    // ═══════════════════════════════════════════════════════
    const joinUrl = eventData?.onlineMeeting?.joinUrl || null;
    //console.log('Graph event created successfully. Join URL:', joinUrl);

    const trimmedNotes = typeof notes === "string" ? notes.trim() : "";
    const appointmentLabel = `${displayDate} at ${displayTime}`;
    const noteDetail =
      trimmedNotes.length > 0
        ? `${trimmedNotes}\n\nAppointment: ${appointmentLabel}`
        : `Appointment: ${appointmentLabel}`;

    try {
      await upsertBookingNotes({
        id: Number(id),
        name,
        email,
        notes: trimmedNotes,
        noteDetail,
        // slotStart, not `start`. `start` is the Sydney wall clock carried as
        // UTC, which is exactly what the Graph payload needs and exactly wrong
        // for a stored instant: a 3:00 PM booking was saved as 15:00Z and read
        // back as 1:00 AM the next day, so the client's invitation and the
        // builder's own task list disagreed by ten hours. slotStart is the same
        // moment the conflict check already uses.
        meetingAt: slotStart,
      });
    } catch (leadError) {
      console.error("Failed to save booking notes to lead", leadError);
      return NextResponse.json(
        { error: "Failed to save booking notes" },
        { status: 500 },
      );
    }

    // Return the joinUrl to your frontend
    return NextResponse.json({ success: true, joinUrl });
  } catch (error) {
    console.error("Book consultant failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
