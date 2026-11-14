import type { LeadWhatsAppMessageRecord } from "@/lib/domain/leads/whatsapp/records";
import type {
  LeadWhatsAppSummary,
  LeadWhatsAppThread,
} from "@/lib/domain/leads/whatsapp/queries";
import type { UnmatchedWhatsAppRecord } from "@/lib/domain/leads/whatsapp/unmatched";
import type { LeadWhatsAppConsentState } from "@/lib/domain/leads/whatsapp/consent";

// The WhatsApp records as the browser receives them (issue #333).
//
// Type-only imports: the domain owns the shapes, and JSON turns every Date
// into an ISO string on the way over. Deriving the client types from the
// domain ones keeps the two from drifting without pulling a server module
// into the bundle.

/** A domain record after `JSON.stringify`: Dates arrive as ISO strings. */
export type Jsonified<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Jsonified<T[K]> }
      : T;

export type WhatsAppMessageDto = Jsonified<LeadWhatsAppMessageRecord>;
export type WhatsAppThreadDto = Jsonified<LeadWhatsAppThread>;
export type WhatsAppSummaryDto = Jsonified<LeadWhatsAppSummary>;
export type WhatsAppUnmatchedDto = Jsonified<UnmatchedWhatsAppRecord>;
export type WhatsAppConsentDto = Jsonified<LeadWhatsAppConsentState>;

export type WhatsAppSendBody =
  | { kind: "text"; body: string; businessPhoneNumberId?: string | null }
  | {
      kind: "template";
      templateName: string;
      parameters: string[];
      businessPhoneNumberId?: string | null;
    };

export type WhatsAppSendResultDto = {
  message: WhatsAppMessageDto;
  /** The key had already sent; nothing went out this time. */
  alreadySent: boolean;
};

export type WhatsAppUnmatchedListDto = {
  items: WhatsAppUnmatchedDto[];
  pendingCount: number;
};
