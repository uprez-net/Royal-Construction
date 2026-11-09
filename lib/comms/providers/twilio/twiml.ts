import type { CallInstruction } from "@/lib/domain/ports/comms";

import { commsCallbackUrl } from "../../callbacks";

// Neutral call instructions → TwiML (file 01 §5, file 02).
//
// Twilio asks a URL what to do and the response body says. Every action URL
// carries Royal's call id so the next request binds to the same Call row. A
// verb with an `action` hands control to that URL, so the domain always puts
// gather, dial and record last; anything after them would never run.

const VOICE = 'voice="Polly.Nicole" language="en-AU"';

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type TwimlContext = {
  readonly origin: string;
  readonly callId: string | null;
  /**
   * The voice-agent address and token for Mili's stream. Throws when the voice
   * agent is not configured; the caller then hears an apology, not silence.
   */
  readonly agentStream?: (maxSeconds: number) => {
    readonly url: string;
    readonly token: string;
  };
};

const AGENT_UNREACHABLE = `<Say ${VOICE}>Sorry, we can't take your call right now. Please call back shortly.</Say><Hangup/>`;

export function renderTwiml(
  instructions: readonly CallInstruction[] | null,
  context: TwimlContext,
): string {
  const url = (event: string) =>
    xmlEscape(
      commsCallbackUrl(context.origin, "twilio", event, {
        callId: context.callId,
      }),
    );
  const parts: string[] = [];
  for (const step of instructions ?? []) {
    switch (step.op) {
      case "say":
        parts.push(`<Say ${VOICE}>${xmlEscape(step.text)}</Say>`);
        break;
      case "gatherDigits":
        parts.push(
          `<Gather input="dtmf" numDigits="${step.numDigits}" timeout="${step.timeoutSeconds}" action="${url("voice-gather")}" method="POST" actionOnEmptyResult="true"><Say ${VOICE}>${xmlEscape(step.prompt)}</Say></Gather>`,
        );
        break;
      case "dialBrowser":
      case "dialNumber": {
        const record = step.record
          ? ` record="record-from-answer-dual" recordingStatusCallback="${url("voice-recording")}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"`
          : "";
        const leg = `statusCallbackEvent="answered" statusCallback="${url("voice-leg")}" statusCallbackMethod="POST"`;
        const targets =
          step.op === "dialBrowser"
            ? step.identities
                .map(
                  (identity) =>
                    `<Client ${leg}><Identity>${xmlEscape(identity)}</Identity>${
                      context.callId
                        ? `<Parameter name="callId" value="${xmlEscape(context.callId)}"/>`
                        : ""
                    }</Client>`,
                )
                .join("")
            : `<Number ${leg}>${xmlEscape(step.to)}</Number>`;
        parts.push(
          `<Dial callerId="${xmlEscape(step.callerId)}" timeout="${step.timeoutSeconds}" answerOnBridge="true" action="${url("voice-dial")}" method="POST"${record}>${targets}</Dial>`,
        );
        break;
      }
      case "recordVoicemail":
        parts.push(
          `<Record maxLength="${step.maxSeconds}" playBeep="true" timeout="5" action="${url("voice-voicemail-done")}" method="POST" recordingStatusCallback="${url("voice-recording")}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"/>`,
        );
        break;
      case "connectAgent": {
        // A bidirectional Media Stream to the voice-agent route. Twilio drops a query
        // string on the stream URL, so the token rides as a <Parameter> in
        // the "start" frame. The stream's status callback starts the
        // recording once audio flows; <Connect>'s action is only requested
        // when the stream ends without Mili having moved the call on —
        // her session never got going (VERIFY attribute names on a live call).
        let stream: { url: string; token: string } | null = null;
        try {
          stream = context.agentStream?.(step.maxSeconds) ?? null;
        } catch {
          stream = null;
        }
        if (!stream) {
          parts.push(AGENT_UNREACHABLE);
          break;
        }
        const status = xmlEscape(
          commsCallbackUrl(context.origin, "twilio", "voice-agent-stream", {
            callId: context.callId,
            record: step.record ? "1" : null,
          }),
        );
        parts.push(
          `<Connect action="${url("voice-agent-done")}" method="POST"><Stream url="${xmlEscape(stream.url)}" statusCallback="${status}" statusCallbackMethod="POST"><Parameter name="token" value="${xmlEscape(stream.token)}"/></Stream></Connect>`,
        );
        break;
      }
      case "stopAgent":
        // Replacing the call's TwiML ends the stream; the recording, when it
        // must stop, is stopped over REST by the adapter (updateLiveCall).
        break;
      case "hangup":
        parts.push("<Hangup/>");
        break;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join("")}</Response>`;
}
