import { LOGO_EMAIL, RC_COLORS, RC_URLS } from "@/lib/graph/Email/email-theme";
import { TradieScheduleListItem } from "@/types/project";


export function generateTradieOutreachEmail(input: TradieScheduleListItem): {
    subject: string;
    html: string;
} {
    const formattedDate = new Date(input.scheduledDate).toLocaleDateString(
        "en-AU",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
        }
    );

    const subject = input.requiresQuote
        ? `Request for Quotation – ${input.projectName} | ${input.tradeType}`
        : `Availability Confirmation Required – ${input.projectName}`;

    const primaryAction = input.requiresQuote
        ? "Submit Quotation"
        : "Confirm Availability";

    const intro = input.requiresQuote
        ? `
      <p style="margin:0 0 16px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
        Dear ${input.tradieName},
      </p>

      <p style="margin:0 0 16px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
        Royal Constructions is inviting you to provide a quotation for an upcoming project.
        Based on your trade expertise, we would like you to review the project information
        and submit your pricing for the requested scope of works.
      </p>

      <p style="margin:0;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
        The project documentation, including the council-approved architectural plans,
        specifications and milestone information, will be attached to this email for your review.
      </p>
    `
        : `
      <p style="margin:0 0 16px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
        Dear ${input.tradieName},
      </p>

      <p style="margin:0 0 16px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
        We have scheduled you for an upcoming stage of works on one of our active
        construction projects. Please review the schedule details below and confirm
        your availability at your earliest convenience.
      </p>

      <p style="margin:0;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
        Prompt confirmation helps us coordinate trades efficiently and maintain
        construction timelines across the project.
      </p>
    `;

    const actionText = input.requiresQuote
        ? `
      Please review the attached documentation and submit your quotation based on
      the requested scope of works. Your quotation should include labour,
      materials (where applicable), exclusions and any assumptions relevant
      to your pricing.
    `
        : `
      Please confirm whether you are available to complete these works on the
      scheduled date. If you are unavailable, notify the site manager as soon
      as possible so alternative arrangements can be made.
    `;

    return {
        subject,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
            <meta charset="UTF-8">
            <title>${subject}</title>
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
            color:white;
            font-size:30px;
            font-weight:bold;
            line-height:38px;">
            ${input.requiresQuote ? "Request for Quotation" : "Availability Confirmation"}
            </h1>

            ${intro}

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

            <tr>
            <td style="padding:14px 20px;color:${RC_COLORS.muted};width:220px;border-top:1px solid ${RC_COLORS.border};">
            Project
            </td>
            <td style="padding:14px 20px;color:white;border-top:1px solid ${RC_COLORS.border};">
            ${input.projectName}
            </td>
            </tr>

            <tr>
            <td style="padding:14px 20px;color:${RC_COLORS.muted};border-top:1px solid ${RC_COLORS.border};">
            Trade
            </td>
            <td style="padding:14px 20px;color:white;border-top:1px solid ${RC_COLORS.border};">
            ${input.tradeType}
            </td>
            </tr>

            <tr>
            <td style="padding:14px 20px;color:${RC_COLORS.muted};border-top:1px solid ${RC_COLORS.border};">
            Milestone
            </td>
            <td style="padding:14px 20px;color:white;border-top:1px solid ${RC_COLORS.border};">
            ${input.milestoneName ?? input.taskLabel}
            </td>
            </tr>

            <tr>
            <td style="padding:14px 20px;color:${RC_COLORS.muted};border-top:1px solid ${RC_COLORS.border};">
            Scheduled Date
            </td>
            <td style="padding:14px 20px;color:white;border-top:1px solid ${RC_COLORS.border};">
            ${formattedDate}
            </td>
            </tr>

            <tr>
            <td style="padding:14px 20px;color:${RC_COLORS.muted};border-top:1px solid ${RC_COLORS.border};">
            Duration
            </td>
            <td style="padding:14px 20px;color:white;border-top:1px solid ${RC_COLORS.border};">
            ${input.durationDays} day${input.durationDays > 1 ? "s" : ""}
            </td>
            </tr>

            ${!input.requiresQuote
                            ? `
            <tr>
            <td style="padding:14px 20px;color:${RC_COLORS.muted};border-top:1px solid ${RC_COLORS.border};">
            Agreed Price
            </td>
            <td style="padding:14px 20px;color:white;border-top:1px solid ${RC_COLORS.border};">
            ${input.quotedPrice ?? "-"}
            </td>
            </tr>
            `
                : ""
            }

            </table>

            <p style="margin:0 0 24px;color:${RC_COLORS.text};font-size:16px;line-height:26px;">
            ${actionText}
            </p>

            <div
            style="
            margin:36px 0;
            padding:22px;
            background:${RC_COLORS.card};
            border-left:4px solid ${RC_COLORS.gold};">

            <p style="margin:0 0 12px;color:white;font-weight:bold;">
            Site Manager
            </p>

            <p style="margin:0;color:${RC_COLORS.text};line-height:26px;">
            <strong>${input.siteManager.name}</strong><br>
            ${input.siteManager.email}<br>
            ${input.siteManager.phone}
            </p>

            </div>

            <table cellpadding="0" cellspacing="0" align="center">
            <tr>
            <td
            style="
            background:${RC_COLORS.gold};
            border-radius:6px;
            padding:14px 34px;">

            <a
            href="${RC_URLS.bookConsultation}"
            style="
            color:${RC_COLORS.dark};
            text-decoration:none;
            font-size:16px;
            font-weight:bold;">
            ${primaryAction}
            </a>

            </td>
            </tr>
            </table>

            <p style="
            margin:40px 0 0;
            font-size:14px;
            line-height:24px;
            color:${RC_COLORS.muted};">

            If you have any questions regarding this work package or require further
            clarification, please contact the assigned site manager before the scheduled
            commencement date.

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

            <strong style="color:white;">Royal Constructions</strong><br><br>

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
            `,
    };
}