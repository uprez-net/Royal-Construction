"use server";

import { generateText } from 'ai';
import { gateway } from '@/lib/model';
import { prisma } from '../prisma';
import { del } from '@vercel/blob';
import { stageToPrismaMap } from '@/types/lead';
import type { LeadStage } from '@/lib/leads/types';
import { Prisma } from '@prisma/client';
import { getGraphConfig } from '../graph/config';
import { createGraphContext } from '../graph/client';

// ─── Static Header & Footer ────────────────────────────────────────────────

const EMAIL_HEADER_HTML = `
<!-- Header -->
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;margin:0;padding:0;">
  <tbody>
    <tr>
      <td align="center" style="padding:24px 24px 20px;">
        <a href="https://royalconstructions.com.au" target="_blank" style="text-decoration:none;">
          <img src="https://royalconstructions.com.au/wp-content/uploads/2026/03/logo-1024x713.png" alt="Royal Constructions" width="152" height="106" style="
              display:block;
              margin:0 auto;
              width:152px;
              height:106px;
              max-width:152px;
              outline:none;
              border:none;
              text-decoration:none;
            ">
        </a>
      </td>
    </tr>
  </tbody>
</table>

<!-- Gold Bar -->
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0;padding:0;line-height:0;">
  <tbody>
    <tr>
      <td style="
          background-color:#c6923a;
          height:3px;
          font-size:0;
          line-height:0;
        ">
        &nbsp;
      </td>
    </tr>
  </tbody>
</table>
`;

const EMAIL_FOOTER_HTML = `
<!-- Footer -->
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="
    background-color:#f7f6f2;
    border-top:3px solid #c6923a;
    margin:0;
    padding:0;
    font-family: 'Inter',Arial,sans-serif;
  ">
  <tbody>
    <tr>
      <td style="padding:40px 24px;">
        <table width="100%" role="presentation">
          <tbody><tr>
            <td width="55%" valign="top" style="padding-right:24px;">
              <a href="https://royalconstructions.com.au" target="_blank" style="text-decoration:none;">
                <img src="https://royalconstructions.com.au/wp-content/uploads/2026/03/logo-1024x713.png" alt="Royal Constructions" width="110" style="display:block;width:110px;margin-bottom:20px;border:none;outline:none;">
              </a>
              <p style="font-size:13px;line-height:1.65;color:#64748b;margin:0 0 20px;max-width:300px;">
                Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
              </p>
              <p style="font-size:14px;line-height:1.5;margin:0 0 24px;">
                <a href="https://facebook.com" target="_blank" style="color:#c6923a;text-decoration:none;font-weight:500;">Facebook</a>
                <span style="color:#64748b;margin:0 10px;">·</span>
                <a href="https://instagram.com" target="_blank" style="color:#c6923a;text-decoration:none;font-weight:500;">Instagram</a>
              </p>
              <p style="font-size:12px;line-height:1.6;color:#64748b;margin:0 0 16px;">
                <strong style="color:#0f172a;">Office</strong><br>
                38/62 Turner RD<br>
                Smeaton Grange, NSW 2567
              </p>
              <p style="font-size:12px;line-height:1.6;color:#64748b;margin:0 0 20px;">
                <strong style="color:#0f172a;">Contact</strong><br>
                <a href="tel:+61412345678" style="color:#64748b;text-decoration:none;">0412 345 678</a><br>
                <a href="mailto:info@royalconstructions.com.au" style="color:#64748b;text-decoration:none;">info@royalconstructions.com.au</a>
              </p>
              <p style="font-size:11px;line-height:1.6;color:#64748b;margin:0;">
                <a href="https://royalconstructions.com.au/privacy" style="color:#c6923a;text-decoration:underline;">Privacy Policy</a> · 
                <a href="#" style="color:#c6923a;text-decoration:underline;">Unsubscribe</a> from Royal Constructions marketing emails.
              </p>
            </td>
            <td width="45%" valign="top">
              <table width="100%" role="presentation" style="background:#ffffff;border:1px solid #E2E8F0;border-radius:6px;">
                <tbody><tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 16px;font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;">Accredited By</p>
                    <a href="https://royalconstructions.com.au" target="_blank">
                      <img src="https://royalconstructions.com.au/wp-content/uploads/2026/03/image-78.png" alt="Master Builders Association" width="100" style="display:block;margin-bottom:16px;border:none;">
                    </a>
                    <a href="https://royalconstructions.com.au" target="_blank">
                      <img src="https://royalconstructions.com.au/wp-content/uploads/2026/03/Horizontal-secondary-lockup-1.png" alt="Oran Park" width="120" style="display:block;border:none;">
                    </a>
                  </td>
                </tr></tbody>
              </table>
            </td>
          </tr></tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>
`;

