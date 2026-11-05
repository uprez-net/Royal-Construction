import { applyCallEvent } from "@/lib/domain/comms/calls/events";
import { providerColumn } from "@/lib/domain/comms/shared";
import { recordInboundSms } from "@/lib/domain/comms/sms/inbound";
import { recordSmsDeliveryStatus } from "@/lib/domain/comms/sms/status";
import type { TransactionalDomainDb } from "@/lib/domain/db";
import { isDomainError } from "@/lib/domain/errors";
import type { CallInstruction, CommsEvent } from "@/lib/domain/ports/comms";
import { systemPrincipal } from "@/lib/domain/principal";
import {
  createFixedWindowRateLimiter,
  requestAddress,
} from "@/lib/http/rate-limit";

import { signedUrlFor } from "./callbacks";
import { providerFromPath, type CommsRuntime } from "./factory";
import type { RespondContext, WebhookRequest } from "./types";

// Every carrier callback, as plain functions (file 06 §6).
//
// app/api/comms/[provider]/[event]/route.ts is a shell around this so it can
// be driven by a test with a fake database: these URLs are on the open
// internet and write onto leads and calls.
//
//   1. Route by the provider in the path. Unknown → 404.
//   2. Read the raw body once, capped at 64 KB.
//   3. Verify the signature over the exact URL and bytes. Failure → 403 with
//      no database access.
//   4. Parse into neutral events. Not a shape we know → 400.
//   5. Skip an event delivery already processed (CommsWebhookEvent).
//   6. Apply through the domain. A failure → 500 so the carrier retries.
//   7. Answer: call XML for a markup provider, commands then 200 for a
//      command provider.
//
// Logs carry outcomes and codes, never a body, a number or a secret.

export const COMMS_WEBHOOK_PRINCIPAL = systemPrincipal("comms-webhook");
export const COMMS_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

const limiter = createFixedWindowRateLimiter({ limit: 600, windowMs: 60_000 });

const NOT_IN_SERVICE: readonly CallInstruction[] = [
  {
    op: "say",
    text: "Sorry, this number can't take calls right now. Please send us a text or an email instead.",
  },
  { op: "hangup" },
];

export type CommsWebhookDeps = {
  readonly runtime: CommsRuntime;
  readonly db: TransactionalDomainDb;
  readonly allow?: (key: string) => boolean;
  readonly log?: Pick<Console, "info" | "warn" | "error">;
  readonly now?: () => Date;
  /** Start copying newly recorded recordings into storage, after commit. */
  readonly onRecordingRecorded?: (
    recordingIds: readonly string[],
  ) => Promise<void>;
};

function text(status: number, body: string) {
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
    status,
  });
}

function eventCallIds(event: CommsEvent): {
  callId: string | null;
  providerCallId: string | null;
} {
  if (event.type === "sms.received" || event.type === "sms.status") {
    return { callId: null, providerCallId: null };
  }
  return {
    callId: "callId" in event ? event.callId : null,
    providerCallId: event.providerCallId || null,
  };
}

