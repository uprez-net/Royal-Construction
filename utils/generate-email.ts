import {
  FONTS,
  LOGO_EMAIL,
  RC_COLORS,
  RC_URLS,
} from "@/lib/graph/Email/email-theme";
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

/** Template text written across several source lines, as one line. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The text of one region of an email: plain text with `**bold**`, line
 * breaks, and `{tradie}` / `{reference}` for what differs per recipient. It is
 * the form the request wizard's preview edits a region in, so an edit made for
 * one tradie reads right for every tradie it goes to.
 */
type CopyTokens = { readonly tradie?: string; readonly reference?: string };

function copyHtml(
  text: string,
  tokens: CopyTokens,
  editable: boolean,
  strongStyle?: string,
): string {
  const token = (name: keyof CopyTokens, html: string) =>
    editable
      ? `<span data-token="${name}" contenteditable="false">${html}</span>`
      : html;
  return escapeHtml(text)
    .replace(
      /\*\*([\s\S]+?)\*\*/g,
      strongStyle
        ? `<strong style="${strongStyle}">$1</strong>`
        : "<strong>$1</strong>",
    )
    .replace(/\{(tradie|reference)\}/g, (match, name: keyof CopyTokens) => {
      const value = tokens[name];
      if (value === undefined) return match;
      return token(
        name,
        name === "reference"
          ? `<strong style="font-family:${FONTS.mono};letter-spacing:0.5px;">${escapeHtml(value)}</strong>`
          : escapeHtml(value),
      );
    })
    .replace(/\r?\n/g, "<br>");
}

/**
 * Writes an email's text regions, with the office's edits in place of the
 * template's words. `defaults` collects what the template wrote for each
 * region, so the preview can tell an edit from the text it replaced.
 */
function copyWriter(options: {
  readonly tokens: CopyTokens;
  readonly copy?: Readonly<Record<string, string>>;
  readonly editable?: boolean;
}) {
  const defaults: Record<string, string> = {};
  /** `strongStyle` styles the region's `**bold**`, edited or not. */
  const write = (key: string, text: string, strongStyle?: string): string => {
    defaults[key] = text;
    const html = copyHtml(
      options.copy?.[key] ?? text,
      options.tokens,
      Boolean(options.editable),
      strongStyle,
    );
    return options.editable
      ? `<span data-copy="${escapeHtml(key)}" contenteditable="true">${html}</span>`
      : html;
  };
  return { defaults, write };
}

