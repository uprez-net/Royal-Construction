import { z } from "zod";

import type { CallInstruction } from "@/lib/domain/ports/comms";

// Telnyx echoes a command's `client_state` (base64) on later events for that
// call. Royal uses it to know which leg an event is about and what to do once
// an asynchronous command (speech, a recording) finishes.
//
// It is a hint, never authorisation: the event's signature is what makes it
// trustworthy, and the call is still looked up by Royal's own id.
//
//   c  Royal's Call.id
//   r  "a" — the customer's leg; "b" — a staff leg created by a transfer
//   a  the customer leg's call_control_id (on a staff leg)
//   rec  record the conversation once the staff leg answers
//   n  instructions to run when the current asynchronous command ends

const instruction: z.ZodType<CallInstruction> = z.union([
  z.object({ op: z.literal("say"), text: z.string().max(1000) }),
  z.object({
    numDigits: z.number().int().min(1).max(10),
    op: z.literal("gatherDigits"),
    prompt: z.string().max(1000),
    timeoutSeconds: z.number().int().min(1).max(60),
  }),
  z.object({
    callerId: z.string().max(40),
    identities: z.array(z.string().max(80)).max(10),
    op: z.literal("dialBrowser"),
    record: z.boolean(),
    timeoutSeconds: z.number().int().min(1).max(120),
  }),
  z.object({
    callerId: z.string().max(40),
    op: z.literal("dialNumber"),
    record: z.boolean(),
    timeoutSeconds: z.number().int().min(1).max(120),
    to: z.string().max(40),
  }),
  z.object({
    maxSeconds: z.number().int().min(1).max(600),
    op: z.literal("recordVoicemail"),
  }),
  z.object({ op: z.literal("hangup") }),
]);

const schema = z.object({
  a: z.string().max(200).optional(),
  c: z.string().max(64).optional(),
  n: z.array(instruction).max(6).optional(),
  r: z.enum(["a", "b"]),
  rec: z.literal(1).optional(),
});

export type TelnyxClientState = z.infer<typeof schema>;

export function encodeClientState(state: TelnyxClientState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64");
}

export function decodeClientState(raw: unknown): TelnyxClientState | null {
  if (typeof raw !== "string" || !raw || raw.length > 8_000) return null;
  try {
    const parsed = schema.safeParse(
      JSON.parse(Buffer.from(raw, "base64").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
