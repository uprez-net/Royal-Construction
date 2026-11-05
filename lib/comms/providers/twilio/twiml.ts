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

export function renderTwiml(
  instructions: readonly CallInstruction[] | null,
  context: { readonly origin: string; readonly callId: string | null },
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
      case "hangup":
        parts.push("<Hangup/>");
        break;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join("")}</Response>`;
}
