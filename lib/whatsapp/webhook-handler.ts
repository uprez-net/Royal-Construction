import type { TransactionalDomainDb } from "@/lib/domain/db";
import { isDomainError } from "@/lib/domain/errors";
import {
  recordInboundLeadWhatsAppMessage,
  type InboundWhatsAppOutcome,
} from "@/lib/domain/leads/whatsapp/inbound";
import {
  recordWhatsAppDeliveryStatus,
  type WhatsAppStatusOutcome,
} from "@/lib/domain/leads/whatsapp/status";
import {
  applyWhatsAppGroupEvent,
  type WhatsAppGroupEventOutcome,
} from "@/lib/domain/projects/whatsapp/groups";
import {
  recordInboundProjectWhatsAppMessage,
  type InboundProjectWhatsAppOutcome,
} from "@/lib/domain/projects/whatsapp/inbound";
import { systemPrincipal } from "@/lib/domain/principal";
import { recordWhatsAppCallPermissionReply } from "@/lib/domain/leads/whatsapp/call-permissions";
import {
  recordWhatsAppCallEvent,
  type WhatsAppCallEventOutcome,
} from "@/lib/domain/leads/whatsapp/calls";
import { readBoundedBody } from "@/lib/http/bounded-body";
import {
  createFixedWindowRateLimiter,
  requestAddress,
} from "@/lib/http/rate-limit";
import { constantTimeSecretMatches } from "@/lib/http/secret-compare";

import type { WhatsAppConfig } from "./config";
import { parseWhatsAppWebhook } from "./webhook-payload";
import { verifyWhatsAppSignature } from "./webhook-signature";

// The public WhatsApp webhook, as plain functions (issue #333).
//
// app/api/whatsapp/webhook/route.ts is a two-line shell around these so they
// can be driven by a test with a fake database: this endpoint is on the open
// internet and writes customer messages onto leads, which is exactly the kind
// of code that should not be trusted untested.
//
// The contract with Meta:
//
//   - GET is the subscription handshake: echo `hub.challenge` when
//     `hub.verify_token` matches, 403 otherwise.
//   - POST is signed with the app secret over the raw body. Verified before
//     parsing; an unsigned or mis-signed request never reaches the database.
//   - 200 means "durably recorded". Every event is written, and deduplicated,
//     before the answer goes back. Anything else — a database outage, a bug —
//     answers 500 so Meta retries (for up to seven days). A retry is harmless
//     because every event is keyed on Meta's own id.
//
// Logs carry counts, outcomes and codes. Never a body, a name, a phone number
// or a secret.

export const WHATSAPP_WEBHOOK_PRINCIPAL = systemPrincipal("whatsapp-webhook");

/** Meta batches, so the brake is generous; the signature is the access control. */
export const WHATSAPP_WEBHOOK_REQUEST_LIMIT = 600;
export const WHATSAPP_WEBHOOK_WINDOW_MS = 60 * 1000;
/** A text-only delivery is a few KB; anything near this is not Meta. */
export const WHATSAPP_WEBHOOK_MAX_BODY_BYTES = 1_000_000;

const limiter = createFixedWindowRateLimiter({
  limit: WHATSAPP_WEBHOOK_REQUEST_LIMIT,
  windowMs: WHATSAPP_WEBHOOK_WINDOW_MS,
});

export type WhatsAppWebhookDeps = {
  readonly config: WhatsAppConfig;
  readonly db: TransactionalDomainDb;
  /** Injectable for tests; defaults to the module-scope limiter. */
  readonly allow?: (key: string) => boolean;
  readonly log?: Pick<Console, "info" | "warn" | "error">;
  /**
   * Called once the delivery is committed, with the attachments it recorded,
   * to start copying them into Blob storage. Its failure never fails the
   * delivery: the files are already on record as PENDING, and the daily sweep
   * (app/api/cron/whatsapp-sweep) picks up anything that was not started.
   */
  readonly onMediaRecorded?: (mediaIds: readonly string[]) => Promise<void>;
};

function text(status: number, body: string, headers: HeadersInit = {}) {
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
    status,
  });
}

export function handleWhatsAppWebhookVerification(
  request: Request,
  config: WhatsAppConfig,
): Response {
  // Off means off: an unconfigured deployment does not advertise a webhook.
  if (!config.enabled) return text(404, "Not found");
  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge");
  if (
    params.get("hub.mode") === "subscribe"
    && challenge
    && constantTimeSecretMatches(
      params.get("hub.verify_token"),
      config.verifyToken,
    )
  ) {
    return text(200, challenge);
  }
  return text(403, "Forbidden");
}