type CopyWrite = ReturnType<typeof copyWriter>["write"];

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
function referenceNote(copy: CopyWrite): string {
  return `
            <div
            style="
            margin:0 0 24px;
            padding:16px 20px;
            background:${RC_COLORS.card};
            border:1px solid ${RC_COLORS.border};
            border-radius:8px;">

            <p style="margin:0 0 6px;color:${RC_COLORS.text};font-size:15px;line-height:24px;">
            ${copy("reference", "Our reference: {reference}")}
            </p>

            <p style="margin:0;color:${RC_COLORS.muted};font-size:14px;line-height:22px;">
            ${copy(
              "reference:note",
              oneLine(`Please reply directly to this email and keep this reference in the
            subject line, so your response is matched to this job straight away.
            If you write to us separately, include the reference in your message.`),
            )}
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
  /** Writes the frame's own words; the template's, unless given. */
  readonly copy?: CopyWrite;
}): string {
  const copy =
    input.copy
    ?? copyWriter({ tokens: { reference: input.reference ?? undefined } })
      .write;
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
            border-left:4px solid ${RC_COLORS.border};">

            <p style="margin:0 0 12px;color:${RC_COLORS.text};font-weight:bold;">
            ${copy("siteManager:heading", "Site Manager")}
            </p>

            <p style="margin:0;color:${RC_COLORS.text};line-height:26px;">
            ${copy(
              "siteManager",
              `**${input.siteManager.name}**\n${input.siteManager.email}\n${input.siteManager.phone}`,
            )}
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

            <body style="margin:0;padding:0;background:${RC_COLORS.dark};font-family:${FONTS.body};">

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
            font-family:${FONTS.heading};
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
            background:${RC_COLORS.dark};
            color:${RC_COLORS.text};
            border-bottom:2px solid ${RC_COLORS.brandGold};
            font-weight:bold;
            font-size:18px;">
            ${copy("details:heading", "Project Details")}
            </td>
            </tr>
${rows}

            </table>
${input.sections ?? ""}
            <p style="margin:0 0 24px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
            ${input.action}
            </p>
${input.reference ? referenceNote(copy) : ""}
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

            ${copy(
              "footer",
              `**Royal Constructions**\n\nPhone: ${RC_URLS.phoneDisplay}\nEmail: ${RC_URLS.email}\n\n© ${new Date().getFullYear()} Royal Constructions. All rights reserved.`,
            )}

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
  /** Keys the activity's edited text, so an edit follows its activity. */
  readonly milestoneId?: string;
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
  /**
   * The office's rewording of the email, by region, as edited in the wizard's
   * preview. Every region but the note may be reworded; the note is the
   * office's own text already.
   */
  readonly copy?: Readonly<Record<string, string>>;
  /** Marks every editable region, for the wizard's preview. Never sent. */
  readonly editable?: boolean;
};

/** What a request email renders to, and the template's text for each region. */
export type TradieRequestEmail = {
  subject: string;
  html: string;
  /** What the template wrote for each region, before the office's edits. */
  copy: Readonly<Record<string, string>>;
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
 *
 * A work line is edited in place in the preview as well as in the wizard's
 * list, so it is marked with its index in that list rather than written as
 * copy: both edit the same line.
 */
function requestedWorksSections(
  input: Pick<TradieRequestEmailInput, "activities" | "note" | "editable">,
  copy: CopyWrite,
  wording: {
    readonly heading: string;
    readonly startLabel: string;
    readonly datesNote: string;
  },
): string {
  // The start date and duration are what the tradie checks first.
  const dateStyle = `display:inline-block;padding:2px 8px;background:${RC_COLORS.dark};border:1px solid ${RC_COLORS.border};border-radius:4px;color:${RC_COLORS.ctaText};font-size:15px;`;
  const activityRows = input.activities
    .map((activity, index) => {
      const key = `activity:${activity.milestoneId ?? index}`;
      const lines = activity.workLines
        .map((line, lineIndex) => ({ line: line.trim(), lineIndex }))
        .filter(({ line }) => line.length > 0);
      const work =
        lines.length > 0
          ? `<ul style="margin:10px 0 0;padding:0 0 0 20px;color:${RC_COLORS.text};font-size:15px;line-height:24px;">
              ${lines
                .map(({ line, lineIndex }) =>
                  input.editable && activity.milestoneId
                    ? `<li style="margin:0 0 4px;"><span data-copy="work:${escapeHtml(activity.milestoneId)}:${lineIndex}" contenteditable="true">${escapeHtml(line)}</span></li>`
                    : `<li style="margin:0 0 4px;">${escapeHtml(line)}</li>`,
                )
                .join("\n")}
              </ul>`
          : "";
      return `
            <tr>
            <td style="padding:16px 20px;border-top:1px solid ${RC_COLORS.border};vertical-align:top;width:28px;color:${RC_COLORS.muted};font-weight:bold;">
            ${index + 1}
            </td>
            <td style="padding:16px 20px 16px 0;border-top:1px solid ${RC_COLORS.border};vertical-align:top;">
            <strong style="color:${RC_COLORS.text};font-size:16px;">${copy(`${key}:name`, activity.name)}</strong>
            <div style="margin-top:6px;color:${RC_COLORS.muted};font-size:14px;line-height:28px;">
            ${copy(`${key}:dates`, `${activity.stage} stage · ${wording.startLabel} **${shortRequestDate(activity.scheduledDate)}** · **${durationLabel(activity.durationDays)}**`, dateStyle)}
            </div>
            ${work}
            </td>
            </tr>`;
    })
    .join("\n");

  // The note stays the office's own words, edited in the wizard's Note field.
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
            background:${RC_COLORS.dark};
            color:${RC_COLORS.text};
            border-bottom:2px solid ${RC_COLORS.brandGold};
            font-weight:bold;
            font-size:18px;">
            ${copy("works:heading", wording.heading)}
            </td>
            </tr>
${activityRows}

            </table>

            <p style="margin:0 0 32px;color:${RC_COLORS.muted};font-size:14px;line-height:22px;">
            ${copy("works:dates", wording.datesNote)}
            </p>
${note}`;
}

/**
 * The words that differ between a request and a booking. Everything else in
 * the two emails is the same.
 */
type RequestEmailWording = {
  readonly heading: string;
  readonly intro: string;
  readonly action: string;
  readonly works: {
    readonly heading: string;
    readonly startLabel: string;
    readonly datesNote: string;
  };
};

