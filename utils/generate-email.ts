import { LOGO_EMAIL, RC_COLORS, RC_URLS } from "@/lib/graph/Email/email-theme";
import { subjectWithTradieRef } from "@/lib/domain/tradies/reply-reference";
import type { RescheduleNotice } from "@/lib/domain/tradies/reschedule-rules";
import { TradieScheduleListItem } from "@/types/project";

// Every email a tradie gets about a booking, on one layout.
//
// They used to be one branded template (the outreach) and then whatever each
// sender wrote: the reminder modal sent a plain-text body through a mailbox
// that sends everything as HTML, so its line breaks collapsed and the tradie
// read one run-on paragraph. Each message below differs only in its words and
// rows; the frame, the details table, the site manager panel and the footer
// are `renderTradieEmail`'s.
//
// Each one also carries the reference its reply is matched on
// (lib/domain/tradies/reply-reference.ts): on the end of the subject, and in
// a note asking the tradie to answer on the same thread.

/** Escape a value for interpolation into the email HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Tuesday, 20 October 2026". */
function longDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function durationLabel(days: number): string {
  return `${days} day${days > 1 ? "s" : ""}`;
}

const paragraph = (html: string, last = false) =>
  `<p style="margin:${last ? "0" : "0 0 16px"};color:${RC_COLORS.text};font-size:16px;line-height:26px;">${html}</p>`;

type DetailRow = {
  readonly label: string;
  /** Already-escaped HTML. */
  readonly value: string;
};

type SiteManager = TradieScheduleListItem["siteManager"];

/**
 * Most tradies answer by hitting Reply, which keeps the reference in the
 * subject without them noticing it. The note is for the ones who start a fresh
 * email, or forward the job to their office.
 */
function referenceNote(reference: string): string {
  return `
            <div
            style="
            margin:0 0 24px;
            padding:16px 20px;
            background:${RC_COLORS.card};
            border:1px dashed ${RC_COLORS.gold};
            border-radius:8px;">

            <p style="margin:0 0 6px;color:${RC_COLORS.text};font-size:15px;line-height:24px;">
            Our reference: <strong style="font-family:Consolas,Menlo,monospace;letter-spacing:0.5px;">${escapeHtml(reference)}</strong>
            </p>

            <p style="margin:0;color:${RC_COLORS.muted};font-size:14px;line-height:22px;">
            Please reply directly to this email and keep this reference in the
            subject line, so your response is matched to this job straight away.
            If you write to us separately, include the reference in your message.
            </p>

            </div>`;
}

/**
 * A site manager worth printing. The project screens fill the gaps with
 * "Unassigned" and empty strings, and a panel headed "Site Manager" reading
 * "Unassigned" tells the tradie nothing they can act on.
 */
function hasSiteManagerContact(siteManager: SiteManager): boolean {
  return Boolean(
    siteManager.name.trim()
    && siteManager.name !== "Unassigned"
    && (siteManager.email.trim() || siteManager.phone.trim()),
  );
}

