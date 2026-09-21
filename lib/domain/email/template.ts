import {
  EMAIL_FOOTER_HTML,
  EMAIL_HEADER_HTML,
} from "@/constants/email-artifacts";

import { DomainAuthorizationError, DomainValidationError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";

export type EmailTemplateLink = { readonly label: string; readonly url: string };

export type EmailTemplateInput = {
  readonly description: string;
  readonly attachments: readonly EmailTemplateLink[];
  readonly links: readonly EmailTemplateLink[];
  readonly systemInstruction: string;
};

export type EmailTextGenerationPort = (input: {
  readonly system: string;
  readonly prompt: string;
}) => Promise<string>;

export type GeneratedEmailResult = {
  readonly html: string;
  readonly subject: string;
  readonly name: string;
};

/** Keep arbitrary URLs out of the model context and the generated message. */
export function isSafeEmailTemplateUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Generate and normalise the customer-visible email document through a port. */
export async function generateEmailTemplate(
  principal: DomainPrincipal,
  input: EmailTemplateInput,
  generate: EmailTextGenerationPort,
): Promise<GeneratedEmailResult> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Email template generation requires internal staff access.",
    );
  }
  const description = input.description.trim();
  if (!description) {
    throw new DomainValidationError(
      "An email description is required.",
      "description",
    );
  }

  const links = input.links.filter((link) => isSafeEmailTemplateUrl(link.url));
  const attachments = input.attachments.filter((attachment) =>
    isSafeEmailTemplateUrl(attachment.url),
  );
  const linksContext = links.length
    ? `LINKS TO INCLUDE (Render these as Gold CTA Buttons inside an Action Card):\n${links.map((link) => `- Label: "${link.label}", URL: ${link.url}`).join("\n")}`
    : "";
  const attachmentsContext = attachments.length
    ? `ATTACHMENTS TO INCLUDE (Render these as secondary text links with &nbsp;→):\n${attachments.map((attachment) => `- File Name: "${attachment.label}", URL: ${attachment.url}`).join("\n")}`
    : "";
  const prompt = `
Please write the HTML email body based on this description:

DESCRIPTION:
 ${description}

 ${linksContext}

 ${attachmentsContext}

The Text content Should be at left position always, and the design should be clean and minimalistic, following the brand theme provided.
Remember, follow the brand theme strictly, do not add unrequested sections, and format your response exactly as requested.
  `.trim();

  const text = await generate({
    prompt,
    system: input.systemInstruction,
  });
  return parseGeneratedEmail(text);
}

function parseGeneratedEmail(text: string): GeneratedEmailResult {
  let subject = "Royal Constructions Update";
  let name = "Custom AI Email";
  let html = text;
  const subjectMatch = text.match(/---SUBJECT---\s*([\s\S]*?)\s*---NAME---/);
  if (subjectMatch) subject = subjectMatch[1].trim();
  const nameMatch = text.match(/---NAME---\s*([\s\S]*?)\s*---HTML---/);
  if (nameMatch) name = nameMatch[1].trim();
  const htmlMatch = text.match(/---HTML---\s*([\s\S]*)/);
  if (htmlMatch) html = htmlMatch[1].trim();

  let cleanBody = html.trim();
  if (cleanBody.startsWith("```html")) cleanBody = cleanBody.slice(7);
  else if (cleanBody.startsWith("```")) cleanBody = cleanBody.slice(3);
  if (cleanBody.endsWith("```")) cleanBody = cleanBody.slice(0, -3);

  return {
    html: `<div style="background-color:#f7f6f2;margin:0;padding:0">
  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin-right:auto;margin-left:auto;background-color:#ffffff">
    <tbody>
      <tr style="width:100%">
        <td style="margin:0;padding:0">
          ${EMAIL_HEADER_HTML}
          ${cleanBody.trim()}
          ${EMAIL_FOOTER_HTML}
        </td>
      </tr>
    </tbody>
  </table>
</div>`.trim(),
    name,
    subject,
  };
}