export async function handleWhatsAppWebhookDelivery(
  request: Request,
  deps: WhatsAppWebhookDeps,
): Promise<Response> {
  const log = deps.log ?? console;
  const allow = deps.allow ?? ((key: string) => limiter.allow(key));
  if (!allow(requestAddress(request))) {
    return text(429, "Too many requests", { "Retry-After": "60" });
  }

  const { config } = deps;
  if (!config.enabled) return text(404, "Not found");
  if (!config.appSecret) {
    // Fail closed. Answering 200 here would tell Meta the delivery landed and
    // it would never be retried; 401 keeps it retrying until the secret is set.
    log.warn("[whatsapp-webhook] WHATSAPP_APP_SECRET is not set; rejecting.");
    return text(401, "Unauthorized");
  }

  // The raw body, before any parse: the signature is over these exact bytes.
  // Counted as it arrives, since content-length can be missing or understated;
  // the stream is cancelled the moment it passes the cap.
  const bytes = await readBoundedBody(request, WHATSAPP_WEBHOOK_MAX_BODY_BYTES);
  if (!bytes) return text(413, "Payload too large");
  if (!verifyWhatsAppSignature(request.headers, bytes, config.appSecret)) {
    return text(401, "Unauthorized");
  }
  const raw = new TextDecoder().decode(bytes);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Signed but unparseable. 400: the same bytes will not parse next time.
    return text(400, "Invalid JSON");
  }
  const parsed = parseWhatsAppWebhook(json);
  if (!parsed) return text(400, "Not a WhatsApp Business Account webhook");

  if (
    config.businessAccountId
    && (parsed.businessAccountIds.length === 0
      || parsed.entriesWithoutAccountId > 0
      || parsed.businessAccountIds.some(
        (id) => id !== config.businessAccountId,
      ))
  ) {
    // Signed with our app secret but for another WhatsApp Business Account,
    // or not saying which: every entry must name ours. A misconfigured
    // subscription. Refused (not dropped with a 200) so Meta
    // keeps retrying while somebody fixes it — see docs/whatsapp-runbook.md.
    log.warn(
      "[whatsapp-webhook] Delivery not (or not only) for WHATSAPP_BUSINESS_ACCOUNT_ID; rejecting.",
    );
    return text(403, "Unexpected business account");
  }

  const inbound: Record<InboundWhatsAppOutcome["outcome"], number> = {
    attached: 0,
    duplicate: 0,
    unmatched: 0,
  };
  const group: Record<InboundProjectWhatsAppOutcome["outcome"], number> = {
    attached: 0,
    duplicate: 0,
    unlinked: 0,
  };
  const groupEvents: Record<WhatsAppGroupEventOutcome, number> = {
    applied: 0,
    unknown_group: 0,
  };
  const mediaIds: string[] = [];
  const calls: Record<WhatsAppCallEventOutcome, number> = {
    applied: 0,
    duplicate: 0,
    ringing: 0,
    unknown_call: 0,
  };
  let permissionReplies = 0;
  const statuses: Record<WhatsAppStatusOutcome, number> = {
    applied: 0,
    awaiting_message: 0,
    duplicate: 0,
    stale: 0,
  };

  try {
    // Sequentially: a delivery is small, and ordering keeps a message and its
    // own statuses in the order Meta sent them.
    for (const message of parsed.messages) {
      if (message.groupId) {
        // A group message is a project's, whatever number posted it.
        const result = await recordInboundProjectWhatsAppMessage(
          WHATSAPP_WEBHOOK_PRINCIPAL,
          message,
          deps.db,
        );
        group[result.outcome] += 1;
        if (result.outcome !== "duplicate" && result.mediaId) {
          mediaIds.push(result.mediaId);
        }
        continue;
      }
      const result = await recordInboundLeadWhatsAppMessage(
        WHATSAPP_WEBHOOK_PRINCIPAL,
        message,
        deps.db,
        { channel: config.channel },
      );
      inbound[result.outcome] += 1;
      if (result.outcome !== "duplicate" && result.mediaId) {
        mediaIds.push(result.mediaId);
      }
      if (result.outcome === "unmatched") {
        log.info(
          `[whatsapp-webhook] ${message.providerMessageId} held for review (${result.reason}).`,
        );
      }
    }
    for (const update of parsed.statuses) {
      const result = await recordWhatsAppDeliveryStatus(
        WHATSAPP_WEBHOOK_PRINCIPAL,
        update,
        deps.db,
      );
      statuses[result.outcome] += 1;
      if (update.status === "FAILED") {
        log.info(
          `[whatsapp-webhook] ${update.providerMessageId} failed (code ${update.errorCode ?? "none"}).`,
        );
      }
    }
    // Calls first among the rest: a ringing customer is the one thing here a
    // person is waiting on.
    for (const event of parsed.callEvents) {
      const outcome = await recordWhatsAppCallEvent(
        WHATSAPP_WEBHOOK_PRINCIPAL,
        event,
        deps.db,
        { channel: config.channel },
      );
      calls[outcome] += 1;
    }
    for (const reply of parsed.callPermissionReplies) {
      await recordWhatsAppCallPermissionReply(
        WHATSAPP_WEBHOOK_PRINCIPAL,
        reply,
        deps.db,
      );
      permissionReplies += 1;
    }
    for (const event of parsed.groupEvents) {
      const result = await applyWhatsAppGroupEvent(
        WHATSAPP_WEBHOOK_PRINCIPAL,
        event,
        deps.db,
      );
      groupEvents[result.outcome] += 1;
    }
  } catch (error) {
    // A domain refusal here is a bug — the webhook is the system principal
    // every inbound command is written for — and it must not look like
    // success. 500 keeps Meta retrying; the dedupe makes that harmless.
    log.error(
      isDomainError(error)
        ? `[whatsapp-webhook] Domain refused a verified delivery (${error.code}); answering 500 so Meta retries.`
        : "[whatsapp-webhook] Could not record a verified delivery; answering 500 so Meta retries.",
      isDomainError(error) ? undefined : error,
    );
    return text(500, "Not recorded");
  }

  if (mediaIds.length > 0 && deps.onMediaRecorded) {
    try {
      await deps.onMediaRecorded(mediaIds);
    } catch (error) {
      log.warn(
        `[whatsapp-webhook] Could not start copying ${mediaIds.length} file(s); the daily sweep will.`,
        error,
      );
    }
  }

  log.info(
    `[whatsapp-webhook] messages ${JSON.stringify(inbound)}; group messages ${JSON.stringify(group)}; group events ${JSON.stringify(groupEvents)}; media ${mediaIds.length}; statuses ${JSON.stringify(statuses)}; calls ${JSON.stringify(calls)}; call permission replies ${permissionReplies}${
      parsed.ignored.length
        ? `; ignored ${parsed.ignored.length}: ${parsed.ignored.join("; ")}`
        : ""
    }`,
  );
  return text(200, "OK");
}
