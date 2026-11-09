import type { WhatsAppConsentSource } from "@prisma/client";

// How each consent source reads to an operator. Its own module, with a
// type-only Prisma import, so the App's consent picker can import it without
// pulling the command (and `@prisma/client` at runtime) into the browser.

export const WHATSAPP_CONSENT_SOURCE_LABELS: Record<
  WhatsAppConsentSource,
  string
> = {
  CUSTOMER_INITIATED: "Customer messaged us first",
  VERBAL: "Agreed on a call or in person",
  WEB_FORM: "Opted in on a web form",
  WRITTEN: "Agreed in writing (email or letter)",
};