function renderTradieEmail(input: {
  readonly subject: string;
  readonly heading: string;
  /** Already-escaped HTML paragraphs. */
  readonly intro: string;
  readonly rows: readonly DetailRow[];
  /** Already-escaped HTML. */
  readonly action: string;
  readonly siteManager: SiteManager;
  /** Already-escaped HTML. */
  readonly closing: string;
  /** Already-escaped HTML, between the details table and the action. */
  readonly sections?: string;
  /** What the tradie's reply is matched on; shown under the action. */
  readonly reference?: string | null;
}): string {
  const rows = input.rows
    .map(
      (row, index) => `
            <tr>
            <td style="padding:14px 20px;color:${RC_COLORS.muted};${index === 0 ? "width:220px;" : ""}border-top:1px solid ${RC_COLORS.border};">
            ${row.label}
            </td>
            <td style="padding:14px 20px;color:${RC_COLORS.text};border-top:1px solid ${RC_COLORS.border};">
            ${row.value}
            </td>
            </tr>`,
    )
    .join("\n");

  const siteManager = hasSiteManagerContact(input.siteManager)
    ? `
            <div
            style="
            margin:36px 0;
            padding:22px;
            background:${RC_COLORS.card};
            border-left:4px solid ${RC_COLORS.gold};">

            <p style="margin:0 0 12px;color:${RC_COLORS.text};font-weight:bold;">
            Site Manager
            </p>

            <p style="margin:0;color:${RC_COLORS.text};line-height:26px;">
            <strong>${escapeHtml(input.siteManager.name)}</strong><br>
            ${escapeHtml(input.siteManager.email)}<br>
            ${escapeHtml(input.siteManager.phone)}
            </p>

            </div>`
    : "";

  return `
            <!DOCTYPE html>
            <html>
            <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(input.subject)}</title>
            </head>

            <body style="margin:0;padding:0;background:${RC_COLORS.dark};font-family:Arial,sans-serif;">

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${RC_COLORS.dark};padding:40px 20px;">
            <tr>
            <td align="center">

            <table width="700" cellpadding="0" cellspacing="0" border="0"
            style="width:700px;max-width:700px;background:${RC_COLORS.container};border:1px solid ${RC_COLORS.border};border-radius:12px;overflow:hidden;">

            <tr>
            <td align="center" style="padding:40px 30px 24px;background:${RC_COLORS.dark};">

            <img
            src="${RC_URLS.logo}"
            width="${LOGO_EMAIL.width}"
            height="${LOGO_EMAIL.height}"
            alt="Royal Constructions"
            style="display:block;border:0;">

            </td>
            </tr>

            <tr>
            <td style="padding:0 40px 40px;">

            <h1 style="
            margin:0 0 24px;
            color:${RC_COLORS.text};
            font-size:30px;
            font-weight:bold;
            line-height:38px;">
            ${input.heading}
            </h1>

            ${input.intro}

            <table width="100%" cellpadding="0" cellspacing="0"
            style="
            margin:32px 0;
            border-collapse:collapse;
            background:${RC_COLORS.card};
            border:1px solid ${RC_COLORS.border};
            border-radius:8px;">

            <tr>
            <td colspan="2"
            style="
            padding:16px 20px;
            background:${RC_COLORS.gold};
            color:${RC_COLORS.dark};
            font-weight:bold;
            font-size:18px;">
            Project Details
            </td>
            </tr>
${rows}

            </table>
${input.sections ?? ""}
            <p style="margin:0 0 24px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
            ${input.action}
            </p>
${input.reference ? referenceNote(input.reference) : ""}
${siteManager}

            <p style="
            margin:40px 0 0;
            font-size:14px;
            line-height:24px;
            color:${RC_COLORS.muted};">

            ${input.closing}

            </p>

            </td>
            </tr>

            <tr>
            <td
            style="
            padding:28px;
            background:${RC_COLORS.footer};
            text-align:center;
            font-size:13px;
            line-height:24px;
            color:${RC_COLORS.muted};">

            <strong style="color:${RC_COLORS.text};">Royal Constructions</strong><br><br>

            Phone: ${RC_URLS.phoneDisplay}<br>

            Email: ${RC_URLS.email}<br><br>

            © ${new Date().getFullYear()} Royal Constructions. All rights reserved.

            </td>
            </tr>

            </table>

            </td>
            </tr>
            </table>

            </body>
            </html>
            `;
}

/** Project, trade and milestone: the rows every booking email opens with. */
function bookingRows(input: TradieScheduleListItem): DetailRow[] {
  return [
    { label: "Project", value: escapeHtml(input.projectName) },
    { label: "Trade", value: escapeHtml(input.tradeType) },
    {
      label: "Milestone",
      value: escapeHtml(input.milestoneName ?? input.taskLabel),
    },
  ];
}

const QUESTIONS_CLOSING = `If you have any questions regarding this work package or require further
            clarification, please contact the assigned site manager before the scheduled
            commencement date.`;

