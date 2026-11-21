import type { TransactionalDomainDb } from "@/lib/domain/db";
import { isDomainError } from "@/lib/domain/errors";
import { recordWhatsAppDeliveryStatus } from "@/lib/domain/leads/whatsapp/status";
import { systemPrincipal } from "@/lib/domain/principal";
import { applyWhatsAppGroupEvent } from "@/lib/domain/projects/whatsapp/group-events";
import { recordInboundProjectWhatsAppMessage } from "@/lib/domain/projects/whatsapp/inbound";
import { readBoundedBody } from "@/lib/http/bounded-body";
import {
  createFixedWindowRateLimiter,
  requestAddress,
} from "@/lib/http/rate-limit";

import type { WhatsAppBridgeConfig } from "./config";
import { parseBridgeEvent } from "./webhook-payload";
import { verifyBridgeSignature } from "./webhook-signature";

// The public endpoint the WhatsApp bridge POSTs its events to, as plain
// functions so a test can drive it with a fake database. The route
// (app/api/whatsapp-bridge/webhook) is a thin shell around this.
//
// The contract with the bridge (docs/whatsapp-bridge.md):
//
//   - Every POST is one event, signed (webhook-signature.ts). Verified over
//     the raw bytes before anything is parsed.
//   - 200 means "durably recorded, or deliberately ignored". The bridge then
//     deletes the event.
//   - 400 means "this event will never be acceptable" (it does not parse).
//     The bridge moves it to its dead letters rather than retry it.
//   - 401 and any 5xx mean "try again": a secret being rotated, a database
//     outage, a bug. The bridge keeps the event and backs off; every write is
//     keyed on WhatsApp's own id, so a repeat is harmless.
//
// Logs carry ids, counts and outcomes — never a message, a name or a number.

export const WHATSAPP_BRIDGE_WEBHOOK_PRINCIPAL = systemPrincipal(
  "whatsapp-bridge-webhook",
);

/** One event per request; a burst after an outage is the bridge draining its queue. */
export const BRIDGE_WEBHOOK_REQUEST_LIMIT = 1200;
export const BRIDGE_WEBHOOK_WINDOW_MS = 60 * 1000;
/** An event carries a message's text and a file's description, never the file. */
export const BRIDGE_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

const limiter = createFixedWindowRateLimiter({
  limit: BRIDGE_WEBHOOK_REQUEST_LIMIT,
  windowMs: BRIDGE_WEBHOOK_WINDOW_MS,
});

