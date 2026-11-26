import type { Prisma } from "@prisma/client";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { agentDb } from "@/agent/lib/db";
import { HERMES_ATTRIBUTE } from "@/agent/lib/mcp-auth-policy";
import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import {
  cancelOwnerCall,
  listOwnerCalls,
  OWNER_CALL_LIMITS,
  readOwnerCall,
  requestOwnerCall,
  type OwnerCallSummary,
} from "@/lib/domain/comms/calls/owner-call";
import {
  listOwnerCallHandoffs,
  OWNER_CALL_HANDOFF_LIMITS,
  readOwnerCallHandoff,
  resolveOwnerCallHandoff,
  type OwnerCallHandoffDetail,
  type OwnerCallHandoffSummary,
} from "@/lib/domain/comms/calls/owner-call-handoff";
import { OWNER_CALL_CATEGORIES } from "@/lib/domain/comms/calls/voice-agent-owner-call";
import { isDomainError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";

// The owner-call tools for Hermes, the owner's assistant on its own server.
//
// Hermes reaches Eve through the MCP channel (agent/channels/mcp.ts) like any
// client: a Clerk OAuth token for an office user. On top of that it sends
// HERMES_MCP_SECRET, which marks its session with the `hermes` attribute
// (agent/lib/mcp-auth-policy.ts). agent/tools/owner_calls.ts offers these
// tools only to such a session, and every tool checks the mark again before
// it does anything: being offered a tool is not permission to run it.
//
// Each tool is one domain command (lib/domain/comms/calls/owner-call.ts); the
// writes go through runAuditedAgentOperation like every other agent write.

/** Who the domain sees: the Hermes channel, named in every event and audit. */
export const HERMES_PRINCIPAL = systemPrincipal("hermes");

export class NotHermesError extends Error {
  readonly code = "not_hermes";
  constructor() {
    super("Owner calls can only be scheduled by Hermes.");
    this.name = "NotHermesError";
  }
}

export function isHermesSession(ctx: {
  readonly session: Pick<ToolContext["session"], "auth">;
}): boolean {
  return ctx.session.auth.current?.attributes[HERMES_ATTRIBUTE] === "true";
}

/** The Hermes check, then the office user Hermes signed in as. */
export async function requireHermes(ctx: ToolContext) {
  if (!isHermesSession(ctx)) throw new NotHermesError();
  return requireCurrentAgentActor(ctx);
}

/** An owner call, as Hermes reads it: snake_case, lower-case status, ISO dates. */
export function ownerCallForHermes(ownerCall: OwnerCallSummary) {
  const iso = (date: Date | null) => (date ? date.toISOString() : null);
  const call = ownerCall.call;
  return {
    call: call
      ? {
          answered: call.answered,
          answered_at: iso(call.answeredAt),
          call_id: call.callId,
          duration_seconds: call.durationSeconds,
          ended_at: iso(call.endedAt),
          needs_reconciliation: call.needsReconciliation,
          problem: call.problem,
          recording_saved: call.recordings.some((r) => r.available),
          status: call.status.toLowerCase(),
          transcript: call.transcript,
        }
      : null,
    call_at: iso(ownerCall.callAt),
    canceled_at: iso(ownerCall.canceledAt),
    category: ownerCall.category,
    failure_reason: ownerCall.failureReason,
    from_handoff_id: ownerCall.fromHandoffId,
    handoff: ownerCall.handoff
      ? {
          handoff_id: ownerCall.handoff.id,
          status: ownerCall.handoff.status.toLowerCase(),
        }
      : null,
    owner_call_id: ownerCall.id,
    placed_at: iso(ownerCall.placedAt),
    questions_asked: ownerCall.questionsAsked,
    reference: ownerCall.reference,
    status: ownerCall.status.toLowerCase(),
    subject: ownerCall.subject,
    to: ownerCall.to,
  };
}

/** A post-call handoff, as Hermes reads it. */
export function handoffForHermes(
  handoff: OwnerCallHandoffSummary | OwnerCallHandoffDetail,
) {
  const iso = (date: Date | null) => (date ? date.toISOString() : null);
  return {
    attempts: handoff.attempts,
    call: handoff.call
      ? {
          answered: handoff.call.answered,
          call_id: handoff.call.callId,
          duration_seconds: handoff.call.durationSeconds,
          status: handoff.call.status.toLowerCase(),
        }
      : null,
    callback_owner_call_id: handoff.callbackOwnerCallId,
    delivered_at: iso(handoff.deliveredAt),
    handoff_id: handoff.id,
    last_error: handoff.lastError,
    owner_call_id: handoff.ownerCallId,
    ready_at: iso(handoff.readyAt),
    reference: handoff.reference,
    requests: handoff.requests.map((request) => ({
      call_back: request.callBack,
      noted_at: request.at.toISOString(),
      request: request.request,
      source: request.source,
      timing: request.timing,
    })),
    resolution: handoff.resolution,
    resolved_at: iso(handoff.resolvedAt),
    status: handoff.status.toLowerCase(),
    subject: handoff.subject,
    ...("transcript" in handoff ? { transcript: handoff.transcript } : {}),
  };
}

export type OwnerCallResult =
  | ({ readonly ok: true } & Record<string, unknown>)
  | { readonly ok: false; readonly refusal: string };

const resultSchema: z.ZodType<OwnerCallResult> = z.union([
  z.looseObject({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), refusal: z.string() }),
]);

