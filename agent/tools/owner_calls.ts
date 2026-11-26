import { defineDynamic } from "eve";
import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  cancelScheduledOwnerCall,
  getHandoff,
  getOwnerCall,
  handoffIdInput,
  isHermesSession,
  listHandoffs,
  listScheduledOwnerCalls,
  ownerCallIdInput,
  resolveHandoff,
  resolveHandoffInput,
  scheduleOwnerCall,
  scheduleOwnerCallInput,
} from "@/agent/lib/owner-calls";

/**
 * Mili ringing the business owner, for Hermes only.
 *
 * Hermes — the owner's assistant on its own server — connects to this agent
 * over MCP and sends HERMES_MCP_SECRET, which marks its session
 * (agent/lib/mcp-auth-policy.ts). These tools are offered on a turn from such
 * a session and on no other: the office's own sessions never see them. Each
 * tool checks the mark again before running (agent/lib/owner-calls.ts).
 *
 * After each call Royal sends Hermes a post-call handoff: what the owner
 * asked for on it (lib/domain/comms/calls/owner-call-handoff.ts). Hermes
 * schedules the callback with its handoff_id, or resolves it, and can list
 * the ones still outstanding if a delivery never reached it.
 *
 * Resolved per turn because the caller is: `auth.current` is replaced on
 * every turn, so a session Hermes started is not a Hermes session on a turn
 * somebody else sends.
 */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      isHermesSession(ctx)
        ? {
            schedule_owner_call: defineTool({
              description: [
                "Have Mili, Royal Constructions' voice assistant, ring the business owner's own phone and brief them by voice: now, or at call_at.",
                "Mili opens with the category, covers the agenda in order, and answers follow-up questions from the context; a question the context does not answer is passed back to Hermes on the call. The call is recorded and transcribed.",
                "Only one call to the owner runs at a time; a scheduled call that finds Mili busy waits for her, for up to 30 minutes. Returns owner_call_id; retrying with the same idempotency_key never rings twice.",
                "For the callback a post-call handoff asks for, pass its handoff_id: that resolves the handoff, and a handoff gets one callback. Read it back with get_owner_call to check it was scheduled.",
                "Call this tool directly. Do not delegate it.",
              ].join(" "),
              inputSchema: scheduleOwnerCallInput,
              label: { start: () => "Scheduling Mili's call to the owner" },
              execute: (input, toolCtx) => scheduleOwnerCall(input, toolCtx),
            }),
            get_owner_call: defineTool({
              description:
                "Where an owner call stands: scheduled, placing, placed, canceled or failed (with why). Once placed: the call's status, whether the owner picked up, how long it ran, and the transcript.",
              inputSchema: ownerCallIdInput,
              label: { start: () => "Checking Mili's call to the owner" },
              execute: (input, toolCtx) => getOwnerCall(input, toolCtx),
            }),
            cancel_owner_call: defineTool({
              description:
                "Cancel a scheduled owner call before it rings. Refused once it has rung.",
              inputSchema: ownerCallIdInput,
              label: { start: () => "Cancelling Mili's call to the owner" },
              execute: (input, toolCtx) =>
                cancelScheduledOwnerCall(input, toolCtx),
            }),
            list_owner_call_handoffs: defineTool({
              description:
                "The post-call handoffs still outstanding: calls that ended with something for you (a callback with the details, something to do), not yet resolved, oldest first. Includes ones Royal failed to deliver to you.",
              inputSchema: z.object({}),
              label: {
                start: () => "Listing what Mili's calls left for Hermes",
              },
              execute: (_input, toolCtx) => listHandoffs(toolCtx),
            }),
            get_owner_call_handoff: defineTool({
              description:
                "One post-call handoff: the call, whether the owner picked up, each request they made (call_back, timing in their words), the transcript, and whether it is resolved.",
              inputSchema: handoffIdInput,
              label: {
                start: () => "Reading what Mili's call left for Hermes",
              },
              execute: (input, toolCtx) => getHandoff(input, toolCtx),
            }),
            resolve_owner_call_handoff: defineTool({
              description:
                "Mark a post-call handoff dealt with when no callback is needed: answered another way, done, or the owner said never mind. For a callback, use schedule_owner_call with handoff_id instead.",
              inputSchema: resolveHandoffInput,
              label: { start: () => "Resolving a post-call handoff" },
              execute: (input, toolCtx) => resolveHandoff(input, toolCtx),
            }),
            list_owner_calls: defineTool({
              description:
                "The owner calls still to ring (soonest first), and the most recent that rang, failed or were cancelled.",
              inputSchema: z.object({}),
              label: { start: () => "Listing Mili's calls to the owner" },
              execute: (_input, toolCtx) => listScheduledOwnerCalls(toolCtx),
            }),
          }
        : null,
  },
});
