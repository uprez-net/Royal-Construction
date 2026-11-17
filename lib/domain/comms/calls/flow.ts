import {
  CallFlowStep,
  CallStaffTarget,
  CommsDirection,
  RecordingConsent,
} from "@prisma/client";

import type {
  AgentOutcome,
  CallInstruction,
  CommsChannel,
  DialOutcome,
} from "../../ports/comms";
import { VOICE_AGENT_MAX_SECONDS } from "./voice-agent";

// What a call does next, as neutral instructions (file 01 §10).
//
// Pure and fast: the provider is waiting for the answer (Twilio holds the
// caller in silence until the webhook responds). The caller of these
// functions writes the returned step onto the Call row; the adapter renders
// or executes the instructions.
//
// Inbound:   "this call is recorded" → Mili, the voice agent
//            → (asked for a person, or Mili unreachable) office mobile
//            → voicemail
// Outbound:  customer answers → greeting [+ "this call is recorded"]
//            → staff (browser, or the phone picked) → if nobody picks up,
//            apologise
//
// An inbound call never rings a staff browser: the business number itself
// answers every call, and the office mobile is only the fallback.
//
// Inbound calls are always recorded, and the first thing the caller hears is
// a declaration saying so — they are told, not asked (DECLARED). Outbound
// calls work the same way when recording is switched on: the customer is told
// the call is recorded, and staying on the line is their consent (DECLARED).
// They used to be asked to press 1; nobody did, and the question — repeated —
// kept them from the person who rang them. With recording off, nothing is
// said and nothing is recorded. A voicemail is the caller choosing to leave a
// message, which the prompt says is recorded.

export const RING_BROWSER_SECONDS = 20;
export const RING_MOBILE_SECONDS = 20;
export const VOICEMAIL_MAX_SECONDS = 120;
export const OUTBOUND_RING_SECONDS = 30;

export const PROMPTS = {
  /** Played, word for word, before anything else on every inbound call. */
  recordingDeclaration:
    "Thanks for calling Royal Constructions. Please note this call is being recorded for quality and training purposes.",
  agentTransfer: "No worries. I'll put you through to the team now.",
  agentUnavailable:
    "Sorry, our assistant isn't available just now. I'll put you through to the team.",
  outboundConnecting: "Hello, this is Royal Constructions. Connecting you now.",
  /** Played, word for word, when an outbound call is recorded. */
  outboundRecordedConnecting:
    "Hello, this is Royal Constructions. Please note this call is being recorded for quality and training purposes. Connecting you now.",
  connecting: "Thanks. Connecting you now.",
  voicemail:
    "Sorry, nobody is available to take your call. Please leave your name, number and a short message after the tone, and we'll call you back. Your message will be recorded.",
  outboundUnavailable:
    "Sorry, we couldn't connect you just now. We'll call you back shortly. Goodbye.",
  goodbye: "Thanks for calling. Goodbye.",
} as const;

export type CallFlowContext = {
  readonly channel: Pick<
    CommsChannel,
    "recordingMode" | "staffForwardNumber" | "browserCalling" | "voiceAgent"
  >;
};

export type CallForFlow = {
  readonly direction: CommsDirection;
  readonly flowStep: CallFlowStep;
  readonly businessNumber: string;
  readonly customerNumber: string;
  readonly recordingConsent: RecordingConsent;
  readonly staffTarget: CallStaffTarget | null;
  /**
   * Outbound to a phone: the one picked when the call was placed. Null means
   * the office mobile (inbound calls, and calls placed before the team list).
   */
  readonly staffPhoneNumber: string | null;
  /** The identity of the staff member who placed an outbound call. */
  readonly staffIdentity: string | null;
};

export type FlowDecision = {
  readonly step: CallFlowStep;
  readonly instructions: readonly CallInstruction[];
  /** Set when the decision settles the consent question. */
  readonly recordingConsent?: RecordingConsent;
};

function voicemail(): FlowDecision {
  return {
    instructions: [
      { op: "say", text: PROMPTS.voicemail },
      { maxSeconds: VOICEMAIL_MAX_SECONDS, op: "recordVoicemail" },
      { op: "hangup" },
    ],
    step: CallFlowStep.VOICEMAIL,
  };
}

function ringMobile(call: CallForFlow, ctx: CallFlowContext, record: boolean) {
  const forward = call.staffPhoneNumber ?? ctx.channel.staffForwardNumber;
  if (!forward) return null;
  return {
    instructions: [
      {
        // The business number, not the customer's: AU carriers may refuse a
        // forwarded call presenting a number Royal does not own. The office
        // sees the customer's number in the app.
        callerId: call.businessNumber,
        op: "dialNumber",
        record,
        timeoutSeconds: RING_MOBILE_SECONDS,
        to: forward,
      },
    ],
    step: CallFlowStep.RINGING_MOBILE,
  } satisfies FlowDecision;
}

function consented(call: CallForFlow): boolean {
  return (
    call.recordingConsent === RecordingConsent.GRANTED
    || call.recordingConsent === RecordingConsent.DECLARED
  );
}

/** Inbound, when Mili cannot take the call: the office mobile, then voicemail. */
function ringInboundStaff(
  call: CallForFlow,
  ctx: CallFlowContext,
): FlowDecision {
  return ringMobile(call, ctx, consented(call)) ?? voicemail();
}