export function generateTradieOutreachEmail(input: TradieScheduleListItem): {
  subject: string;
  html: string;
} {
  const formattedDate = longDate(input.scheduledDate);
  const tradieName = escapeHtml(input.tradieName);

  const subject = subjectWithTradieRef(
    input.requiresQuote
      ? `Request for Quotation – ${input.projectName} | ${input.tradeType}`
      : `Availability Confirmation Required – ${input.projectName}`,
    input.refToken,
  );

  const intro = input.requiresQuote
    ? [
        paragraph(`Dear ${tradieName},`),
        paragraph(`Royal Constructions is inviting you to provide a quotation for an upcoming project.
        Based on your trade expertise, we would like you to review the project information
        and submit your pricing for the requested scope of works, together with confirmation
        that you can attend on the scheduled date.`),
        paragraph(
          `The project documentation, including the council-approved architectural plans,
        specifications and milestone information, will be attached to this email for your review.`,
          true,
        ),
      ].join("\n")
    : [
        paragraph(`Dear ${tradieName},`),
        paragraph(`We have scheduled you for an upcoming stage of works on one of our active
        construction projects. Please review the schedule details below and confirm
        your availability at your earliest convenience.`),
        paragraph(
          `Prompt confirmation helps us coordinate trades efficiently and maintain
        construction timelines across the project.`,
          true,
        ),
      ].join("\n");

  const action = input.requiresQuote
    ? `Please review the attached documentation and submit your quotation based on
      the requested scope of works. Your quotation should include labour,
      materials (where applicable), exclusions and any assumptions relevant
      to your pricing. Please also confirm your availability for the scheduled date.`
    : `Please confirm whether you are available to complete these works on the
      scheduled date. If you are unavailable, notify the site manager as soon
      as possible so alternative arrangements can be made.`;

  return {
    subject,
    html: renderTradieEmail({
      action,
      closing: QUESTIONS_CLOSING,
      heading: input.requiresQuote
        ? "Request for Quotation"
        : "Availability Confirmation",
      intro,
      rows: [
        ...bookingRows(input),
        { label: "Scheduled Date", value: formattedDate },
        { label: "Duration", value: durationLabel(input.durationDays) },
        ...(!input.requiresQuote
          ? [
              {
                label: "Agreed Price",
                value: escapeHtml(input.quotedPrice ?? "-"),
              },
            ]
          : []),
      ],
      reference: input.refToken,
      siteManager: input.siteManager,
      subject,
    }),
  };
}

/** A booking the office has approved: only the tradie's word is left. */
function isApproved(status: TradieScheduleListItem["status"]): boolean {
  return status === "CONFIRMED" || status === "PENDING_FINAL_CONFIRMATION";
}

/**
 * The reminder the office sends by hand from a booking.
 *
 * What it asks for follows the booking: an approved booking asks the tradie
 * to confirm they are still coming, one waiting on a quote asks for the quote,
 * and anything else asks again whether they can take the date. One wording
 * for all three asked an approved tradie whether they were available — a
 * question they had already answered and the office had already accepted.
 */
export function generateTradieReminderEmail(input: TradieScheduleListItem): {
  subject: string;
  html: string;
} {
  const formattedDate = longDate(input.scheduledDate);
  const tradieName = escapeHtml(input.tradieName);
  const project = escapeHtml(input.projectName);

  const kind = isApproved(input.status)
    ? "attendance"
    : input.status === "AWAITING_QUOTE"
      ? "quote"
      : "availability";

  const copy = {
    attendance: {
      subject: `Booking reminder – ${input.projectName} | ${input.tradeType}`,
      heading: "Booking Reminder",
      intro: `This is a reminder of your approved booking with Royal Constructions on
        ${project}. The details are below.`,
      action: `Please reply to this email with <strong>confirmed</strong> to let us know
        you will be attending on ${formattedDate}. If anything has changed, contact the
        site manager as soon as possible so we can make other arrangements.`,
    },
    quote: {
      subject: `Quotation reminder – ${input.projectName} | ${input.tradeType}`,
      heading: "Quotation Reminder",
      intro: `We are following up on our request for a quotation for the works below on
        ${project}. We have not yet received your pricing.`,
      action: `Please reply with your quotation for the requested scope of works,
        including labour, materials (where applicable), exclusions and any assumptions,
        and confirm whether you are available on the scheduled date.`,
    },
    availability: {
      subject: `Availability reminder – ${input.projectName} | ${input.tradeType}`,
      heading: "Availability Reminder",
      intro: `We are following up on our earlier request about the works below on
        ${project}. We have not yet received your confirmation.`,
      action: `Please reply to this email to let us know whether you are available to
        complete these works on the scheduled date. If you are unavailable, notify the
        site manager as soon as possible so alternative arrangements can be made.`,
    },
  }[kind];

  const subject = subjectWithTradieRef(copy.subject, input.refToken);
  return {
    subject,
    html: renderTradieEmail({
      action: copy.action,
      closing: QUESTIONS_CLOSING,
      heading: copy.heading,
      intro: [
        paragraph(`Dear ${tradieName},`),
        paragraph(copy.intro, true),
      ].join("\n"),
      reference: input.refToken,
      rows: [
        ...bookingRows(input),
        { label: "Scheduled Date", value: `<strong>${formattedDate}</strong>` },
        { label: "Duration", value: durationLabel(input.durationDays) },
      ],
      siteManager: input.siteManager,
      subject,
    }),
  };
}

