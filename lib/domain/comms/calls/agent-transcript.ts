import { CallFlowStep } from "@prisma/client";

import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { CommsProviderName } from "../../ports/comms";
import type { DomainPrincipal } from "../../principal";
import { providerColumn } from "../shared";

// What Mili and the caller have said so far, kept on the call while she is
// still on the line.
//
// The whole transcript is written once more when her conversation ends
// (`call.agentEnded`), and that write is the one that counts. This one is the
// copy that survives when the ending is never written: the caller hangs up,
// the platform freezes the function before the session reports, and the
// report never lands (#605 — seven of ten calls lost everything she heard).
//
// Only while the call is still with her: once the conversation has ended or
// moved on, the final report owns the column, and a checkpoint arriving late
// must not overwrite it with less.

export type AgentTranscriptCheckpoint = {
  readonly callId: string;
  /** The carrier's id for the call; must agree with `callId`. */
  readonly providerCallId: string;
  readonly provider: CommsProviderName;
  /** "Caller: …" / "Mili: …" lines, as `formatVoiceAgentTranscript` makes. */
  readonly transcript: string;
};

/** True when the transcript was saved; false when the call has moved on. */
export async function checkpointAgentTranscript(
  principal: DomainPrincipal,
  input: AgentTranscriptCheckpoint,
  db: DomainDb,
): Promise<boolean> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the voice agent's own stream may record what was said on a call.",
    );
  }
  if (!input.transcript.trim()) return false;
  const { count } = await db.call.updateMany({
    data: { agentTranscript: input.transcript },
    where: {
      flowStep: CallFlowStep.AGENT,
      id: input.callId,
      provider: providerColumn(input.provider),
      providerCallId: input.providerCallId,
    },
  });
  return count > 0;
}
