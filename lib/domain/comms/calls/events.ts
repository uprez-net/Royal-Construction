import {
  CallAnsweredBy,
  CallFlowStep,
  CallRecordingKind,
  CallStatus,
  CommsDirection,
  type Prisma,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import {
  browserIdentity,
  type CallInstruction,
  type CommsChannel,
  type CommsEvent,
  type CommsProviderName,
} from "../../ports/comms";
import type { DomainPrincipal } from "../../principal";
import {
  findBusinessNumber,
  leadsWithNumber,
  maskNumber,
  providerColumn,
  recordCommsHistory,
} from "../shared";
import { isUniqueViolation } from "../../leads/whatsapp/records";
import {
  decideAfterAgent,
  decideAfterConsent,
  decideAfterDial,
  decideCallStart,
  type CallFlowContext,
  type CallForFlow,
  type FlowDecision,
} from "./flow";
import { VOICE_AGENT_NAME } from "./voice-agent";
import {
  callStatusAdvances,
  callStatusOf,
  isTerminalCallStatus,
} from "./state";

// A verified provider callback about a phone call, applied to the Call row.
//
// One function for every provider: the adapter has already turned TwiML form
// fields or Telnyx JSON into a neutral CommsEvent. What comes back is the
// next instructions for the call (rendered as markup or issued as commands
// by the adapter) and, for a recording, the row to copy into storage.
//
// Idempotent by construction: statuses only move forward, a flow step is only
// left from the step it belongs to, and a recording is unique per provider id.
// The adapter also skips event deliveries it has already processed.

type CallEvent = Extract<
  CommsEvent,
  {
    type:
      | "call.incoming"
      | "call.answered"
      | "call.status"
      | "call.gathered"
      | "call.connected"
      | "call.dialed"
      | "call.recording"
      | "call.agentEnded";
  }
>;

export type CallEventContext = {
  readonly provider: CommsProviderName;
  readonly channel: CommsChannel | null;
  readonly now?: Date;
};

export type CallEventOutcome = {
  readonly outcome: "applied" | "ignored" | "unknown_call";
  readonly callId: string | null;
  /** Null: nothing to tell the provider beyond acknowledging the callback. */
  readonly instructions: readonly CallInstruction[] | null;
  /** A recording newly on record, to be copied into storage. */
  readonly recordingId: string | null;
};

const CALL_FOR_EVENT = {
  answeredAt: true,
  answeredBy: true,
  businessNumber: true,
  connectedAt: true,
  customerNumber: true,
  direction: true,
  durationSeconds: true,
  flowStep: true,
  id: true,
  leadId: true,
  recordingConsent: true,
  staffPhoneNumber: true,
  staffTarget: true,
  staffUserId: true,
  startedAt: true,
  status: true,
} satisfies Prisma.CallSelect;

type CallForEvent = Prisma.CallGetPayload<{ select: typeof CALL_FOR_EVENT }>;

const RINGING_STEPS: ReadonlySet<CallFlowStep> = new Set([
  CallFlowStep.RINGING_BROWSER,
  CallFlowStep.RINGING_MOBILE,
  CallFlowStep.CONNECTED,
]);

function ignored(callId: string | null): CallEventOutcome {
  return { callId, instructions: null, outcome: "ignored", recordingId: null };
}

function forFlow(call: CallForEvent): CallForFlow {
  return {
    businessNumber: call.businessNumber,
    customerNumber: call.customerNumber,
    direction: call.direction,
    flowStep: call.flowStep,
    recordingConsent: call.recordingConsent,
    staffIdentity: call.staffUserId ? browserIdentity(call.staffUserId) : null,
    staffPhoneNumber: call.staffPhoneNumber,
    staffTarget: call.staffTarget,
  };
}

function flowContext(channel: CommsChannel | null): CallFlowContext {
  return {
    channel: channel ?? {
      browserCalling: false,
      recordingMode: "off",
      staffForwardNumber: null,
      voiceAgent: false,
    },
  };
}

async function findCall(
  db: DomainDb,
  provider: CommsProviderName,
  ids: { callId: string | null; providerCallId: string | null },
): Promise<CallForEvent | null> {
  if (ids.callId) {
    const byId = await db.call.findUnique({
      select: { ...CALL_FOR_EVENT, provider: true },
      where: { id: ids.callId },
    });
    // A callback naming another provider's call is not this call's.
    if (byId && byId.provider === providerColumn(provider)) return byId;
  }
  if (!ids.providerCallId) return null;
  return db.call.findUnique({
    select: CALL_FOR_EVENT,
    where: {
      provider_providerCallId: {
        provider: providerColumn(provider),
        providerCallId: ids.providerCallId,
      },
    },
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "duration unknown";
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function describeEnd(
  call: CallForEvent,
  status: CallStatus,
  seconds: number | null,
) {
  const inbound = call.direction === CommsDirection.INBOUND;
  if (
    status === CallStatus.COMPLETED
    && call.connectedAt
    && call.answeredBy === CallAnsweredBy.AGENT
  ) {
    return {
      action: `Call answered by ${VOICE_AGENT_NAME}`,
      detail: `${VOICE_AGENT_NAME} spoke with ${maskNumber(call.customerNumber)} for ${formatDuration(seconds)}. The transcript is on the call.`,
    };
  }
  if (status === CallStatus.COMPLETED && call.connectedAt) {
    return {
      action: inbound ? "Call received" : "Call made",
      detail: `${inbound ? "Call from" : "Call to"} ${maskNumber(call.customerNumber)} lasted ${formatDuration(seconds)}.`,
    };
  }
  if (inbound) {
    return {
      action:
        call.answeredBy === CallAnsweredBy.VOICEMAIL
          ? "Voicemail"
          : "Missed call",
      detail:
        call.answeredBy === CallAnsweredBy.VOICEMAIL
          ? `${maskNumber(call.customerNumber)} left a voicemail.`
          : `Missed call from ${maskNumber(call.customerNumber)}.`,
    };
  }
  const label: Partial<Record<CallStatus, string>> = {
    [CallStatus.BUSY]: "the line was busy",
    [CallStatus.CANCELED]: "the call was cancelled",
    [CallStatus.FAILED]: "the call failed",
    [CallStatus.NO_ANSWER]: "nobody answered",
  };
  return {
    action: "Call attempted",
    detail: `Called ${maskNumber(call.customerNumber)}: ${label[status] ?? "the call ended before anyone was connected"}.`,
  };
}

/**
 * Mili picking up counts as the call being answered: it is a conversation,
 * not a missed call, unless she never got going.
 */
function agentAnswered(
  call: CallForEvent,
  decision: FlowDecision,
  now: Date,
): Prisma.CallUpdateInput {
  if (decision.step !== CallFlowStep.AGENT) return {};
  return {
    answeredBy: CallAnsweredBy.AGENT,
    connectedAt: call.connectedAt ?? now,
  };
}

async function applyDecision(
  db: DomainDb,
  call: CallForEvent,
  decision: FlowDecision,
  extra: Prisma.CallUpdateInput = {},
): Promise<void> {
  await db.call.update({
    data: {
      ...extra,
      flowStep: decision.step,
      ...(decision.recordingConsent
        ? { recordingConsent: decision.recordingConsent }
        : {}),
    },
    where: { id: call.id },
  });
}

export async function applyCallEvent(
  principal: DomainPrincipal,
  event: CallEvent,
  db: TransactionalDomainDb,
  context: CallEventContext,
): Promise<CallEventOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only a verified provider callback may change a call.",
    );
  }
  const now = context.now ?? new Date();
  if (event.type === "call.incoming") {
    return recordIncomingCall(principal, event, db, context, now);
  }

  return db.$transaction(async (tx) => {
    const call = await findCall(tx, context.provider, {
      callId: "callId" in event ? event.callId : null,
      providerCallId: event.providerCallId,
    });
    if (!call) {
      return {
        callId: null,
        instructions: null,
        outcome: "unknown_call" as const,
        recordingId: null,
      };
    }

    switch (event.type) {
      case "call.answered": {
        const ctx = flowContext(context.channel);
        const fresh =
          call.direction === CommsDirection.OUTBOUND
            ? call.flowStep === CallFlowStep.DIALING_CUSTOMER
            : call.status !== CallStatus.IN_PROGRESS;
        if (!fresh) {
          // A repeated answer (a retried connect request) gets the same
          // first step again rather than an empty answer, which would hang
          // up on the customer. Ended calls get nothing.
          if (
            call.flowStep === CallFlowStep.ENDED
            || call.flowStep === CallFlowStep.VOICEMAIL
            || call.flowStep === CallFlowStep.CONNECTED
            || call.flowStep === CallFlowStep.AGENT
          ) {
            return ignored(call.id);
          }
          return {
            callId: call.id,
            instructions: decideCallStart(forFlow(call), ctx).instructions,
            outcome: "ignored" as const,
            recordingId: null,
          };
        }
        const decision = decideCallStart(forFlow(call), ctx);
        await applyDecision(tx, call, decision, {
          ...agentAnswered(call, decision, now),
          answeredAt: call.answeredAt ?? now,
          ...(callStatusAdvances(call.status, CallStatus.IN_PROGRESS)
            ? { status: CallStatus.IN_PROGRESS }
            : {}),
          ...(event.providerCallId
            ? { providerCallId: event.providerCallId }
            : {}),
        });
        return {
          callId: call.id,
          instructions: decision.instructions,
          outcome: "applied" as const,
          recordingId: null,
        };
      }

      case "call.status": {
        const next = callStatusOf(event.state);
        const terminal = isTerminalCallStatus(next);
        if (!callStatusAdvances(call.status, next)) {
          // A terminal call may still learn its duration from a late event.
          if (
            isTerminalCallStatus(call.status)
            && call.durationSeconds === null
            && event.durationSeconds !== null
          ) {
            await tx.call.update({
              data: { durationSeconds: event.durationSeconds },
              where: { id: call.id },
            });
            return {
              callId: call.id,
              instructions: null,
              outcome: "applied" as const,
              recordingId: null,
            };
          }
          return ignored(call.id);
        }
        await tx.call.update({
          data: {
            status: next,
            ...(next === CallStatus.IN_PROGRESS
              ? { answeredAt: call.answeredAt ?? event.occurredAt }
              : {}),
            ...(terminal
              ? {
                  durationSeconds:
                    event.durationSeconds ?? call.durationSeconds,
                  endedAt: event.occurredAt,
                  flowStep: CallFlowStep.ENDED,
                  hangupCause: event.hangupCause,
                }
              : {}),
          },
          where: { id: call.id },
        });
        if (terminal && call.leadId !== null) {
          const ended = describeEnd(
            call,
            next,
            event.durationSeconds ?? call.durationSeconds,
          );
          await recordCommsHistory(tx, {
            action: ended.action,
            at: event.occurredAt,
            detail: ended.detail,
            leadId: call.leadId,
            principal,
            type: "CALL",
          });
        }
        return {
          callId: call.id,
          instructions: null,
          outcome: "applied" as const,
          recordingId: null,
        };
      }

      case "call.gathered": {
        if (call.flowStep !== CallFlowStep.RECORDING_CONSENT)
          return ignored(call.id);
        const ctx = flowContext(context.channel);
        const decision = decideAfterConsent(forFlow(call), ctx, event.digits);
        await applyDecision(tx, call, decision);
        return {
          callId: call.id,
          instructions: decision.instructions,
          outcome: "applied" as const,
          recordingId: null,
        };
      }

      case "call.connected": {
        if (
          call.flowStep !== CallFlowStep.RINGING_BROWSER
          && call.flowStep !== CallFlowStep.RINGING_MOBILE
        ) {
          return ignored(call.id);
        }
        await tx.call.update({
          data: {
            answeredBy:
              call.flowStep === CallFlowStep.RINGING_BROWSER
                ? CallAnsweredBy.BROWSER
                : CallAnsweredBy.MOBILE,
            connectedAt: now,
            flowStep: CallFlowStep.CONNECTED,
          },
          where: { id: call.id },
        });
        return {
          callId: call.id,
          instructions: null,
          outcome: "applied" as const,
          recordingId: null,
        };
      }

      case "call.dialed": {
        if (!RINGING_STEPS.has(call.flowStep)) return ignored(call.id);
        const ctx = flowContext(context.channel);
        const decision = decideAfterDial(forFlow(call), ctx, event.outcome);
        const answered = event.outcome === "answered";
        await applyDecision(tx, call, decision, {
          ...(answered && !call.answeredBy
            ? {
                answeredBy:
                  call.flowStep === CallFlowStep.RINGING_MOBILE
                    ? CallAnsweredBy.MOBILE
                    : CallAnsweredBy.BROWSER,
              }
            : {}),
          ...(answered && !call.connectedAt ? { connectedAt: now } : {}),
        });
        return {
          callId: call.id,
          instructions: decision.instructions,
          outcome: "applied" as const,
          recordingId: null,
        };
      }

      case "call.recording": {
        const kind =
          event.kind === "call"
            ? CallRecordingKind.CALL
            : event.kind === "voicemail"
                || call.flowStep === CallFlowStep.VOICEMAIL
              ? CallRecordingKind.VOICEMAIL
              : CallRecordingKind.CALL;
        const existing = await tx.callRecording.findUnique({
          select: { id: true },
          where: {
            provider_providerRecordingId: {
              provider: providerColumn(context.provider),
              providerRecordingId: event.providerRecordingId,
            },
          },
        });
        if (existing) return ignored(call.id);
        const recording = await tx.callRecording.create({
          data: {
            callId: call.id,
            durationSeconds: event.durationSeconds,
            kind,
            provider: providerColumn(context.provider),
            providerRecordingId: event.providerRecordingId,
          },
          select: { id: true },
        });
        if (kind === CallRecordingKind.VOICEMAIL && !call.answeredBy) {
          await tx.call.update({
            data: { answeredBy: CallAnsweredBy.VOICEMAIL },
            where: { id: call.id },
          });
        }
        return {
          callId: call.id,
          instructions: null,
          outcome: "applied" as const,
          recordingId: recording.id,
        };
      }

      case "call.agentEnded": {
        const transcript = event.transcript
          ? { agentTranscript: event.transcript }
          : {};
        if (call.flowStep !== CallFlowStep.AGENT) {
          // The caller hung up first, or a repeated report: keep what was
          // said, and leave the call where it is.
          if (event.transcript) {
            await tx.call.update({ data: transcript, where: { id: call.id } });
          }
          return ignored(call.id);
        }
        const decision = decideAfterAgent(
          forFlow(call),
          flowContext(context.channel),
          event.outcome,
        );
        await applyDecision(tx, call, decision, {
          ...transcript,
          // Mili never got going: the caller has not been answered yet, so
          // an unanswered fallback reads as a missed call, not "received".
          ...(event.outcome === "failed" && !event.transcript
            ? { answeredBy: null, connectedAt: null }
            : {}),
        });
        return {
          callId: call.id,
          instructions: decision.instructions,
          outcome: "applied" as const,
          recordingId: null,
        };
      }
    }
  });
}

async function recordIncomingCall(
  principal: DomainPrincipal,
  event: Extract<CallEvent, { type: "call.incoming" }>,
  db: TransactionalDomainDb,
  context: CallEventContext,
  now: Date,
): Promise<CallEventOutcome> {
  const provider = providerColumn(context.provider);
  try {
    return await db.$transaction(async (tx) => {
      const ctx = flowContext(context.channel);
      const existing = await tx.call.findUnique({
        select: CALL_FOR_EVENT,
        where: {
          provider_providerCallId: {
            provider,
            providerCallId: event.providerCallId,
          },
        },
      });
      if (existing) {
        // The provider asked again (a retried webhook). Same first step.
        return {
          callId: existing.id,
          instructions:
            existing.flowStep === CallFlowStep.ENDED
              ? [{ op: "hangup" as const }]
              : decideCallStart(forFlow(existing), ctx).instructions,
          outcome: "ignored" as const,
          recordingId: null,
        };
      }
      const business = findBusinessNumber(
        context.channel,
        event.to,
        context.provider,
      );
      const candidates = await leadsWithNumber(tx, event.from);
      const leadId = candidates.length === 1 ? candidates[0] : null;
      const draft: CallForFlow = {
        businessNumber: business?.e164 ?? event.to,
        customerNumber: event.from,
        direction: CommsDirection.INBOUND,
        flowStep: CallFlowStep.AGENT,
        recordingConsent: "NOT_ASKED",
        staffIdentity: null,
        staffPhoneNumber: null,
        staffTarget: null,
      };
      const decision = decideCallStart(draft, ctx);
      const call = await tx.call.create({
        data: {
          businessNumber: draft.businessNumber,
          candidateLeadIds: leadId === null ? candidates : [],
          customerNumber: event.from,
          direction: CommsDirection.INBOUND,
          flowStep: decision.step,
          leadId,
          provider,
          providerCallId: event.providerCallId,
          // Every inbound call is told it is recorded, from the first word.
          ...(decision.recordingConsent
            ? { recordingConsent: decision.recordingConsent }
            : {}),
          // Mili answers it. A markup carrier (Twilio) sends no separate
          // "answered" callback for an inbound call, so it is recorded here;
          // if she never gets going, `call.agentEnded` clears it again.
          ...(decision.step === CallFlowStep.AGENT
            ? { answeredBy: CallAnsweredBy.AGENT, connectedAt: now }
            : {}),
          startedAt: now,
          status: CallStatus.RINGING,
        },
        select: { id: true },
      });
      return {
        callId: call.id,
        instructions: decision.instructions,
        outcome: "applied" as const,
        recordingId: null,
      };
    });
  } catch (error) {
    // Two deliveries of the same call raced. The other one created the row;
    // answer as a replay would.
    if (isUniqueViolation(error)) {
      return recordIncomingCall(principal, event, db, context, now);
    }
    throw error;
  }
}