/**
 * The email a rescheduled booking sends its tradie.
 *
 * Which one is `rescheduleOutcome`'s decision, passed in as `notice`, so the
 * wording cannot promise something the booking's new status does not mean:
 *
 * - `reconfirm-attendance`: the booking was approved and stays approved. The
 *   tradie is told so, and asked only to confirm they can attend the new date.
 * - `confirm-availability`: nothing was approved yet. It reads as a follow-up
 *   to the request they already have, with the date updated, asking them to
 *   confirm their availability for it.
 *
 * `input` carries the *new* dates; `previous` the ones the tradie was told.
 */
export function generateTradieRescheduleEmail(
  input: TradieScheduleListItem,
  previous: { readonly scheduledDate: string; readonly durationDays: number },
  notice: RescheduleNotice,
): { subject: string; html: string } {
  const newDate = longDate(input.scheduledDate);
  const oldDate = longDate(previous.scheduledDate);
  const tradieName = escapeHtml(input.tradieName);
  const project = escapeHtml(input.projectName);
  const durationChanged = previous.durationDays !== input.durationDays;

  const reconfirm = notice === "reconfirm-attendance";
  const subject = subjectWithTradieRef(
    reconfirm
      ? `Booking date changed – please confirm – ${input.projectName} | ${input.tradeType}`
      : `Updated date – availability confirmation required – ${input.projectName} | ${input.tradeType}`,
    input.refToken,
  );

  const intro = reconfirm
    ? [
        paragraph(`Dear ${tradieName},`),
        paragraph(`The date of your approved booking on ${project} has changed. The
          booking itself remains approved — we only need you to confirm that you can
          attend on the new date.`),
        paragraph(
          `We apologise for any inconvenience the change may cause.`,
          true,
        ),
      ]
    : [
        paragraph(`Dear ${tradieName},`),
        paragraph(`We are following up on our earlier request about the works below on
          ${project}. The scheduled date has been updated, so please review the new
          details and confirm your availability for the new date.`),
        paragraph(
          input.status === "AWAITING_QUOTE"
            ? `If you have not yet sent your quotation, please include it with your reply.`
            : `Any earlier answer you gave us was for the previous date, so we need your
          confirmation again.`,
          true,
        ),
      ];

  const action = reconfirm
    ? `Please reply to this email with <strong>confirmed</strong> if you can attend on
      ${newDate}. If you cannot, contact the site manager as soon as possible so we can
      make other arrangements.`
    : `Please reply to this email to let us know whether you are available on
      ${newDate}. If you are unavailable, notify the site manager as soon as possible so
      alternative arrangements can be made.`;

  return {
    subject,
    html: renderTradieEmail({
      action,
      closing: QUESTIONS_CLOSING,
      heading: reconfirm ? "Booking Date Changed" : "Updated Booking Date",
      intro: intro.join("\n"),
      reference: input.refToken,
      rows: [
        ...bookingRows(input),
        {
          label: "Previous Date",
          value: `<span style="color:${RC_COLORS.muted};text-decoration:line-through;">${oldDate}</span>`,
        },
        { label: "New Date", value: `<strong>${newDate}</strong>` },
        {
          label: "Duration",
          value: durationChanged
            ? `<strong>${durationLabel(input.durationDays)}</strong> (previously ${durationLabel(previous.durationDays)})`
            : durationLabel(input.durationDays),
        },
      ],
      siteManager: input.siteManager,
      subject,
    }),
  };
}

/**
 * A separate one-week reconfirmation request. The original outreach asks
 * whether the tradie can take the date; this message asks whether an already
 * approved booking is still going ahead.
 */
export function generateTradieFinalConfirmationEmail(
  input: TradieScheduleListItem,
): { subject: string; html: string } {
  const formattedDate = longDate(input.scheduledDate);
  const subject = subjectWithTradieRef(
    `Final confirmation required – ${input.projectName} | ${input.tradeType}`,
    input.refToken,
  );

  return {
    subject,
    html: renderTradieEmail({
      action: `Please confirm that you are still available for the approved booking
        above. Reply to this email with <strong>confirmed</strong> or let us know
        immediately if anything has changed.`,
      closing: `If we do not receive confirmation, the booking will remain flagged for
        follow-up by the site team.`,
      heading: "Final Booking Confirmation",
      intro: paragraph(`Dear ${escapeHtml(input.tradieName)},`, true),
      reference: input.refToken,
      rows: [
        ...bookingRows(input),
        { label: "Scheduled Date", value: `<strong>${formattedDate}</strong>` },
        { label: "Duration", value: durationLabel(input.durationDays) },
      ],
      siteManager: input.siteManager,
      subject,
    }),
  };
}

