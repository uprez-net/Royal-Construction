import {
  WhatsAppSendError,
  type WhatsAppPort,
  type WhatsAppSendReceipt,
} from "@/lib/domain/ports/whatsapp";

import { readWhatsAppConfig, type WhatsAppConfig } from "./config";
import { describeWhatsAppError } from "./errors";

// The Meta WhatsApp Cloud API behind `WhatsAppPort` (issue #333).
//
// Plain `fetch` — no SDK, no `server-only`, nothing Node's ESM loader cannot
// load — because Eve builds this into its own bundle and the App calls it from
// route handlers. Both construct it with `createWhatsAppPortFromEnv()`.
//
// The one judgement this module makes is whether a failure means "nothing was
// sent" or "it might have been". Meta has no idempotency key for sends, so an
// ambiguous failure cannot be safely retried; the domain holds it for a person
// (lib/domain/leads/whatsapp/send.ts). Logs carry codes and trace ids, never a
// token, a body or a customer's number.

const SEND_TIMEOUT_MS = 15_000;

/** Network failures that happen before a request can reach Meta at all. */
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

type Fetch = typeof fetch;

type MetaErrorBody = {
  error?: {
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
    fbtrace_id?: string;
  };
};

type MetaSendBody = {
  messages?: { id?: string }[];
};

function causeCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

async function post(
  config: Pick<WhatsAppConfig, "accessToken" | "apiVersion">,
  phoneNumberId: string,
  payload: Record<string, unknown>,
  fetchImpl: Fetch,
): Promise<WhatsAppSendReceipt> {
  if (!config.accessToken) {
    throw new WhatsAppSendError(
      "WhatsApp sending isn't configured in this runtime.",
      "not_sent",
      { unreachable: true },
    );
  }
  const url = `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...payload,
      }),
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    const code = causeCode(error);
    if (code && UNREACHABLE_CODES.has(code)) {
      console.warn(`[whatsapp] Meta unreachable before send (${code}).`);
      throw new WhatsAppSendError(
        "WhatsApp couldn't be reached from this server, so nothing was sent.",
        "not_sent",
        { code: code, unreachable: true },
      );
    }
    // A timeout or a reset after the request left: Meta may have accepted it.
    console.warn(
      `[whatsapp] Send outcome unknown (${code ?? (error as Error)?.name ?? "error"}).`,
    );
    throw new WhatsAppSendError(
      "WhatsApp didn't answer in time; the message may or may not have been sent.",
      "ambiguous",
      { code: code ?? undefined },
    );
  }

  const text = await response.text().catch(() => "");
  let body: (MetaSendBody & MetaErrorBody) | null = null;
  try {
    body = text ? (JSON.parse(text) as MetaSendBody & MetaErrorBody) : null;
  } catch {
    body = null;
  }

  if (response.ok) {
    const id = body?.messages?.[0]?.id;
    if (id) return { providerMessageId: id };
    console.warn(
      `[whatsapp] Meta answered ${response.status} without a message id.`,
    );
    throw new WhatsAppSendError(
      "WhatsApp accepted the request but returned no message id; it may or may not have been sent.",
      "ambiguous",
    );
  }

  const code = body?.error?.code;
  console.warn(
    `[whatsapp] Meta refused a send: HTTP ${response.status}, code ${code ?? "none"}, trace ${body?.error?.fbtrace_id ?? "none"}.`,
  );
  // 5xx: Meta's side failed mid-request, and may have queued the message.
  if (response.status >= 500) {
    throw new WhatsAppSendError(
      "WhatsApp had a server error; the message may or may not have been sent.",
      "ambiguous",
      { code: code !== undefined ? String(code) : undefined },
    );
  }
  // 4xx: validated and refused before acceptance. Nothing reached the customer.
  throw new WhatsAppSendError(
    describeWhatsAppError(code, body?.error?.title ?? body?.error?.message),
    "not_sent",
    {
      code: code !== undefined ? String(code) : undefined,
      title: body?.error?.title ?? undefined,
    },
  );
}

/** A port over the Cloud API for this configuration. */
export function createCloudApiWhatsAppPort(
  config: WhatsAppConfig,
  fetchImpl: Fetch = fetch,
): WhatsAppPort | null {
  if (!config.enabled || !config.channel) return null;
  return {
    channel: config.channel,
    sendTemplate: (message) =>
      post(
        config,
        message.fromPhoneNumberId,
        {
          template: {
            components: message.bodyParameters.length
              ? [
                  {
                    parameters: message.bodyParameters.map((text) => ({
                      text,
                      type: "text",
                    })),
                    type: "body",
                  },
                ]
              : [],
            language: { code: message.language },
            name: message.templateName,
          },
          to: message.to,
          type: "template",
        },
        fetchImpl,
      ),
    sendText: (message) =>
      post(
        config,
        message.fromPhoneNumberId,
        {
          text: { body: message.body, preview_url: false },
          to: message.to,
          type: "text",
        },
        fetchImpl,
      ),
  };
}

/**
 * The production port, or null when WhatsApp is off in this runtime.
 *
 * Null — WhatsApp disabled, no business number, or no access token in this
 * runtime — is an answer the domain handles: a send is refused with "provider
 * unavailable" before anything is written, and reads still show the channel
 * from `whatsappChannelFromEnv()` with `sendingAvailable: false`.
 */
export function createWhatsAppPortFromEnv(
  env: Record<string, string | undefined> = process.env,
): WhatsAppPort | null {
  const config = readWhatsAppConfig(env);
  if (!config.channel?.sendingAvailable) return null;
  return createCloudApiWhatsAppPort(config);
}