const SYSTEM_INSTRUCTION = `
<role>
You are an expert HTML email developer for Royal Constructions. You produce production-ready, 
email-client-safe HTML that adheres strictly to the brand's design system.
</role>

<context>
Royal Constructions is a professional construction company. All emails must reflect a premium, 
trustworthy brand voice. The email system handles transactional and marketing emails with 
personalisation variables injected at send time.
</context>

<task>
Generate the INNER BODY HTML of an email based on the user's description, links, and attachments.
Do NOT output a full HTML document — only the inner content that sits between the header and footer.
</task>

<constraints>
  <output_format>
    - Output ONLY valid HTML. Do NOT include <html>, <head>, <body>, or the header/footer wrapper.
    - Do NOT use markdown code blocks (e.g. \`\`\`html). Return raw HTML only.
    - ALL styling MUST be inline CSS. No external stylesheets. No <style> blocks.
  </output_format>

  <html_rules>
    - Do NOT use <ul>, <ol>, or <li> tags — they break padding in email clients.
      For lists, use <p> tags with bullet entities instead:
      <p style="margin:0 0 0.75rem;font-size:14px;color:#475569">
        <span style="color:#c6923a;padding-right:8px;">&bull;</span>List item text
      </p>
    - Text links MUST end with &nbsp;→  
      Example: <a href="..." style="...">View Projects&nbsp;→</a>
  </html_rules>

  <content_rules>
    - DO NOT invent sections such as "Next Steps", "Get Started", or "What Happens Next" 
      unless the user explicitly requests them. Output ONLY what is described.
    - The main container background is #ffffff. All sections should default to #ffffff.
  </content_rules>

  <variable_rules>
    - Use personalisation variables EXACTLY as listed below — do not rename, reformat, or 
      capitalise them, and do not place them inside heading tags.
    - Valid variables: {name}, {email}, {phone}, {projectType}, {location}
  </variable_rules>
</constraints>

<brand_theme>
  <colors>
    - Primary outer background (handled by wrapper): #f7f6f2
    - Inner content background: #ffffff
    - Primary gold: #c6923a
    - Dark text / headings: #0c1829
    - Muted body text: #475569
    - Border: #e2e8f0
  </colors>

  <typography>
    - Headings: "IBM Plex Sans Condensed", "Arial Narrow", Arial, sans-serif
      — uppercase, font-weight: 500
    - Body: "Inter", Arial, sans-serif — font-weight: 350, line-height: 1.65
  </typography>
</brand_theme>

<layout>
  <section_wrapper>
    Wrap EVERY section in this exact table structure to ensure correct padding and centring.
    Replace [SECTION_COLOR] and [SECTION_PADDING] as appropriate.

    <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:[SECTION_COLOR];padding:[SECTION_PADDING]">
      <tbody>
        <tr>
          <td style="padding:0 1.5rem;">
            <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tbody style="width:100%">
                <tr style="width:100%">
                  <td>
                    [CONTENT GOES HERE]
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </section_wrapper>
</layout>

<ui_components>
  <hero_section>
    background-color: #ffffff; padding: 2.5rem 0 2rem
    Must contain:
    - A 48px uppercase heading
    - A 14px muted body paragraph
  </hero_section>

  <cta_button label="LABEL" url="URL">
    <table border="0" cellpadding="0" cellspacing="0" role="presentation">
      <tbody><tr>
        <td style="background-color:#c6923a;border-radius:6px;">
          <a href="URL" style="color:#0c1829;text-decoration-line:none;display:inline-block;padding:16px 48px;font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif;font-weight:500;font-size:15px;line-height:1;letter-spacing:1px;text-transform:uppercase">
            LABEL
          </a>
        </td>
      </tr></tbody>
    </table>
  </cta_button>

  <action_card>
    Style: background-color:#ffffff; border:2px solid #c6923a; border-radius:6px; padding:1.5rem
    Contains in order:
    1. 13px uppercase gold label
    2. 26px uppercase heading
    3. Body text
    4. CTA button (see <cta_button>)
  </action_card>

  <notice_block>
    Style: background-color:#ffffff; border-left:3px solid #c6923a; 
           padding:1rem 1.25rem; border-radius:0 6px 6px 0
    Use for quotes, notices, or callout text.
  </notice_block>

  <sign_off>
    Always close the email with a professional sign-off separated by a top border.
    Do NOT apply uppercase styling to this section.
    Format:
    - "Warm regards," in #0c1829
    - "Gurpinder Uppal" in #c6923a
    - "Royal Constructions Pty Ltd" in #475569
  </sign_off>
</ui_components>

<output_structure>
  You MUST format your entire response EXACTLY as shown below. 
  Do not add any other text before or after this structure.

  ---SUBJECT---
  [The email subject line]
  ---NAME---
  [A short descriptive template name, e.g. "Welcome Follow-up"]
  ---HTML---
  [Your raw HTML output]
</output_structure>
`;
// ─── Types & Schemas ───────────────────────────────────────────────────────

