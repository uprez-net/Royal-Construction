"use server";

import { generateText } from "ai";
import { gateway, TEXT_MODEL_ID } from "@/lib/model";
import { getGraphConfig } from "../graph/config";
import { createGraphContext } from "../graph/client";
import { requireInternalUser } from "@/lib/auth/require-internal-user";
import {
  deleteEmailAttachment,
  sendCampaignEmail as sendCampaignEmailDomain,
} from "@/lib/domain/email/operations";
import { isDomainError } from "@/lib/domain/errors";
import { vercelBlobDelete } from "@/lib/blob-port";
import prisma from "@/lib/prisma";
import {
  generateEmailTemplate as generateEmailTemplateDocument,
  type GeneratedEmailResult,
} from "@/lib/domain/email/template";
import { userPrincipal } from "@/lib/domain/principal";

export type { GeneratedEmailResult } from "@/lib/domain/email/template";

// The lead email screens call every export here from the browser, so each is a
// Server Action anyone can post to: one spends model tokens, one deletes a
// stored file, one sends mail from Royal's mailbox to any address. Each checks
// that the caller is staff before doing anything.

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

// ─── Main Server Action ────────────────────────────────────────────────────

export async function generateEmailTemplate(
  description: string,
  attachments: { label: string; url: string }[],
  links: { label: string; url: string }[],
): Promise<GeneratedEmailResult> {
  const access = await requireInternalUser();
  if (!access.ok) {
    throw new Error(access.error);
  }

  try {
    const model = gateway(TEXT_MODEL_ID);
    return await generateEmailTemplateDocument(
      userPrincipal(access.user),
      {
        attachments,
        description,
        links,
        systemInstruction: SYSTEM_INSTRUCTION,
      },
      async ({ prompt, system }) => {
        const { text } = await generateText({ model, prompt, system });
        return text;
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to generate email template:", message, error);
    throw new Error(`AI failed to generate the email template: ${message}`);
  }
}

// export async function CreateEmailAdHock(templateName: string, emailSubject: string, blobUrl: string, attachmentsUrls: string[]) {
//   try {
//     const result = await prisma.emailAdHock.create({
//       data: {
//         name: templateName,
//         emailSubject: emailSubject,
//         htmlUrl: blobUrl,
//         attachmentsUrls: attachmentsUrls,
//       },
//     });
//     return { success: true, data: result };
//   } catch (error) {
//     console.error("Failed to save email template to DB:", error);
//     return { success: false, error: "Failed to save to database." };
//   }
// }

// // export async function UpdateEmailAdHock(id: string, templateName: string, emailSubject: string, blobUrl: string) {
// //   try {
// //     const result = await prisma.emailAdHock.update({
// //       where: { id },
// //       data: {
// //         name: templateName,
// //         emailSubject: emailSubject,
// //         htmlUrl: blobUrl,
// //       },
// //     });
// //     return { success: true, data: result };
// //   } catch (error) {
// //     console.error("Failed to update email template in DB:", error);
// //     return { success: false, error: "Failed to update database record." };
// //   }
// // }

// export async function GetEmailAdHock() {
//   try {
//     const result = await prisma.emailAdHock.findMany({
//       orderBy: { createdAt: 'desc' },
//     });
//     return { success: true, data: result };
//   } catch (error) {
//     console.error("Failed to fetch email templates from DB:", error);
//     return { success: false, error: "Failed to fetch from database." };
//   }
// }

// export async function DeleteEmailAdHock(id: string) {
//   try {

//     const existing = await prisma.emailAdHock.findUnique({ where: { id } });
//     if (!existing) {
//       return {
//         success: false,
//         error: "Email template not found.",
//       };
//     }

//     await del([
//       existing.htmlUrl,
//       ...existing.attachmentsUrls,
//     ]);

//     const result = await prisma.emailAdHock.delete({
//       where: { id: existing.id },
//     });
//     return { success: true, data: result };
//   } catch (error) {
//     console.error("Failed to delete email template from DB:", error);
//     return { success: false, error: "Failed to delete from database." };
//   }
// }

// function buildCampaignWhereClause({
//   search = "",
//   stage = "all",
// }: {
//   search?: string;
//   stage?: string;
// }) {
//   const where: Prisma.LeadWhereInput = {
//     // CRITICAL: Only include leads that actually have an email address
//     // email is a required String field (not nullable), so we only need to exclude empty strings
//     email: { not: "" },
//   };

//   // 1. Filter by Stage (ignore if "all") — convert display name to Prisma enum
//   if (stage && stage !== "all") {
//     const prismaStage = stageToPrismaMap[stage as LeadStage];
//     if (prismaStage) {
//       where.stage = prismaStage;
//     }
//   }
//   console.log("Generated Prisma where clause:", where); // Debug log to verify the generated where clause
//   // 2. Filter by Search Query (Name, Email, or Location)
//   if (search && search.trim() !== "") {
//     const searchTerm = search.trim();
//     where.OR = [
//       { name: { contains: searchTerm, mode: "insensitive" } },
//       { email: { contains: searchTerm, mode: "insensitive" } },
//       { location: { contains: searchTerm, mode: "insensitive" } },
//     ];
//   }

//   return where;
// }

// // ─── 1. Get Paginated Leads for UI List ─────────────────────────────────────

// export async function getLeadsForCampaign({
//   page = 1,
//   limit = 15,
//   search = "",
//   stage = "all",
// }: {
//   page?: number;
//   limit?: number;
//   search?: string;
//   stage?: string;
// }) {
//   // Safety checks for pagination values (from your provided logic)
//   const defaultLookupPageSize = 15;
//   const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
//   const safeLimit =
//     Number.isFinite(limit) && limit > 0
//       ? Math.min(Math.floor(limit), 50)
//       : defaultLookupPageSize;

//   const where = buildCampaignWhereClause({ search, stage });

//   const [leads, total] = await Promise.all([
//     prisma.lead.findMany({
//       where,
//       skip: (safePage - 1) * safeLimit, // Offset calculation
//       take: safeLimit,
//       orderBy: { createdAt: "desc" },
//       include: {
//         assignedUser: { select: { id: true, name: true, email: true } },
//       },
//     }),
//     prisma.lead.count({ where }),
//   ]);

//   //console.log("Checking Leads fetched for campaign:", leads); // Debug log to verify fetched leads

//   return {
//     leads,
//     total,
//     pageCount: Math.ceil(total / safeLimit),
//   };
// }

// // ─── 2. Get All Matching Lead IDs (For "Select All" Functionality) ──────────

// export async function getAllLeadIdsForCampaign({
//   search = "",
//   stage = "all",
// }: {
//   search?: string;
//   stage?: string;
// }) {
//   const where = buildCampaignWhereClause({ search, stage });

//   // Fetch all fields needed for email personalization
//   return prisma.lead.findMany({
//     where,
//     include: {
//       assignedUser: { select: { id: true, name: true, email: true } },
//     },
//   });
// }

// Where the composer uploads attachments (hooks/use-email-ad-hock.ts). Anything
// else in the store (lead documents, offer PDFs, signed contracts) is not this
// action's to delete.
export async function RemoveUrlFromBlob(blobUrl: string) {
  const access = await requireInternalUser();
  if (!access.ok) {
    return { success: false, error: access.error };
  }
  try {
    await deleteEmailAttachment(
      userPrincipal(access.user),
      blobUrl,
      vercelBlobDelete,
    );
    return { success: true };
  } catch (error) {
    if (isDomainError(error)) {
      return { success: false, error: error.message };
    }
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
  /**
   * Identifies one press of Send. Passing it makes the send idempotent per
   * recipient for that campaign run, so a double-click or a retried batch does
   * not email the whole list twice from Royal's mailbox.
   */
  runId?: string,
): Promise<boolean> {
  // false is what every caller already reads as "not sent".
  const access = await requireInternalUser();
  if (!access.ok) {
    return false;
  }

  try {
    const config = getGraphConfig();
    const client = await createGraphContext(config);
    const result = await sendCampaignEmailDomain(
      userPrincipal(access.user),
      { body, runId, subject, to },
      async (input) => {
        await client.sendMail({ ...input, cc: config.cc });
      },
      prisma,
    );
    return result.sent;
  } catch (error) {
    console.error(`[Campaign] Failed to send email to ${to}:`, error);
    return false;
  }
}
