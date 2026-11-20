import type { WhatsAppConsentSource } from "@prisma/client";

import { canAccessLead } from "../../access/leads";
import type { TransactionalDomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "../../errors";
import { isOfficePrincipal, type DomainPrincipal } from "../../principal";
import { WHATSAPP_CONSENT_SOURCE_LABELS } from "./consent-labels";
import { recordWhatsAppHistory } from "./records";

// Recording, and correcting, a lead's WhatsApp consent (issue #333).
//
// A phone number is not consent. The office records how the customer agreed
// — on a call, in writing, on a web form, or by starting the conversation —
// and that record is what allows a proactive template outside the service
// window. An opt-out blocks every send until fresh consent is recorded.
//
// Staff only, and deliberately not an Eve tool: consent is a statement about
// what a customer said, and it should come from the person who heard it, not
// from a model's reading of a transcript.

export { WHATSAPP_CONSENT_SOURCE_LABELS };

export type LeadWhatsAppConsentInput =
  | {
      readonly leadId: number;
      readonly action: "grant";
      readonly source: WhatsAppConsentSource;
      readonly note?: string | null;
    }
  | {
      readonly leadId: number;
      readonly action: "opt_out";
      readonly note?: string | null;
    };

export type LeadWhatsAppConsentState = {
  readonly consentAt: Date | null;
  readonly consentSource: WhatsAppConsentSource | null;
  readonly consentNote: string | null;
  readonly optedOutAt: Date | null;
};

export async function recordLeadWhatsAppConsent(
  principal: DomainPrincipal,
  input: LeadWhatsAppConsentInput,
  db: TransactionalDomainDb,
): Promise<LeadWhatsAppConsentState> {
  if (principal.kind !== "user" || !isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Recording WhatsApp consent requires a signed-in member of staff.",
    );
  }
  const lead = await db.lead.findUnique({
    select: { assignedId: true, id: true, isArchived: true },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (!canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }
  const note = input.note?.trim() || null;
  if (note && note.length > 500) {
    throw new DomainValidationError(
      "Keep the consent note to 500 characters or fewer.",
      "note",
    );
  }

  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      data:
        input.action === "grant"
          ? {
              whatsappConsentAt: now,
              whatsappConsentNote: note,
              whatsappConsentRecordedBy: { connect: { id: principal.userId } },
              whatsappConsentSource: input.source,
              // Fresh consent supersedes an earlier opt-out.
              whatsappOptedOutAt: null,
            }
          : {
              // The consent record goes with the opt-out, so re-consenting
              // is a new, dated statement rather than a reactivated old one.
              whatsappConsentAt: null,
              whatsappConsentNote: note,
              whatsappConsentRecordedBy: { connect: { id: principal.userId } },
              whatsappConsentSource: null,
              whatsappOptedOutAt: now,
            },
      select: {
        whatsappConsentAt: true,
        whatsappConsentNote: true,
        whatsappConsentSource: true,
        whatsappOptedOutAt: true,
      },
      where: { id: lead.id },
    });
    await recordWhatsAppHistory(tx, {
      action:
        input.action === "grant"
          ? "WhatsApp consent recorded"
          : "WhatsApp opt-out recorded",
      at: now,
      detail:
        input.action === "grant"
          ? `${WHATSAPP_CONSENT_SOURCE_LABELS[input.source]}${note ? ` — ${note}` : ""}`
          : `The lead asked not to be contacted on WhatsApp${note ? ` — ${note}` : ""}.`,
      leadId: lead.id,
      principal,
    });
    return {
      consentAt: updated.whatsappConsentAt,
      consentNote: updated.whatsappConsentNote,
      consentSource: updated.whatsappConsentSource,
      optedOutAt: updated.whatsappOptedOutAt,
    };
  });
}