export interface GeneratedEmailResult {
  html: string;
  subject: string;
  name: string;
}

function isSafePromptUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Main Server Action ────────────────────────────────────────────────────

export async function generateEmailTemplate(
  description: string,
  attachments: { label: string; url: string }[],
  links: { label: string; url: string }[]
): Promise<GeneratedEmailResult> {
  const model = gateway('google/gemini-2.5-flash');
  const safeLinks = links.filter((link) => isSafePromptUrl(link.url));
  const safeAttachments = attachments.filter((attachment) => isSafePromptUrl(attachment.url));

  const linksContext = safeLinks.length > 0
    ? `LINKS TO INCLUDE (Render these as Gold CTA Buttons inside an Action Card):\n${safeLinks.map(l => `- Label: "${l.label}", URL: ${l.url}`).join('\n')}`
    : '';

  const attachmentsContext = safeAttachments.length > 0
    ? `ATTACHMENTS TO INCLUDE (Render these as secondary text links with &nbsp;→):\n${safeAttachments.map(a => `- File Name: "${a.label}", URL: ${a.url}`).join('\n')}`
    : '';

  const userPrompt = `
Please write the HTML email body based on this description:

DESCRIPTION:
 ${description}

 ${linksContext}

 ${attachmentsContext}

The Text content Should be at left position always, and the design should be clean and minimalistic, following the brand theme provided. 
Remember, follow the brand theme strictly, do not add unrequested sections, and format your response exactly as requested. 
  `.trim();

  try {
    // Use generateText instead of ToolLoopAgent to save tokens and avoid rate limits
    const { text } = await generateText({
      model,
      system: SYSTEM_INSTRUCTION,
      prompt: userPrompt,
    });

    // Parse the structured response
    let subjectContent = 'Royal Constructions Update';
    let nameContent = 'Custom AI Email';
    let htmlContent = text;

    // Extract Subject
    const subjectMatch = text.match(/---SUBJECT---\s*([\s\S]*?)\s*---NAME---/);
    if (subjectMatch) subjectContent = subjectMatch[1].trim();

    // Extract Name
    const nameMatch = text.match(/---NAME---\s*([\s\S]*?)\s*---HTML---/);
    if (nameMatch) nameContent = nameMatch[1].trim();

    // Extract HTML
    const htmlMatch = text.match(/---HTML---\s*([\s\S]*)/);
    if (htmlMatch) htmlContent = htmlMatch[1].trim();

    // Clean up potential markdown block wrappers if the AI added them
    let cleanBody = htmlContent.trim();
    if (cleanBody.startsWith('```html')) cleanBody = cleanBody.slice(7);
    else if (cleanBody.startsWith('```')) cleanBody = cleanBody.slice(3);
    if (cleanBody.endsWith('```')) cleanBody = cleanBody.slice(0, -3);
    cleanBody = cleanBody.trim();

    // Assemble the final email
    const finalHtml = `
<div style="background-color:#f7f6f2;margin:0;padding:0">
  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin-right:auto;margin-left:auto;background-color:#ffffff">
    <tbody>
      <tr style="width:100%">
        <td style="margin:0;padding:0">
          ${EMAIL_HEADER_HTML}
          ${cleanBody}
          ${EMAIL_FOOTER_HTML}
        </td>
      </tr>
    </tbody>
  </table>
</div>
    `.trim();

    return {
      html: finalHtml,
      subject: subjectContent,
      name: nameContent
    };

  } catch (error) {
    console.error("Failed to generate email template:", error);
    throw new Error("AI failed to generate the email template.");
  }
}

export async function CreateEmailAdHock(templateName: string, emailSubject: string, blobUrl: string) {
  try {
    const result = await prisma.emailAdHock.create({
      data: {
        name: templateName,
        emailSubject: emailSubject,
        htmlUrl: blobUrl,
      },
    });
    return { success: true, data: result };
  } catch (error) {
    console.error("Failed to save email template to DB:", error);
    return { success: false, error: "Failed to save to database." };
  }
}