/** Inbound: the declaration, then Mili — or the staff sequence without her. */
function answerInbound(call: CallForFlow, ctx: CallFlowContext): FlowDecision {
  const declared = {
    ...call,
    recordingConsent: RecordingConsent.DECLARED,
  };
  const declaration: CallInstruction = {
    op: "say",
    text: PROMPTS.recordingDeclaration,
  };
  const next: FlowDecision = ctx.channel.voiceAgent
    ? {
        instructions: [
          {
            maxSeconds: VOICE_AGENT_MAX_SECONDS,
            op: "connectAgent",
            record: true,
          },
        ],
        step: CallFlowStep.AGENT,
      }
    : ringInboundStaff(declared, ctx);
  return {
    instructions: [declaration, ...next.instructions],
    recordingConsent: RecordingConsent.DECLARED,
    step: next.step,
  };
}

/** Outbound: put the customer through to whoever placed the call. */
function connectOutbound(
  call: CallForFlow,
  ctx: CallFlowContext,
  greeting: string,
): FlowDecision {
  const record = consented(call);
  const say: CallInstruction = { op: "say", text: greeting };
  if (call.staffTarget === CallStaffTarget.MOBILE) {
    const mobile = ringMobile(call, ctx, record);
    if (mobile)
      return { ...mobile, instructions: [say, ...mobile.instructions] };
  } else if (call.staffIdentity && ctx.channel.browserCalling) {
    return {
      instructions: [
        say,
        {
          callerId: call.customerNumber,
          identities: [call.staffIdentity],
          op: "dialBrowser",
          record,
          timeoutSeconds: RING_BROWSER_SECONDS,
        },
      ],
      step: CallFlowStep.RINGING_BROWSER,
    };
  }
  return outboundUnavailable();
}

function outboundUnavailable(): FlowDecision {
  return {
    instructions: [
      { op: "say", text: PROMPTS.outboundUnavailable },
      { op: "hangup" },
    ],
    step: CallFlowStep.ENDED,
  };
}

/** The first thing a customer hears: an inbound call arrived, or an outbound one was answered. */
export function decideCallStart(
  call: CallForFlow,
  ctx: CallFlowContext,
): FlowDecision {
  if (call.direction === CommsDirection.INBOUND) {
    return answerInbound(call, ctx);
  }
  if (ctx.channel.recordingMode === "consented") {
    // Told, not asked: staying on the line is consent.
    const declared = {
      ...call,
      recordingConsent: RecordingConsent.DECLARED,
    };
    return {
      ...connectOutbound(declared, ctx, PROMPTS.outboundRecordedConnecting),
      recordingConsent: RecordingConsent.DECLARED,
    };
  }
  return connectOutbound(call, ctx, PROMPTS.outboundConnecting);
}

/**
 * The customer answered the consent question (or did not). Outbound calls no
 * longer ask it; this settles a call that was already asking when that
 * changed.
 */
export function decideAfterConsent(
  call: CallForFlow,
  ctx: CallFlowContext,
  digits: string,
): FlowDecision {
  const recordingConsent =
    digits.trim() === "1"
      ? RecordingConsent.GRANTED
      : RecordingConsent.DECLINED;
  const decided = { ...call, recordingConsent };
  const next =
    call.direction === CommsDirection.INBOUND
      ? ringInboundStaff(decided, ctx)
      : connectOutbound(decided, ctx, PROMPTS.connecting);
  return { ...next, recordingConsent };
}

/**
 * Mili's conversation ended while the caller is still on the line.
 *
 * Finished: hang up. Asked for a person, or Mili never got going: take the
 * caller back and try the office mobile, then voicemail — a caller who wanted
 * somebody is never just hung up on.
 */
export function decideAfterAgent(
  call: CallForFlow,
  ctx: CallFlowContext,
  outcome: AgentOutcome,
): FlowDecision {
  if (outcome === "completed") {
    return { instructions: [{ op: "hangup" }], step: CallFlowStep.ENDED };
  }
  const next = ringInboundStaff(call, ctx);
  return {
    ...next,
    instructions: [
      // A voicemail starts its own recording; the conversation's stops here.
      { op: "stopAgent", stopRecording: next.step === CallFlowStep.VOICEMAIL },
      ...(next.step === CallFlowStep.VOICEMAIL
        ? []
        : [
            {
              op: "say" as const,
              text:
                outcome === "transfer"
                  ? PROMPTS.agentTransfer
                  : PROMPTS.agentUnavailable,
            },
          ]),
      ...next.instructions,
    ],
  };
}

/** A dial step finished. Answered means the conversation happened and is over. */
export function decideAfterDial(
  call: CallForFlow,
  ctx: CallFlowContext,
  outcome: DialOutcome,
): FlowDecision {
  if (outcome === "answered") {
    return { instructions: [{ op: "hangup" }], step: CallFlowStep.ENDED };
  }
  if (call.direction === CommsDirection.OUTBOUND) return outboundUnavailable();
  if (call.flowStep === CallFlowStep.RINGING_BROWSER) {
    return ringMobile(call, ctx, consented(call)) ?? voicemail();
  }
  return voicemail();
}