/** One activity in a tradie request, as the email lists it. */
export type TradieRequestEmailActivity = {
  readonly name: string;
  /** Display label, e.g. "Lock Up". */
  readonly stage: string;
  /** `YYYY-MM-DD`, or an ISO timestamp at UTC midnight. */
  readonly scheduledDate: string;
  readonly durationDays: number;
  /** Plain text; escaped here. */
  readonly workLines: readonly string[];
};

export type TradieRequestEmailInput = {
  readonly subject: string;
  readonly tradieName: string;
  readonly projectName: string;
  readonly trade: string;
  readonly activities: readonly TradieRequestEmailActivity[];
  /** Plain text from the office; escaped here, line breaks kept. */
  readonly note?: string;
  readonly siteManager: SiteManager;
  /**
   * This tradie's reference. The command mints one per tradie when it sends;
   * the wizard's preview passes `TRADIE_REF_PREVIEW`.
   */
  readonly reference?: string | null;
};

/** "Tue 20 Oct 2026". Request dates are calendar days, stored at UTC midnight. */
function shortRequestDate(date: string): string {
  const day = date.length === 10 ? `${date}T00:00:00.000Z` : date;
  return new Date(day).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
  });
}

function activityCountLabel(count: number): string {
  return `${count} ${count === 1 ? "activity" : "activities"}`;
}

/** The subject a new request starts with; the office may change it. */
export function tradieRequestSubject(input: {
  readonly projectName: string;
  readonly trade: string;
  readonly activityCount: number;
}): string {
  return `Request for Quotation – ${input.projectName} | ${input.trade} (${activityCountLabel(input.activityCount)})`;
}

/** The subject a new direct booking starts with; the office may change it. */
export function tradieBookingSubject(input: {
  readonly projectName: string;
  readonly trade: string;
  readonly activityCount: number;
}): string {
  return `Booking – Please Confirm Availability – ${input.projectName} | ${input.trade} (${activityCountLabel(input.activityCount)})`;
}

/**
 * The activity table and office note a request and a booking share. A booking
 * names its dates as planned rather than approximate: the office has chosen
 * them, and the tradie is being asked to hold them.
 */
function requestedWorksSections(
  input: Pick<TradieRequestEmailInput, "activities" | "note">,
  wording: {
    readonly heading: string;
    readonly startLabel: string;
    readonly datesNote: string;
  },
): string {
  const activityRows = input.activities
    .map((activity, index) => {
      const lines = activity.workLines
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const work =
        lines.length > 0
          ? `<ul style="margin:10px 0 0;padding:0 0 0 20px;color:${RC_COLORS.text};font-size:15px;line-height:24px;">
              ${lines.map((line) => `<li style="margin:0 0 4px;">${escapeHtml(line)}</li>`).join("\n")}
              </ul>`
          : "";
      return `
            <tr>
            <td style="padding:16px 20px;border-top:1px solid ${RC_COLORS.border};vertical-align:top;width:28px;color:${RC_COLORS.muted};font-weight:bold;">
            ${index + 1}
            </td>
            <td style="padding:16px 20px 16px 0;border-top:1px solid ${RC_COLORS.border};vertical-align:top;">
            <strong style="color:${RC_COLORS.text};font-size:16px;">${escapeHtml(activity.name)}</strong>
            <div style="margin-top:4px;color:${RC_COLORS.muted};font-size:14px;line-height:22px;">
            ${escapeHtml(activity.stage)} stage · ${wording.startLabel} ${shortRequestDate(activity.scheduledDate)} · ${durationLabel(activity.durationDays)}
            </div>
            ${work}
            </td>
            </tr>`;
    })
    .join("\n");

  const note = input.note?.trim()
    ? `
            <div style="margin:0 0 32px;padding:20px;background:${RC_COLORS.card};border:1px solid ${RC_COLORS.border};border-radius:8px;">
            <p style="margin:0 0 8px;color:${RC_COLORS.text};font-weight:bold;">Notes from Royal Constructions</p>
            <p style="margin:0;color:${RC_COLORS.text};font-size:15px;line-height:24px;">${escapeHtml(input.note.trim()).replace(/\r?\n/g, "<br>")}</p>
            </div>`
    : "";

  return `
            <table width="100%" cellpadding="0" cellspacing="0"
            style="
            margin:0 0 16px;
            border-collapse:collapse;
            background:${RC_COLORS.card};
            border:1px solid ${RC_COLORS.border};
            border-radius:8px;">

            <tr>
            <td colspan="2"
            style="
            padding:16px 20px;
            background:${RC_COLORS.gold};
            color:${RC_COLORS.dark};
            font-weight:bold;
            font-size:18px;">
            ${wording.heading}
            </td>
            </tr>
${activityRows}

            </table>

            <p style="margin:0 0 32px;color:${RC_COLORS.muted};font-size:14px;line-height:22px;">
            ${wording.datesNote}
            </p>
${note}`;
}