/**
 * A domain refusal (no owner line, Mili already on a call, a bad argument)
 * comes back as a result in the domain's own words, for Hermes's model to
 * act on. Anything else is thrown and reported as a failed tool call.
 */
async function refusalsAsResults(
  run: () => Promise<Record<string, unknown>>,
): Promise<OwnerCallResult> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    if (isDomainError(error) && error.status < 500) {
      return { ok: false, refusal: error.message };
    }
    throw error;
  }
}

export const scheduleOwnerCallInput = z.object({
  idempotency_key: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "Unique to this intent (your task or reminder id plus its due time). The same key never rings twice.",
    ),
  category: z
    .enum(OWNER_CALL_CATEGORIES)
    .describe("What kind of call this is. Mili introduces the call by it."),
  subject: z
    .string()
    .max(OWNER_CALL_LIMITS.subjectMaxChars)
    .describe("One line: what the call is about."),
  agenda: z
    .array(z.string().max(OWNER_CALL_LIMITS.agendaItemMaxChars))
    .max(OWNER_CALL_LIMITS.agendaMaxItems)
    .default([])
    .describe("The points Mili covers, in order: one short sentence each."),
  context: z
    .string()
    .max(OWNER_CALL_LIMITS.contextMaxChars)
    .default("")
    .describe(
      "Everything Mili may need to answer follow-up questions: the brief, meeting details, who is involved, figures. Plain text; she never reads it out word for word.",
    ),
  call_at: z.iso
    .datetime({ offset: true })
    .optional()
    .describe(
      `When to ring, ISO 8601 with an offset (2026-11-27T09:15:00+11:00), up to ${OWNER_CALL_LIMITS.scheduleMaxDays} days ahead. Leave it out to ring now.`,
    ),
  event_at: z.iso
    .datetime({ offset: true })
    .optional()
    .describe(
      "When the event the call is about starts, ISO 8601 with an offset. Calendar reminders only.",
    ),
  reference: z
    .string()
    .max(OWNER_CALL_LIMITS.referenceMaxChars)
    .optional()
    .describe(
      "Your own id for the task or event. It comes back with every follow-up question Mili passes to you.",
    ),
  handoff_id: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "When this is the callback for a post-call handoff, its handoff_id. Scheduling it resolves the handoff; one callback per handoff, so asking again returns the one already scheduled.",
    ),
});

export const handoffIdInput = z.object({
  handoff_id: z
    .string()
    .min(1)
    .max(100)
    .describe("The handoff_id from the post-call handoff Royal sent you."),
});

export const resolveHandoffInput = handoffIdInput.extend({
  resolution: z
    .string()
    .trim()
    .min(1)
    .max(OWNER_CALL_HANDOFF_LIMITS.resolutionMaxChars)
    .describe("One line: how it was dealt with, without a callback."),
});

export const ownerCallIdInput = z.object({
  owner_call_id: z
    .string()
    .min(1)
    .max(100)
    .describe("The owner_call_id schedule_owner_call returned."),
});