export async function handleCommsWebhook(
  request: Request,
  params: { readonly provider: string; readonly event: string },
  deps: CommsWebhookDeps,
): Promise<Response> {
  const log = deps.log ?? console;
  const now = deps.now?.() ?? new Date();
  const provider = providerFromPath(params.provider);
  const { config, channel } = deps.runtime;
  if (!provider || (!config.smsEnabled && !config.callsEnabled))
    return text(404, "Not found");
  const adapter = deps.runtime.adapterFor(provider);
  if (!adapter.webhookEvents.has(params.event)) return text(404, "Not found");

  const allow = deps.allow ?? ((key: string) => limiter.allow(key));
  if (!allow(requestAddress(request))) return text(429, "Too many requests");

  if (!config.webhookOrigin) {
    // Fail closed: without the origin the signed URL cannot be rebuilt, and
    // "we could not check" is never "accept".
    log.warn("[comms-webhook] COMMS_WEBHOOK_ORIGIN is not set; rejecting.");
    return text(401, "Unauthorized");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > COMMS_WEBHOOK_MAX_BODY_BYTES)
    return text(413, "Payload too large");
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > COMMS_WEBHOOK_MAX_BODY_BYTES) {
    return text(413, "Payload too large");
  }

  const webhook: WebhookRequest = {
    event: params.event,
    headers: request.headers,
    now,
    query: new URL(request.url).searchParams,
    rawBody,
    signedUrl: signedUrlFor(config.webhookOrigin, request.url),
  };
  if (!adapter.verifyWebhook(webhook)) {
    log.warn(
      `[comms-webhook] ${provider}/${params.event}: signature rejected.`,
    );
    return text(403, "Forbidden");
  }
  const parsed = adapter.parseWebhook(webhook);
  if (!parsed) return text(400, "Unrecognised callback");

  const dedupe = parsed.dedupeKey
    ? { dedupeKey: parsed.dedupeKey, provider: providerColumn(provider) }
    : null;
  if (dedupe) {
    const seen = await deps.db.commsWebhookEvent.findUnique({
      select: { processedAt: true },
      where: { provider_dedupeKey: dedupe },
    });
    if (seen?.processedAt)
      return adapter.respond(null, {
        callId: null,
        providerCallId: null,
        trigger: null,
      });
  }

  let instructions: readonly CallInstruction[] | null = null;
  const respondContext: {
    -readonly [K in keyof RespondContext]: RespondContext[K];
  } = {
    callId: parsed.pending?.callId ?? null,
    providerCallId: parsed.pending?.providerCallId ?? null,
    trigger: parsed.pending ? "continuation" : null,
  };
  const recordingIds: string[] = [];
  const outcomes: string[] = [];

  try {
    if (dedupe) {
      await deps.db.commsWebhookEvent.upsert({
        create: { ...dedupe, kind: params.event },
        update: {},
        where: { provider_dedupeKey: dedupe },
      });
    }
    for (const event of parsed.events) {
      switch (event.type) {
        case "sms.received": {
          const result = await recordInboundSms(
            COMMS_WEBHOOK_PRINCIPAL,
            { ...event, provider },
            deps.db,
            { channel },
          );
          outcomes.push(`sms.received:${result.outcome}`);
          break;
        }
        case "sms.status": {
          const result = await recordSmsDeliveryStatus(
            COMMS_WEBHOOK_PRINCIPAL,
            { ...event, provider },
            deps.db,
          );
          outcomes.push(`sms.status:${result}`);
          break;
        }
        default: {
          if (event.type === "call.incoming" && !config.callsEnabled) {
            instructions = NOT_IN_SERVICE;
            Object.assign(respondContext, {
              providerCallId: event.providerCallId,
              trigger: "call.incoming",
            });
            outcomes.push("call.incoming:not_in_service");
            break;
          }
          const result = await applyCallEvent(
            COMMS_WEBHOOK_PRINCIPAL,
            event,
            deps.db,
            {
              channel,
              now,
              provider,
            },
          );
          outcomes.push(`${event.type}:${result.outcome}`);
          const ids = eventCallIds(event);
          if (result.instructions) {
            instructions = result.instructions;
            Object.assign(respondContext, {
              callId: result.callId ?? ids.callId,
              providerCallId:
                ids.providerCallId ?? respondContext.providerCallId,
              trigger: event.type,
            });
          } else if (!respondContext.providerCallId) {
            Object.assign(respondContext, {
              callId: result.callId ?? ids.callId,
              providerCallId: ids.providerCallId,
            });
          }
          if (result.recordingId) recordingIds.push(result.recordingId);
        }
      }
    }
    if (dedupe) {
      await deps.db.commsWebhookEvent.update({
        data: { processedAt: new Date() },
        where: { provider_dedupeKey: dedupe },
      });
    }
  } catch (error) {
    log.error(
      isDomainError(error)
        ? `[comms-webhook] ${provider}/${params.event}: the domain refused a verified callback (${error.code}); answering 500 so it is retried.`
        : `[comms-webhook] ${provider}/${params.event}: could not record a verified callback; answering 500 so it is retried.`,
      isDomainError(error) ? undefined : error,
    );
    return text(500, "Not recorded");
  }

  if (recordingIds.length > 0 && deps.onRecordingRecorded) {
    try {
      await deps.onRecordingRecorded(recordingIds);
    } catch (error) {
      log.warn(
        "[comms-webhook] Could not start copying a recording; the daily sweep will.",
        error,
      );
    }
  }
  if (parsed.recordAfterConnect && adapter.startCallRecording) {
    try {
      await adapter.startCallRecording(
        parsed.recordAfterConnect.providerCallId,
        parsed.recordAfterConnect.callId,
      );
    } catch {
      log.warn(
        `[comms-webhook] ${provider}: the call connected but recording could not start.`,
      );
    }
  }

  log.info(
    `[comms-webhook] ${provider}/${params.event}: ${outcomes.join(", ") || "no events"}${
      parsed.ignoredReason ? ` (ignored: ${parsed.ignoredReason})` : ""
    }`,
  );
  return adapter.respond(
    instructions ?? parsed.pending?.instructions ?? null,
    respondContext,
  );
}
