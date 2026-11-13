import { defineDynamic, defineInstructions } from "eve/instructions";

/**
 * What a specialist does after the person presses Cancel on its approval.
 *
 * eve hands the model only `TOOL_EXECUTION_DENIED: "Tool execution was
 * denied."`. On staging the lead specialist read that as the system refusing,
 * reported the stage change as "denied by the system", invented a business
 * rule to explain it ("manual stage moves aren't allowed while an offer drives
 * the stage" — there is no such rule), and spent another twenty seconds
 * re-reading the lead first (#429). The orchestrator relayed both inventions to
 * the office.
 *
 * eve resumes a specialist in a new turn once its approval settles, so a
 * `turn.started` resolver sees the denied result in history and can say
 * plainly what happened. `delegate` then replaces the wording of a result
 * marked `data.cancelled` with fixed text (`cancelledChangeResult` in
 * agent/lib/team-dispatch.ts, which has to stay free of eve imports), so what
 * the office reads does not depend on the model's phrasing either.
 */

export const APPROVAL_DENIED_CODE = "TOOL_EXECUTION_DENIED";

type MessageLike = { role?: unknown; content?: unknown };

function partsOf(message: MessageLike): unknown[] {
  return Array.isArray(message.content) ? message.content : [];
}

function deniedToolName(part: unknown): string | null {
  if (part === null || typeof part !== "object") return null;
  const candidate = part as { type?: unknown; toolName?: unknown };
  if (candidate.type !== "tool-result") return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(part);
  } catch {
    return null;
  }
  if (!serialized.includes(APPROVAL_DENIED_CODE)) return null;
  return typeof candidate.toolName === "string" ? candidate.toolName : "change";
}

/**
 * The tool whose approval the person cancelled since the request arrived, or
 * null. Only results after the last user message count: that message is the
 * task this specialist session was given.
 */
export function findCancelledApproval(
  messages: readonly MessageLike[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user") return null;
    if (message.role !== "tool") continue;
    for (const part of partsOf(message)) {
      const name = deniedToolName(part);
      if (name) return name;
    }
  }
  return null;
}

export function cancelledApprovalInstructions(toolName: string): string {
  return [
    "## The person cancelled this change",
    `The person pressed Cancel on the approval for ${toolName}. That was their decision — the system did not reject anything, and no rule stopped it. Nothing was changed.`,
    "- Do not call any tool, and do not try the change another way.",
    '- Finish now with kind "confirmation", title "Cancelled — nothing changed", data { "cancelled": true, "change": "<the change, in a few plain words>" }, and a one-sentence summary saying they cancelled it and nothing was changed.',
    "- Give no reason for the cancellation and state no business rule.",
  ].join("\n");
}

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const toolName = findCancelledApproval(
        (ctx as { messages?: readonly MessageLike[] }).messages ?? [],
      );
      return toolName
        ? defineInstructions({
            content: cancelledApprovalInstructions(toolName),
          })
        : null;
    },
  },
});