export async function scheduleOwnerCall(
  input: z.infer<typeof scheduleOwnerCallInput>,
  ctx: ToolContext,
): Promise<OwnerCallResult> {
  const actor = await requireHermes(ctx);
  return runAuditedAgentOperation({
    action: "owner_call.schedule",
    ctx,
    execute: () =>
      refusalsAsResults(async () => {
        const runtime = commsRuntimeFromEnv();
        const result = await requestOwnerCall(
          HERMES_PRINCIPAL,
          {
            agenda: input.agenda,
            callAt: input.call_at ? new Date(input.call_at) : null,
            category: input.category,
            context: input.context,
            eventAt: input.event_at ? new Date(input.event_at) : null,
            handoffId: input.handoff_id ?? null,
            idempotencyKey: input.idempotency_key,
            reference: input.reference ?? null,
            subject: input.subject,
          },
          agentDb,
          { channel: runtime.channel, voice: runtime.voice },
        );
        return {
          ...ownerCallForHermes(result.ownerCall),
          already_requested: result.alreadyRequested,
        };
      }),
    // What was asked, without the context: that can be long and personal,
    // and the OwnerCall row keeps it.
    inputSummary: {
      callAt: input.call_at ?? null,
      category: input.category,
      handoffId: input.handoff_id ?? null,
      idempotencyKey: input.idempotency_key,
      subject: input.subject,
    } satisfies Prisma.InputJsonValue,
    outputSchema: resultSchema,
    ownerUserId: actor.id,
    // The app starts the call's timer from this ref (app/api/agent/effects).
    targetIdFromOutput: (output) =>
      output.ok && typeof output.owner_call_id === "string"
        ? output.owner_call_id
        : undefined,
    targetType: "ownerCall",
    // It rings a phone: no database transaction may be held across that.
    transactional: false,
  });
}

export async function cancelScheduledOwnerCall(
  input: z.infer<typeof ownerCallIdInput>,
  ctx: ToolContext,
): Promise<OwnerCallResult> {
  const actor = await requireHermes(ctx);
  return runAuditedAgentOperation({
    action: "owner_call.cancel",
    ctx,
    execute: () =>
      refusalsAsResults(async () =>
        ownerCallForHermes(
          await cancelOwnerCall(
            HERMES_PRINCIPAL,
            { ownerCallId: input.owner_call_id },
            agentDb,
          ),
        ),
      ),
    inputSummary: { ownerCallId: input.owner_call_id },
    outputSchema: resultSchema,
    ownerUserId: actor.id,
    targetId: input.owner_call_id,
    targetType: "ownerCall",
    transactional: false,
  });
}

export async function getOwnerCall(
  input: z.infer<typeof ownerCallIdInput>,
  ctx: ToolContext,
): Promise<OwnerCallResult> {
  await requireHermes(ctx);
  return refusalsAsResults(async () =>
    ownerCallForHermes(
      await readOwnerCall(
        HERMES_PRINCIPAL,
        { ownerCallId: input.owner_call_id },
        agentDb,
      ),
    ),
  );
}

export async function listScheduledOwnerCalls(
  ctx: ToolContext,
): Promise<OwnerCallResult> {
  await requireHermes(ctx);
  return refusalsAsResults(async () => {
    const lists = await listOwnerCalls(HERMES_PRINCIPAL, agentDb, {
      recentLimit: 20,
    });
    return {
      pending: lists.pending.map(ownerCallForHermes),
      recent: lists.recent.map(ownerCallForHermes),
    };
  });
}

export async function listHandoffs(ctx: ToolContext): Promise<OwnerCallResult> {
  await requireHermes(ctx);
  return refusalsAsResults(async () => ({
    outstanding: (await listOwnerCallHandoffs(HERMES_PRINCIPAL, agentDb)).map(
      handoffForHermes,
    ),
  }));
}

export async function getHandoff(
  input: z.infer<typeof handoffIdInput>,
  ctx: ToolContext,
): Promise<OwnerCallResult> {
  await requireHermes(ctx);
  return refusalsAsResults(async () =>
    handoffForHermes(
      await readOwnerCallHandoff(
        HERMES_PRINCIPAL,
        { handoffId: input.handoff_id },
        agentDb,
      ),
    ),
  );
}

export async function resolveHandoff(
  input: z.infer<typeof resolveHandoffInput>,
  ctx: ToolContext,
): Promise<OwnerCallResult> {
  const actor = await requireHermes(ctx);
  return runAuditedAgentOperation({
    action: "owner_call_handoff.resolve",
    ctx,
    execute: () =>
      refusalsAsResults(async () =>
        handoffForHermes(
          await resolveOwnerCallHandoff(
            HERMES_PRINCIPAL,
            { handoffId: input.handoff_id, resolution: input.resolution },
            agentDb,
          ),
        ),
      ),
    inputSummary: {
      handoffId: input.handoff_id,
      resolution: input.resolution,
    },
    outputSchema: resultSchema,
    ownerUserId: actor.id,
    targetId: input.handoff_id,
    targetType: "ownerCallHandoff",
    transactional: false,
  });
}
