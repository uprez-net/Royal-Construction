import { LOGO_EMAIL, RC_COLORS, RC_URLS } from "./email-theme";

// The confirmation a client gets for an in-person consultation. An online
// booking is confirmed by the Teams invitation Graph sends; an in-person one
// has no meeting link to send, so this email is the whole confirmation and
// carries the venue instead.
//
// Every value here arrives from the open booking form — the name, the venue
// and the agenda are whatever the visitor typed — so each one is escaped
// before it is placed in the HTML. utils/generate-email.ts, which this is
// styled after, interpolates raw values because its inputs are our own rows.

export type InPersonConsultationEmailInput = {
  readonly name: string;
  /** "Saturday 6 June 2026" */
  readonly formattedDate: string;
  /** "02:00 pm - 03:00 pm (AEDT)" */
  readonly formattedTime: string;
  readonly venue: string;
  /** The agenda or project notes from the form. Omitted from the email when empty. */
  readonly agenda?: string;
  /** The mailbox the signature points the client back to (BUSINESS_EMAIL). */
  readonly signatureEmail: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escaped, with the visitor's own line breaks kept. */
function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function detailRow(label: string, valueHtml: string, first = false): string {
  const border = first ? "" : `border-top:1px solid ${RC_COLORS.border};`;
  return `
            <tr>
            <td style="padding:14px 20px;color:${RC_COLORS.muted};width:160px;vertical-align:top;${border}">
            ${label}
            </td>
            <td style="padding:14px 20px;color:${RC_COLORS.text};${border}">
            ${valueHtml}
            </td>
            </tr>`;
}

export function generateInPersonConsultationEmail(
  input: InPersonConsultationEmailInput,
): { subject: string; html: string } {
  const name = escapeHtml(input.name.trim() || "there");
  const venue = escapeMultiline(input.venue.trim());
  const agenda = input.agenda?.trim()
    ? escapeMultiline(input.agenda.trim())
    : "";
  const signatureEmail = escapeHtml(input.signatureEmail);
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(input.venue.trim())}`;

  const subject = `Your in-person consultation – ${input.formattedDate} | Royal Constructions`;

  return {
    subject,
    html: `
            <!DOCTYPE html>
            <html>
            <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(subject)}</title>
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
            <td style="padding:32px 40px 40px;">

            <p style="margin:0 0 8px;color:${RC_COLORS.gold};font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;">
            Consultation Confirmed
            </p>

            <h1 style="
            margin:0 0 24px;
            color:${RC_COLORS.text};
            font-size:30px;
            font-weight:bold;
            line-height:38px;">
            We look forward to meeting you
            </h1>

            <p style="margin:0 0 16px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
            Dear ${name},
            </p>

            <p style="margin:0 0 16px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
            Thank you for booking a consultation with Royal Constructions. Your
            in-person meeting is confirmed, and the details are below.
            </p>

            <p style="margin:0;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
            The consultation runs for about an hour. It is a chance to talk through
            your block, your plans and your budget with our team, and for us to
            answer any questions you have about building with us.
            </p>

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
            color:${RC_COLORS.white};
            font-weight:bold;
            font-size:18px;">
            Meeting Details
            </td>
            </tr>
            ${detailRow("Date", escapeHtml(input.formattedDate), true)}
            ${detailRow("Time", escapeHtml(input.formattedTime))}
            ${detailRow("Meeting type", "In person")}
            ${detailRow(
              "Venue",
              `${venue}<br><a href="${escapeHtml(directionsUrl)}" style="color:${RC_COLORS.gold};font-size:14px;">Get directions</a>`,
            )}
            ${agenda ? detailRow("Agenda", agenda) : ""}

            </table>

            <div
            style="
            margin:0 0 32px;
            padding:22px;
            background:${RC_COLORS.card};
            border-left:4px solid ${RC_COLORS.gold};">

            <p style="margin:0 0 12px;color:${RC_COLORS.text};font-weight:bold;">
            Helpful to bring along
            </p>

            <p style="margin:0;color:${RC_COLORS.text};line-height:26px;">
            Your land details or survey, any plans or sketches, photos of homes or
            finishes you like, and your preferred timeline and budget range. Anything
            you have is useful; nothing is required.
            </p>

            </div>

            <p style="margin:0 0 24px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
            If you need to change the time or can no longer attend, simply reply to
            this email or call us on ${RC_URLS.phoneDisplay} and we will arrange
            another time.
            </p>

            <p style="margin:32px 0 0;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
            Kind regards,<br>
            <strong>Royal Constructions Team</strong><br>
            <a href="mailto:${signatureEmail}" style="color:${RC_COLORS.gold};">${signatureEmail}</a>
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

            Email: ${signatureEmail}<br><br>

            © ${new Date().getFullYear()} Royal Constructions. All rights reserved.

            </td>
            </tr>

            </table>

            </td>
            </tr>
            </table>

            </body>
            </html>
            `,
  };
}
