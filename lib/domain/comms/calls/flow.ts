import {
  CallFlowStep,
  CallStaffTarget,
  CommsDirection,
  RecordingConsent,
} from "@prisma/client";

import type {
  CallInstruction,
  CommsChannel,
  DialOutcome,
} from "../../ports/comms";

// What a call does next, as neutral instructions (file 01 §10).
//
// Pure and fast: the provider is waiting for the answer (Twilio holds the
// caller in silence until the webhook responds). The caller of these
// functions writes the returned step onto the Call row; the adapter renders
// or executes the instructions.
//
// Inbound:   [consent?] → ring staff browsers → office mobile → voicemail
// Outbound:  customer answers → [consent?] → "connecting you" → staff
//            (browser or office mobile) → if nobody picks up, apologise
//
// Recording only ever starts after a customer pressed 1. Silence, any other
// key, or recording switched off means the call is not recorded. A voicemail
// is the caller choosing to leave a message, which the prompt says is
// recorded.

export const RING_BROWSER_SECONDS = 20;
export const RING_MOBILE_SECONDS = 20;
export const CONSENT_TIMEOUT_SECONDS = 6;
export const VOICEMAIL_MAX_SECONDS = 120;
export const OUTBOUND_RING_SECONDS = 30;

export const PROMPTS = {
  inboundConsent:
    "Thanks for calling Royal Constructions. Calls may be recorded for quality and training. Press 1 to allow recording, or 2 to continue without recording.",
  outboundConsent:
    "Hello, this is Royal Constructions. Calls may be recorded for quality and training. Press 1 to allow recording, or 2 to continue without recording.",
  outboundConnecting: "Hello, this is Royal Constructions. Connecting you now.",
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
    "recordingMode" | "staffForwardNumber" | "browserCalling" | "browserRingGroup"
  >;
  /** Identities of staff browsers that registered recently, newest first. */
  readonly browserIdentities: readonly string[];
};

export type CallForFlow = {
  readonly direction: CommsDirection;
  readonly flowStep: CallFlowStep;
  readonly businessNumber: string;
  readonly customerNumber: string;
  readonly recordingConsent: RecordingConsent;
  readonly staffTarget: CallStaffTarget | null;
  /** The identity of the staff member who placed an outbound call. */
  readonly staffIdentity: string | null;
};

export type FlowDecision = {
  readonly step: CallFlowStep;
  readonly instructions: readonly CallInstruction[];
  /** Set when the decision settles the consent question. */
  readonly recordingConsent?: RecordingConsent;
};

function consentGather(prompt: string): CallInstruction {
  return {
    numDigits: 1,
    op: "gatherDigits",
    prompt,
    timeoutSeconds: CONSENT_TIMEOUT_SECONDS,
  };
}

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
  const forward = ctx.channel.staffForwardNumber;
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

function ringBrowsers(call: CallForFlow, ctx: CallFlowContext, record: boolean) {
  if (!ctx.channel.browserCalling || ctx.browserIdentities.length === 0) {
    return null;
  }
  const identities = ctx.channel.browserRingGroup
    ? ctx.browserIdentities
    : ctx.browserIdentities.slice(0, 1);
  return {
    instructions: [
      {
        callerId: call.customerNumber,
        identities,
        op: "dialBrowser",
        record,
        timeoutSeconds: RING_BROWSER_SECONDS,
      },
    ],
    step: CallFlowStep.RINGING_BROWSER,
  } satisfies FlowDecision;
}

function consented(call: CallForFlow): boolean {
  return call.recordingConsent === RecordingConsent.GRANTED;
}

/** Inbound: the staff ring sequence, from the first ring. */
function ringInboundStaff(call: CallForFlow, ctx: CallFlowContext): FlowDecision {
  const record = consented(call);
  return ringBrowsers(call, ctx, record) ?? ringMobile(call, ctx, record) ?? voicemail();
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
    if (mobile) return { ...mobile, instructions: [say, ...mobile.instructions] };
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
  const ask = ctx.channel.recordingMode === "consented";
  if (call.direction === CommsDirection.INBOUND) {
    if (ask) {
      return {
        instructions: [consentGather(PROMPTS.inboundConsent)],
        step: CallFlowStep.RECORDING_CONSENT,
      };
    }
    return ringInboundStaff(call, ctx);
  }
  if (ask) {
    return {
      instructions: [consentGather(PROMPTS.outboundConsent)],
      step: CallFlowStep.RECORDING_CONSENT,
    };
  }
  return connectOutbound(call, ctx, PROMPTS.outboundConnecting);
}

/** The customer answered the consent question (or did not). */
export function decideAfterConsent(
  call: CallForFlow,
  ctx: CallFlowContext,
  digits: string,
): FlowDecision {
  const recordingConsent =
    digits.trim() === "1" ? RecordingConsent.GRANTED : RecordingConsent.DECLINED;
  const decided = { ...call, recordingConsent };
  const next =
    call.direction === CommsDirection.INBOUND
      ? ringInboundStaff(decided, ctx)
      : connectOutbound(decided, ctx, PROMPTS.connecting);
  return { ...next, recordingConsent };
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