function renderTradieRequest(
  input: TradieRequestEmailInput,
  wording: (facts: { count: string }) => RequestEmailWording,
): TradieRequestEmail {
  const count = activityCountLabel(input.activities.length);
  const subject = subjectWithTradieRef(input.subject, input.reference);
  const words = wording({ count });
  const writer = copyWriter({
    copy: input.copy,
    editable: input.editable,
    tokens: {
      reference: input.reference ?? undefined,
      tradie: input.tradieName,
    },
  });
  const copy = writer.write;

  const html = renderTradieEmail({
    action: copy("action", words.action),
    closing: copy("closing", oneLine(QUESTIONS_CLOSING)),
    copy,
    heading: copy("heading", words.heading),
    intro: [
      paragraph(copy("greeting", "Dear {tradie},")),
      paragraph(copy("intro", words.intro), true),
    ].join("\n"),
    reference: input.reference,
    rows: [
      {
        label: copy("row:project:label", "Project"),
        value: copy("row:project", input.projectName),
      },
      {
        label: copy("row:trade:label", "Trade"),
        value: copy("row:trade", input.trade),
      },
      {
        label: copy("row:activities:label", "Activities"),
        value: copy("row:activities", count),
      },
    ],
    sections: requestedWorksSections(input, copy, words.works),
    siteManager: input.siteManager,
    subject,
  });
  return { copy: writer.defaults, html, subject };
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
export function generateTradieRequestEmail(
  input: TradieRequestEmailInput,
): TradieRequestEmail {
  return renderTradieRequest(input, ({ count }) => ({
    action: oneLine(`Please reply with **one quotation covering all ${count}**,
        itemised per activity, including labour, materials (where applicable),
        exclusions and any assumptions behind your pricing. Please also let us know
        whether the approximate dates suit you.`),
    heading: "Request for Quotation",
    intro:
      oneLine(`Royal Constructions is inviting you to quote for ${input.trade} works on
        ${input.projectName}. This request covers ${count}, listed below with the work
        involved in each and when we expect it to start.`),
    works: {
      datesNote:
        oneLine(`Dates are approximate and may move with the build programme. We will
            confirm exact dates with you before work starts.`),
      heading: "Requested Works",
      startLabel: "Approx. start",
    },
  }));
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
export function generateTradieBookingEmail(
  input: TradieRequestEmailInput,
): TradieRequestEmail {
  return renderTradieRequest(input, ({ count }) => ({
    action: oneLine(`Please reply to this email to **confirm you are available**
        for all ${count} on the dates above. If any date does not suit, tell us which
        one and when you could start instead, so we can adjust the programme.`),
    heading: "Booking – Please Confirm Availability",
    intro:
      oneLine(`Royal Constructions would like to book you for ${input.trade} works on
        ${input.projectName}. This booking covers ${count}, listed below with the work
        involved in each and the date we have planned for it to start.`),
    works: {
      datesNote:
        oneLine(`These are the dates we have planned. If the build programme moves,
            we will contact you before work starts.`),
      heading: "Booked Works",
      startLabel: "Planned start",
    },
  }));
}

/** A tradie's invoice, as the recheck email lists it. */
export type TradieInvoiceRecheckLine = {
  readonly invoiceNumber: string | null;
  /** ISO date. */
  readonly issuedDate: string;
  readonly subTotalCents: number;
};

export type TradieInvoiceRecheckEmailInput = {
  readonly tradieName: string;
  readonly projectName: string;
  readonly trade: string;
  readonly activityName: string;
  /** The approved price for the booking, ex GST. */
  readonly quotedCents: number;
  /**
   * False when the quote never said whether it included GST. The email then
   * gives the amount "as quoted" rather than telling the tradie it was ex GST,
   * which we do not know.
   */
  readonly quoteGstStated: boolean;
  /** Every invoice still counted against the booking, ex GST. */
  readonly invoices: readonly TradieInvoiceRecheckLine[];
  readonly siteManager: SiteManager;
  readonly reference?: string | null;
};

/** Money to the cent: an invoice is checked against the tradie's own figure. */
const invoiceMoney = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const centsLabel = (cents: number) => invoiceMoney.format(cents / 100);
const moneyHtml = (cents: number) =>
  `<span style="font-family:${FONTS.mono};">${centsLabel(cents)}</span>`;

/** The subject a recheck goes out with; the booking's reference is added. */
export function tradieInvoiceRecheckSubject(input: {
  readonly projectName: string;
  readonly trade: string;
}): string {
  return `Invoice query – please review – ${input.projectName} | ${input.trade}`;
}

/**
 * Ask a tradie to check invoices that come to more than the quote approved
 * for their booking.
 *
 * On the booking emails' layout, and about the tradie's own figures only: the
 * approved quote and their invoices against it. Never the tender or the
 * margin, which are Royal Constructions' business and not the tradie's. It
 * asks rather than accuses — the difference may be agreed extra work that is
 * owed as a variation — and says what reply settles it either way.
 */
export function generateTradieInvoiceRecheckEmail(
  input: TradieInvoiceRecheckEmailInput,
): { subject: string; html: string } {
  const subject = subjectWithTradieRef(
    tradieInvoiceRecheckSubject(input),
    input.reference,
  );
  const invoicedCents = input.invoices.reduce(
    (total, invoice) => total + invoice.subTotalCents,
    0,
  );
  const overCents = invoicedCents - input.quotedCents;
  const project = escapeHtml(input.projectName);
  const trade = escapeHtml(input.trade);

  const invoiceRows = input.invoices
    .map(
      (invoice) => `
            <tr>
            <td style="padding:12px 20px;border-top:1px solid ${RC_COLORS.border};color:${RC_COLORS.text};">
            <span style="font-family:${FONTS.mono};">${escapeHtml(invoice.invoiceNumber ?? "No number")}</span>
            </td>
            <td style="padding:12px 20px;border-top:1px solid ${RC_COLORS.border};color:${RC_COLORS.muted};">
            ${shortRequestDate(invoice.issuedDate)}
            </td>
            <td style="padding:12px 20px;border-top:1px solid ${RC_COLORS.border};color:${RC_COLORS.text};text-align:right;">
            ${moneyHtml(invoice.subTotalCents)}
            </td>
            </tr>`,
    )
    .join("\n");

  const invoicesTable = `
            <table width="100%" cellpadding="0" cellspacing="0"
            style="
            margin:0 0 32px;
            border-collapse:collapse;
            background:${RC_COLORS.card};
            border:1px solid ${RC_COLORS.border};
            border-radius:8px;">

            <tr>
            <td colspan="3"
            style="
            padding:16px 20px;
            background:${RC_COLORS.dark};
            color:${RC_COLORS.text};
            border-bottom:2px solid ${RC_COLORS.brandGold};
            font-weight:bold;
            font-size:18px;">
            Invoices Received
            </td>
            </tr>
${invoiceRows}
            <tr>
            <td colspan="2" style="padding:14px 20px;border-top:1px solid ${RC_COLORS.border};color:${RC_COLORS.text};font-weight:bold;">
            Total invoiced (ex GST)
            </td>
            <td style="padding:14px 20px;border-top:1px solid ${RC_COLORS.border};color:${RC_COLORS.text};font-weight:bold;text-align:right;">
            ${moneyHtml(invoicedCents)}
            </td>
            </tr>

            </table>`;

  return {
    subject,
    html: renderTradieEmail({
      action:
        oneLine(`Please reply to this email to let us know whether the invoiced
        amount is correct. If it covers additional work, tell us what that work was
        and who on our side requested it, so it can be reviewed as a variation. If it
        is a mistake, please send a corrected invoice or a credit note. We will hold
        the difference until we hear from you.`),
      closing: oneLine(`If you have any questions about this, please contact the
        assigned site manager.`),
      heading: "Invoice Query – Please Review",
      intro: [
        paragraph(`Dear ${escapeHtml(input.tradieName)},`),
        paragraph(
          oneLine(`Thank you for your invoices for ${trade} works on ${project}.
          Together they come to more than the quote we approved for this booking, so
          before we process the difference we would like you to check them.`),
          true,
        ),
      ].join("\n"),
      reference: input.reference,
      rows: [
        { label: "Project", value: project },
        { label: "Trade", value: trade },
        { label: "Activity", value: escapeHtml(input.activityName) },
        {
          label: "Approved Quote",
          value: input.quoteGstStated
            ? `${moneyHtml(input.quotedCents)} ex GST`
            : `${moneyHtml(input.quotedCents)} (as quoted)`,
        },
        {
          label: "Invoiced to Date",
          value: `${moneyHtml(invoicedCents)} ex GST`,
        },
        {
          label: "Difference",
          value: `<strong>${moneyHtml(overCents)} over the approved quote</strong>`,
        },
      ],
      sections: invoicesTable,
      siteManager: input.siteManager,
      subject,
    }),
  };
}
