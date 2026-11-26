import { defineDynamic } from "eve";
import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  cancelScheduledOwnerCall,
  getOwnerCall,
  isHermesSession,
  listScheduledOwnerCalls,
  ownerCallIdInput,
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
