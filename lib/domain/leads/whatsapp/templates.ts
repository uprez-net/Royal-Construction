import { DomainValidationError } from "../../errors";
import type { WhatsAppChannel } from "../../ports/whatsapp";

// The approved-template catalogue (issue #333).
//
// Outside the customer-service window WhatsApp only delivers a template Meta
// has approved, and it delivers exactly the approved wording with the
// variables substituted. So the catalogue is code, not a table: every entry
// has to match a template submitted in WhatsApp Manager byte for byte, and a
// change here is a change to what customers read, which belongs in review.
// docs/whatsapp-runbook.md is the procedure for adding one.
//
// The body is kept here as well as in Meta for two reasons: the operator must
// see a preview of exactly what goes out before pressing Send, and the thread
// must show what the customer received. Neither can wait for a provider call.

export type WhatsAppTemplateParameter = {
  /** What the operator is asked for. */
  readonly label: string;
  /** Shown as the placeholder, and what Meta was given as the sample. */
  readonly example: string;
  /** Prefilled from the lead when there is a sensible value. */
  readonly prefill?: "leadFirstName" | "leadLocation" | "leadProjectType";
};

export type WhatsAppTemplateDefinition = {
  /** The template name in WhatsApp Manager. */
  readonly name: string;
  /** Its language code in WhatsApp Manager, e.g. "en". */
  readonly language: string;
  readonly label: string;
  readonly description: string;
  /** The approved body, with {{1}}, {{2}}, … for the variables. */
  readonly body: string;
  readonly parameters: readonly WhatsAppTemplateParameter[];
};

export const WHATSAPP_TEMPLATES: readonly WhatsAppTemplateDefinition[] = [
  {
    body: "Hi {{1}}, it's Royal Constructions following up on your enquiry about {{2}}. Reply here whenever suits and we'll pick it up with you, or let us know a good time to call.",
    description:
      "A first or follow-up contact about an enquiry, when the customer has not written in the last 24 hours.",
    label: "Enquiry follow-up",
    language: "en",
    name: "lead_enquiry_follow_up",
    parameters: [
      { example: "Sam", label: "Customer first name", prefill: "leadFirstName" },
      {
        example: "your new home in Kellyville",
        label: "What the enquiry was about",
        prefill: "leadProjectType",
      },
    ],
  },
  {
    body: "Hi {{1}}, it's Royal Constructions. We tried to reach you about your building enquiry. Reply to this message and we'll get back to you.",
    description: "A short nudge after a missed call or an unanswered email.",
    label: "Missed you",
    language: "en",
    name: "lead_missed_contact",
    parameters: [
      { example: "Sam", label: "Customer first name", prefill: "leadFirstName" },
    ],
  },
];

/** Meta rejects a variable with a newline, a tab or four spaces in a row. */
const MAX_PARAMETER_LENGTH = 200;
const FORBIDDEN_IN_PARAMETER = /[\n\r\t]| {4,}/;

export function findWhatsAppTemplate(
  name: string,
): WhatsAppTemplateDefinition | null {
  return WHATSAPP_TEMPLATES.find((template) => template.name === name) ?? null;
}

/** The catalogue entries this deployment's WhatsApp account has approved. */
export function availableWhatsAppTemplates(
  channel: Pick<WhatsAppChannel, "enabledTemplateNames"> | null,
): readonly WhatsAppTemplateDefinition[] {
  const enabled = channel?.enabledTemplateNames;
  if (!enabled) return WHATSAPP_TEMPLATES;
  const allowed = new Set(enabled);
  return WHATSAPP_TEMPLATES.filter((template) => allowed.has(template.name));
}

/** The body the customer will read, with the variables substituted. */
export function renderWhatsAppTemplate(
  template: WhatsAppTemplateDefinition,
  parameters: readonly string[],
): string {
  return template.body.replace(/\{\{(\d+)\}\}/g, (placeholder, index) => {
    const value = parameters[Number(index) - 1];
    return value === undefined ? placeholder : value;
  });
}

/**
 * Check the variables before anything is written or sent.
 *
 * A count mismatch or an empty variable is refused by Meta with a generic
 * error after the operator presses Send; the issue asks for the reason up
 * front instead.
 */
export function validateWhatsAppTemplateParameters(
  template: WhatsAppTemplateDefinition,
  parameters: readonly string[],
): string[] {
  if (parameters.length !== template.parameters.length) {
    throw new DomainValidationError(
      `The “${template.label}” template needs ${template.parameters.length} value${template.parameters.length === 1 ? "" : "s"}.`,
      "parameters",
    );
  }
  return parameters.map((raw, index) => {
    const label = template.parameters[index]?.label ?? `Value ${index + 1}`;
    const value = raw.trim();
    if (!value) {
      throw new DomainValidationError(`Fill in “${label}”.`, "parameters");
    }
    if (value.length > MAX_PARAMETER_LENGTH) {
      throw new DomainValidationError(
        `“${label}” must be ${MAX_PARAMETER_LENGTH} characters or fewer.`,
        "parameters",
      );
    }
    if (FORBIDDEN_IN_PARAMETER.test(value)) {
      throw new DomainValidationError(
        `“${label}” cannot contain line breaks, tabs or long runs of spaces — WhatsApp refuses them in a template.`,
        "parameters",
      );
    }
    return value;
  });
}

export type WhatsAppTemplateLeadContext = {
  readonly name: string;
  readonly location: string;
  readonly type: readonly string[];
};

/** Suggested variable values for a lead. The operator can change every one. */
export function prefillWhatsAppTemplateParameters(
  template: WhatsAppTemplateDefinition,
  lead: WhatsAppTemplateLeadContext,
): string[] {
  const firstName = lead.name.trim().split(/\s+/)[0] ?? "";
  const projectType = lead.type.find(
    (value) => value && value !== "Not Specified",
  );
  return template.parameters.map((parameter) => {
    switch (parameter.prefill) {
      case "leadFirstName":
        return firstName;
      case "leadLocation":
        return lead.location.trim();
      case "leadProjectType":
        if (projectType && lead.location.trim()) {
          return `your ${projectType.toLowerCase()} in ${lead.location.trim()}`;
        }
        return projectType ? `your ${projectType.toLowerCase()}` : "";
      default:
        return "";
    }
  });
}
