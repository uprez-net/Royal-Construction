import { after } from "next/server";

import { syncInvoiceFromXero } from "@/lib/data/invoice";
import { getXeroConfig } from "@/lib/xero/config";
import { verifyXeroSignature } from "@/lib/xero/webhook-signature";

// Processing runs after the response, but the function has to stay alive for
// it: each event costs a Xero fetch plus a write.
export const maxDuration = 60;

/** One delivery from Xero. Only `events` matters; the rest is sequencing metadata. */
type XeroWebhookPayload = {
  events?: XeroWebhookEvent[];
};

type XeroWebhookEvent = {
  resourceId?: string;
  eventCategory?: string;
  eventType?: string;
  tenantId?: string;
};

/**
 * Xero webhook receiver.
 *
 * Two hard constraints from Xero shape this handler:
 *
 * 1. **Answer within five seconds.** Xero retries, then disables a webhook that
 *    keeps timing out. Each event needs a fetch of the invoice (the payload
 *    carries no amounts, only a resource id), which is far too slow to do
 *    inline, so the signature is checked, 200 goes back, and the work happens
 *    in `after()`.
 * 2. **Intent To Receive.** Before enabling the webhook Xero posts both a
 *    correctly-signed and a deliberately mis-signed payload, and requires 200
 *    and 401 respectively. That is why an unverified request is a bare 401 —
 *    not a redirect, and not the shared error envelope with its 200-shaped
 *    body — and why an empty `events` array is a normal, successful delivery.
 */
export async function POST(request: Request): Promise<Response> {
  // The raw body, before any parse. The signature is over these exact bytes;
  // re-serialising a parsed object changes them and never matches.
  const raw = await request.text();

  const webhookSecret = getXeroConfig().webhookSecret;
  if (!webhookSecret) {
    console.warn(
      "[xero] Webhook received without XERO_WEBHOOK_SECRET configured — rejecting.",
    );
    return new Response("Unauthorized", { status: 401 });
  }

  if (!verifyXeroSignature(request.headers, raw, webhookSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: XeroWebhookPayload;
  try {
    payload = JSON.parse(raw) as XeroWebhookPayload;
  } catch {
    // Signed but unparseable. 400 rather than 500: retrying will not help.
    return new Response("Invalid JSON", { status: 400 });
  }

  // Xero fires for every invoice in the organisation and batches events, often
  // several for the same invoice in one delivery. Keep the invoice events and
  // collapse them — the handler re-reads current state from Xero, so processing
  // the same id twice in one batch would just be a wasted API call.
  const invoiceIds = [
    ...new Set(
      (payload.events ?? [])
        .filter((event) => event.eventCategory?.toUpperCase() === "INVOICE")
        .map((event) => event.resourceId)
        .filter((resourceId): resourceId is string => Boolean(resourceId)),
    ),
  ];

  if (invoiceIds.length > 0) {
    after(async () => {
      // Sequentially, not `Promise.all`: Xero rate-limits per tenant, and a
      // burst of parallel fetches is the fastest way to earn a 429 on a path
      // with no retry behind it.
      for (const invoiceId of invoiceIds) {
        try {
          await syncInvoiceFromXero(invoiceId);
        } catch (error) {
          // One bad invoice must not strand the rest of the batch. The next
          // event for it will try again.
          console.error(`[xero] Failed to sync invoice ${invoiceId}:`, error);
        }
      }
    });
  }

  return new Response("OK", { status: 200 });
}
