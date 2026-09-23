// The WhatsApp Business Platform, as the domain sees it (issue #333).
//
// lib/domain/leads/whatsapp decides who may be messaged, from which Royal
// number, with what, and how many times. This port is only the capability to
// hand a decided message to the provider. The production adapter is
// lib/whatsapp/cloud-api.ts (Meta Cloud API, plain `fetch`), which both the App
// and Eve construct — so it must stay loadable by Node's own ESM loader: no
// `server-only`, no Next, no Clerk.
//
// Secrets never cross this boundary. The domain sees which business numbers
// exist and whether this runtime can send; the access token stays inside the
// adapter.

/** One Royal WhatsApp Business number, as configured for this deployment. */
export type WhatsAppBusinessNumber = {
  /** Meta's phone_number_id. Inbound routing and outbound sends key on it. */
  readonly phoneNumberId: string;
  /** The number customers see, in E.164. */
  readonly displayNumber: string;
  /** What the office calls it ("Office", "Sales"). */
  readonly label: string;
};

/** The non-secret shape of the channel, safe to show an operator. */
export type WhatsAppChannel = {
  readonly numbers: readonly WhatsAppBusinessNumber[];
  /** The sender for a conversation nobody has started yet. */
  readonly defaultPhoneNumberId: string | null;
  /**
   * Catalogue templates approved in this deployment's WhatsApp Business
   * Account, or null for "every template in the catalogue". A sandbox number
   * has none of the production templates, so staging narrows this.
   */
  readonly enabledTemplateNames: readonly string[] | null;
  /**
   * False when the numbers are configured but this runtime holds no access
   * token. Reads still work; a send is refused before anything is written.
   */
  readonly sendingAvailable: boolean;
};

export type WhatsAppTextMessage = {
  readonly fromPhoneNumberId: string;
  /** E.164, with the leading "+". */
  readonly to: string;
  readonly body: string;
};

export type WhatsAppTemplateMessage = {
  readonly fromPhoneNumberId: string;
  readonly to: string;
  readonly templateName: string;
  readonly language: string;
  /** Body variables in order: {{1}}, {{2}}, … */
  readonly bodyParameters: readonly string[];
};

export type WhatsAppSendReceipt = {
  /** Meta's wamid for the accepted message. */
  readonly providerMessageId: string;
};

export type WhatsAppPort = {
  readonly channel: WhatsAppChannel;
  readonly sendText: (
    message: WhatsAppTextMessage,
  ) => Promise<WhatsAppSendReceipt>;
  readonly sendTemplate: (
    message: WhatsAppTemplateMessage,
  ) => Promise<WhatsAppSendReceipt>;
};

/**
 * Why a send did not produce a receipt.
 *
 * - `not_sent`: the provider answered and refused, or was never reached. The
 *   customer received nothing, so the same intent may be tried again.
 * - `ambiguous`: the request may have been accepted — a timeout, a dropped
 *   connection, a 5xx. Retrying could put a second message on the customer's
 *   phone, so it waits for a person.
 *
 * The distinction is the adapter's to make, because only it knows whether a
 * byte reached Meta. The domain acts on it.
 */
export type WhatsAppSendOutcome = "not_sent" | "ambiguous";

export class WhatsAppSendError extends Error {
  constructor(
    /** Operator-readable. Never carries the token, the body or a stack. */
    message: string,
    readonly outcome: WhatsAppSendOutcome,
    readonly details: {
      /** Meta's error code, when it gave one. */
      readonly code?: string;
      readonly title?: string;
      /** True when the provider could not be reached at all. */
      readonly unreachable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

export function isWhatsAppSendError(
  error: unknown,
): error is WhatsAppSendError {
  return error instanceof WhatsAppSendError;
}