// export async function UpdateEmailAdHock(id: string, templateName: string, emailSubject: string, blobUrl: string) {
//   try {
//     const result = await prisma.emailAdHock.update({
//       where: { id },
//       data: {
//         name: templateName,
//         emailSubject: emailSubject,
//         htmlUrl: blobUrl,
//       },
//     });
//     return { success: true, data: result };
//   } catch (error) {
//     console.error("Failed to update email template in DB:", error);
//     return { success: false, error: "Failed to update database record." };
//   }
// }

export async function GetEmailAdHock() {
  try {
    const result = await prisma.emailAdHock.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: result };
  } catch (error) {
    console.error("Failed to fetch email templates from DB:", error);
    return { success: false, error: "Failed to fetch from database." };
  }
}

export async function DeleteEmailAdHock(id: string) {
  try {

    const existing = await prisma.emailAdHock.findUnique({ where: { id } });
    if (!existing) {
      return { success: false, error: "Email template not found." };
    }

    await del(existing.htmlUrl)

    const result = await prisma.emailAdHock.delete({
      where: { id: existing.id },
    });
    return { success: true, data: result };
  } catch (error) {
    console.error("Failed to delete email template from DB:", error);
    return { success: false, error: "Failed to delete from database." };
  }
}

function buildCampaignWhereClause({
  search = "",
  stage = "all",
}: {
  search?: string;
  stage?: string;
}) {
  const where: Prisma.LeadWhereInput = {
    // CRITICAL: Only include leads that actually have an email address
    // email is a required String field (not nullable), so we only need to exclude empty strings
    email: { not: "" },
  };

  // 1. Filter by Stage (ignore if "all") — convert display name to Prisma enum
  if (stage && stage !== "all") {
    const prismaStage = stageToPrismaMap[stage as LeadStage];
    if (prismaStage) {
      where.stage = prismaStage;
    }
  }
    console.log("Generated Prisma where clause:", where); // Debug log to verify the generated where clause
  // 2. Filter by Search Query (Name, Email, or Location)
  if (search && search.trim() !== "") {
    const searchTerm = search.trim();
    where.OR = [
      { name: { contains: searchTerm, mode: "insensitive" } },
      { email: { contains: searchTerm, mode: "insensitive" } },
      { location: { contains: searchTerm, mode: "insensitive" } },
    ];
  }

  return where;
}

// ─── 1. Get Paginated Leads for UI List ─────────────────────────────────────

export async function getLeadsForCampaign({
  page = 1,
  limit = 15,
  search = "",
  stage = "all",
}: {
  page?: number;
  limit?: number;
  search?: string;
  stage?: string;
}) {
  // Safety checks for pagination values (from your provided logic)
  const defaultLookupPageSize = 15;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 50)
      : defaultLookupPageSize;

  const where = buildCampaignWhereClause({ search, stage });

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip: (safePage - 1) * safeLimit, // Offset calculation
      take: safeLimit,
      orderBy: { createdAt: "desc" },
      include: {
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  //console.log("Checking Leads fetched for campaign:", leads); // Debug log to verify fetched leads

  return {
    leads,
    total,
    pageCount: Math.ceil(total / safeLimit),
  };
}

// ─── 2. Get All Matching Lead IDs (For "Select All" Functionality) ──────────

export async function getAllLeadIdsForCampaign({
  search = "",
  stage = "all",
}: {
  search?: string;
  stage?: string;
}) {
  const where = buildCampaignWhereClause({ search, stage });

  // Fetch all fields needed for email personalization
  return prisma.lead.findMany({
    where,
    include: {
      assignedUser: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function RemoveUrlFromBlob(blobUrl: string) {
  try {
    await del(blobUrl);
    return { success: true };
  } catch (error) {
    console.error("Failed to delete blob at URL:", blobUrl, error);
    return { success: false, error: "Failed to delete blob." };
  }
}

// ─── Server Action: Send Campaign Email ─────────────────────────────────────
// Bypasses the /api/graph/send route entirely — runs on the server with full
// access to env vars and the Graph client, so no admin‑token header is needed.

export async function sendCampaignEmail(
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    const config = getGraphConfig();
    const client = await createGraphContext(config);
    await client.sendMail({ to, subject, body, cc: config.cc });
    return true;
  } catch (error) {
    console.error(`[Campaign] Failed to send email to ${to}:`, error);
    return false;
  }
}