/**
 * The request a company receives for one trade across several activities.
 *
 * One email per company, whatever the number of activities, so the tradie
 * prices the package once and itemises it — rather than receiving the same
 * request once per activity, which is what the per-booking outreach did.
 *
 * The preview in the request wizard renders this same function, so what the
 * office reviews is what the tradie reads.
 */
export function generateTradieRequestEmail(input: TradieRequestEmailInput): {
  subject: string;
  html: string;
} {
  const tradieName = escapeHtml(input.tradieName);
  const project = escapeHtml(input.projectName);
  const trade = escapeHtml(input.trade);
  const count = activityCountLabel(input.activities.length);
  const subject = subjectWithTradieRef(input.subject, input.reference);
  const sections = requestedWorksSections(input, {
    datesNote: `Dates are approximate and may move with the build programme. We will
            confirm exact dates with you before work starts.`,
    heading: "Requested Works",
    startLabel: "Approx. start",
  });

  return {
    subject,
    html: renderTradieEmail({
      action: `Please reply with <strong>one quotation covering all ${count}</strong>,
        itemised per activity, including labour, materials (where applicable),
        exclusions and any assumptions behind your pricing. Please also let us know
        whether the approximate dates suit you.`,
      closing: QUESTIONS_CLOSING,
      heading: "Request for Quotation",
      intro: [
        paragraph(`Dear ${tradieName},`),
        paragraph(
          `Royal Constructions is inviting you to quote for ${trade} works on
        ${project}. This request covers ${count}, listed below with the work
        involved in each and when we expect it to start.`,
          true,
        ),
      ].join("\n"),
      rows: [
        { label: "Project", value: project },
        { label: "Trade", value: trade },
        { label: "Activities", value: count },
      ],
      reference: input.reference,
      sections,
      siteManager: input.siteManager,
      subject,
    }),
  };
}

/**
 * A direct booking: the office has chosen this tradie, so the email asks for
 * nothing but confirmation that they can do the work on the dates listed.
 *
 * Deliberately silent on price. Asking for one would read as a quote request,
 * and the tradie would answer with a number instead of a yes; the office
 * records the price on the bookings when it has it.
 *
 * Previewed in the request wizard from this same function.
 */
export function generateTradieBookingEmail(input: TradieRequestEmailInput): {
  subject: string;
  html: string;
} {
  const tradieName = escapeHtml(input.tradieName);
  const project = escapeHtml(input.projectName);
  const trade = escapeHtml(input.trade);
  const count = activityCountLabel(input.activities.length);
  const subject = subjectWithTradieRef(input.subject, input.reference);

  return {
    subject,
    html: renderTradieEmail({
      action: `Please reply to this email to <strong>confirm you are available</strong>
        for all ${count} on the dates above. If any date does not suit, tell us which
        one and when you could start instead, so we can adjust the programme.`,
      closing: QUESTIONS_CLOSING,
      heading: "Booking – Please Confirm Availability",
      intro: [
        paragraph(`Dear ${tradieName},`),
        paragraph(
          `Royal Constructions would like to book you for ${trade} works on
        ${project}. This booking covers ${count}, listed below with the work
        involved in each and the date we have planned for it to start.`,
          true,
        ),
      ].join("\n"),
      reference: input.reference,
      rows: [
        { label: "Project", value: project },
        { label: "Trade", value: trade },
        { label: "Activities", value: count },
      ],
      sections: requestedWorksSections(input, {
        datesNote: `These are the dates we have planned. If the build programme moves,
            we will contact you before work starts.`,
        heading: "Booked Works",
        startLabel: "Planned start",
      }),
      siteManager: input.siteManager,
      subject,
    }),
  };
}