export type WhatsAppBridgeWebhookDeps = {
  readonly config: WhatsAppBridgeConfig;
  readonly db: TransactionalDomainDb;
  readonly allow?: (key: string) => boolean;
  readonly log?: Pick<Console, "info" | "warn" | "error">;
  readonly now?: () => number;
  /**
   * Called once the message is committed, with the file it recorded, to
   * start copying it into Blob storage. Its failure never fails the event:
   * the file is on record as PENDING and the daily sweep picks it up.
   */
  readonly onMediaRecorded?: (mediaIds: readonly string[]) => Promise<void>;
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function handleWhatsAppBridgeWebhook(
  request: Request,
  deps: WhatsAppBridgeWebhookDeps,
): Promise<Response> {
  const log = deps.log ?? console;
  const allow = deps.allow ?? ((key: string) => limiter.allow(key));
  if (!allow(requestAddress(request))) {
    return new Response("Too many requests", {
      headers: { "Retry-After": "60" },
      status: 429,
    });
  }

  const { config } = deps;
  if (!config.webhookSecret) {
    // Fail closed, and say "try again": 200 would drop the event for good,
    // and 400 would dead-letter it, when the fix is a missing env var.
    log.error(
      "[whatsapp-bridge-webhook] WHATSAPP_BRIDGE_WEBHOOK_SECRET is not set; refusing. Group messages are queued on the bridge until it is.",
    );
    return json(401, { error: "unauthorized" });
  }

  const bytes = await readBoundedBody(request, BRIDGE_WEBHOOK_MAX_BODY_BYTES);
  if (!bytes) return json(413, { error: "payload too large" });
  if (
    !verifyBridgeSignature(
      request.headers,
      bytes,
      config.webhookSecret,
      deps.now?.(),
    )
  ) {
    return json(401, { error: "unauthorized" });
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const parsed = parseBridgeEvent(body);
  if (!parsed.ok) {
    log.warn(
      `[whatsapp-bridge-webhook] Malformed event refused: ${parsed.error}.`,
    );
    return json(400, { error: parsed.error });
  }
  const { event, id } = parsed;

  try {
    switch (event.kind) {
      case "message": {
        const result = await recordInboundProjectWhatsAppMessage(
          WHATSAPP_BRIDGE_WEBHOOK_PRINCIPAL,
          event.message,
          deps.db,
        );
        if (result.outcome === "group_pending") {
          // The group is still being saved. Not recorded yet: "try again"
          // keeps the event on the bridge, which redelivers in seconds.
          return new Response(JSON.stringify({ outcome: "group_pending" }), {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json",
              "Retry-After": "5",
            },
            status: 503,
          });
        }
        if (result.outcome === "project_mismatch") {
          log.warn(
            `[whatsapp-bridge-webhook] Message ${event.message.providerMessageId} was queued for another project than its group's link now; not filed.`,
          );
        }
        if (result.outcome === "before_link") {
          log.info(
            `[whatsapp-bridge-webhook] Message ${event.message.providerMessageId} predates the group's link; not imported.`,
          );
        }
        if (result.outcome === "unknown_group") {
          // The bridge forwards only mapped groups, so the two disagree. Not
          // retried — it would hold up every event behind it — and the next
          // resync (daily, or Admin › WhatsApp bridge) corrects the bridge.
          log.warn(
            `[whatsapp-bridge-webhook] Message ${event.message.providerMessageId} is for a group no project has linked; not recorded. Resync the bridge's groups.`,
          );
        }
        if (result.outcome === "attached" && result.mediaId) {
          try {
            await deps.onMediaRecorded?.([result.mediaId]);
          } catch (error) {
            log.warn(
              "[whatsapp-bridge-webhook] Could not start copying a file; the daily sweep will.",
              error,
            );
          }
        }
        log.info(`[whatsapp-bridge-webhook] ${id}: message ${result.outcome}.`);
        return json(200, { outcome: result.outcome });
      }
      case "status": {
        const result = await recordWhatsAppDeliveryStatus(
          WHATSAPP_BRIDGE_WEBHOOK_PRINCIPAL,
          event.status,
          deps.db,
        );
        return json(200, { outcome: result.outcome });
      }
      case "group": {
        const result = await applyWhatsAppGroupEvent(
          WHATSAPP_BRIDGE_WEBHOOK_PRINCIPAL,
          event.event,
          deps.db,
        );
        if (result.outcome === "removed") {
          // The office needs to know: the group no longer reaches the app.
          log.error(
            `[whatsapp-bridge-webhook] Royal's number was removed from a linked group (${event.event.groupJid}); the project's group is no longer live.`,
          );
        }
        return json(200, { outcome: result.outcome });
      }
      case "session":
        if (event.status === "logged_out") {
          // Nobody watches logs here: this reaches Sentry and the office
          // inbox, which is the only way anyone learns group messages stopped.
          log.error(
            `[whatsapp-bridge-webhook] The WhatsApp bridge is logged out (${event.reason ?? "no reason given"}). Project group messages stop until someone scans the QR code in Admin › WhatsApp bridge.`,
          );
        } else {
          log.info(
            `[whatsapp-bridge-webhook] Bridge session is ${event.status}.`,
          );
        }
        return json(200, { outcome: "noted" });
      case "ignored":
        log.info(`[whatsapp-bridge-webhook] ${id} ignored: ${event.reason}.`);
        return json(200, { outcome: "ignored" });
    }
  } catch (error) {
    // A domain refusal here is a bug — this is the system principal every
    // inbound command is written for — and must not look like success.
    log.error(
      isDomainError(error)
        ? `[whatsapp-bridge-webhook] Domain refused a verified event (${error.code}); answering 500 so the bridge retries.`
        : "[whatsapp-bridge-webhook] Could not record a verified event; answering 500 so the bridge retries.",
      isDomainError(error) ? undefined : error,
    );
    return json(500, { error: "not recorded" });
  }
}
