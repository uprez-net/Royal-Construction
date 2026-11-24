import { waitUntil } from "@vercel/functions";
import type { WebSocket } from "ws";

import { checkpointAgentTranscript } from "@/lib/domain/comms/calls/agent-transcript";
import { applyCallEvent } from "@/lib/domain/comms/calls/events";
import { formatVoiceAgentTranscript } from "@/lib/domain/comms/calls/voice-agent";
import type { TransactionalDomainDb } from "@/lib/domain/db";
import { CommsError, type CommsProviderName } from "@/lib/domain/ports/comms";

import type { CommsRuntime } from "../factory";
import { providerFromPath } from "../factory";
import { COMMS_WEBHOOK_PRINCIPAL } from "../webhook-handler";
import { voiceCallerPreparer } from "./caller";
import { decideCallMove } from "./desk";
import { openLiveSession } from "./live";
import { VoiceAgentSession, type VoiceAgentReportBody } from "./session";
import { voiceAgentVoice } from "./settings";

// GET /api/comms/voice-agent/<provider>: where Twilio and Telnyx open the
// WebSocket that carries an answered inbound call's audio to Mili.
//
// Public — the carrier has no session — and safe because a session only
// starts for a token the app signed for that one call (token.ts). The whole
// conversation runs inside this one request: the platform upgrades it to a
// WebSocket and keeps the function alive until the session settles, which is
// why VOICE_AGENT_MAX_SECONDS sits inside the route's maxDuration.
//
// Who is calling, and what Mili may tell them, is the domain's
// (lib/domain/comms/callers, wired in caller.ts). This route's own principal
// is never the caller's authority: the carrier-webhook principal below only
// records how the conversation ended.
//
// When the conversation ends, the outcome and transcript go through the same
// domain command as a carrier callback (`call.agentEnded`), and the carrier's
// adapter issues whatever the call router decides next on the live call.

export type VoiceAgentStreamDeps = {
  readonly runtime: CommsRuntime;
  readonly db: TransactionalDomainDb;
  /** Upgrade the request; resolves once the handler has finished. */
  readonly upgrade: (
    handler: (ws: WebSocket) => Promise<void>,
  ) => Promise<Response>;
  /** Swapped in tests. */
  readonly openModel?: typeof openLiveSession;
  readonly decide?: typeof decideCallMove;
  readonly log?: Pick<Console, "info" | "warn" | "error">;
  readonly env?: Record<string, string | undefined>;
  /**
   * Keeps the function alive until the promise settles. The platform freezes
   * the instance as soon as the carrier closes the socket — the caller hanging
   * up — and the outcome and transcript are written after that. Without this
   * the write ran when some later request thawed the instance, 12–17 minutes
   * on, on a dead database connection, and the transcript was lost (#605).
   */
  readonly keepAlive?: (promise: Promise<unknown>) => void;
};

function text(status: number, body: string) {
  return new Response(body, {
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
    status,
  });
}

/** Mili is done: record what was said and move the live call on. */
export async function recordVoiceAgentOutcome(
  deps: Pick<VoiceAgentStreamDeps, "runtime" | "db" | "log">,
  report: VoiceAgentReportBody,
): Promise<void> {
  const log = deps.log ?? console;
  const outcome = await applyCallEvent(
    COMMS_WEBHOOK_PRINCIPAL,
    {
      callId: report.callId,
      outcome: report.outcome,
      providerCallId: report.callControlId,
      transcript: formatVoiceAgentTranscript(report.turns),
      type: "call.agentEnded",
    },
    deps.db,
    { channel: deps.runtime.channel, provider: report.provider },
  );
  if (!outcome.instructions?.length) {
    log.info(`[voice-agent] ${report.outcome}: ${outcome.outcome}.`);
    return;
  }
  try {
    await deps.runtime
      .adapterFor(report.provider)
      .updateLiveCall(
        report.callControlId,
        outcome.callId,
        outcome.instructions,
      );
    log.info(`[voice-agent] ${report.outcome}: next steps issued.`);
  } catch (error) {
    // The decision is recorded; only the carrier refused the next step. The
    // stale-call sweep settles a call left hanging.
    log.error(
      `[voice-agent] ${report.provider}: the next step after Mili could not be issued (${
        error instanceof CommsError ? error.providerCode : "error"
      }).`,
    );
  }
}

export async function handleVoiceAgentStream(
  request: Request,
  params: { readonly provider: string },
  deps: VoiceAgentStreamDeps,
): Promise<Response> {
  const log = deps.log ?? console;
  const provider: CommsProviderName | null = providerFromPath(params.provider);
  const { config } = deps.runtime;
  const secret = config.voiceAgent.secret;
  if (!provider || !config.voiceAgent.enabled || !secret) {
    return text(404, "Not found");
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return text(426, "Upgrade required");
  }
  const urlToken = new URL(request.url).searchParams.get("token");
  const open = deps.openModel ?? openLiveSession;

  const run = async (ws: WebSocket) => {
    const session: VoiceAgentSession = new VoiceAgentSession({
      carrier: {
        close: () => {
          if (ws.readyState === ws.OPEN) ws.close(1000);
        },
        send: (frame) => {
          if (ws.readyState === ws.OPEN) ws.send(frame);
        },
      },
      decide: deps.decide ?? decideCallMove,
      dialect: provider,
      log,
      prepare: voiceCallerPreparer({
        db: deps.db,
        disclosure: config.voiceAgent.disclosure,
      }),
      openModel: () =>
        open(
          (event) => session.handleModelEvent(event),
          () => session.handleModelClosed(),
          log,
        ),
      report: (report) => recordVoiceAgentOutcome(deps, report),
      checkpoint: async (progress) => {
        const transcript = formatVoiceAgentTranscript(progress.turns);
        if (!transcript) return;
        await checkpointAgentTranscript(
          COMMS_WEBHOOK_PRINCIPAL,
          {
            callId: progress.callId,
            provider: progress.provider,
            providerCallId: progress.callControlId,
            transcript,
          },
          deps.db,
        );
      },
      secret,
      urlToken,
      voice: voiceAgentVoice(deps.env),
    });
    ws.on("message", (data, isBinary) => {
      if (!isBinary) session.handleCarrierText(data.toString());
    });
    ws.on("close", () => session.handleCarrierClosed());
    ws.on("error", (error) =>
      log.warn(`[voice-agent] ${provider} socket error:`, error.message),
    );
    // The function stays alive until the conversation is over and reported,
    // even once the carrier has closed the socket (see `keepAlive`).
    (deps.keepAlive ?? waitUntil)(session.done);
    await session.done;
  };

  try {
    return await deps.upgrade(run);
  } catch (error) {
    // Not a runtime that can upgrade (`next dev`), or the socket dropped
    // during the handshake. The carrier reports the stream as failed and the
    // caller goes to a person.
    log.error(
      "[voice-agent] could not open the call's audio stream.",
      error instanceof Error ? error.message : error,
    );
    return text(503, "Voice agent unavailable");
  }
}
