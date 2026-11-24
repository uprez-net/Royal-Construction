import type { z } from "zod";

// Why a specialist's final answer was refused (#619).
//
// In production, 19 of 148 specialist turns took three or four model steps
// after their last tool result instead of two: eve rejected the `final_output`
// call against the output schema and asked again, 17-39 s each time. The
// event log never said why, because eve keeps `final_output` out of the
// action events. Its arguments do stream as `action.input.appended` deltas,
// so the persistence hook rebuilds each attempt and checks it against the
// same schema.
//
// Only where and what kind: the field path, Zod's issue code and its message.
// Never the value, which is client data.

/** The tool eve gives a structured-output turn. */
export const FINAL_OUTPUT_TOOL_NAME = "final_output";

/** The event type a diagnostic row is stored under in AgentSessionEvent. */
export const FINAL_OUTPUT_DIAGNOSTIC_EVENT = "diagnostic.final_output_invalid";

export type FinalOutputIssue = {
  readonly path: string;
  readonly code: string;
  readonly message: string;
};

const MAX_ISSUES = 10;
const MAX_MESSAGE = 200;

/**
 * The issues with one attempted final answer, or none. An attempt that is not
 * JSON at all (truncated, or prose) is one issue at the root.
 */
export function finalOutputIssues(
  inputText: string,
  schema: z.ZodType,
): FinalOutputIssue[] {
  let value: unknown;
  try {
    value = JSON.parse(inputText);
  } catch {
    return [
      {
        code: "invalid_json",
        message: `The answer was not complete JSON (${inputText.length} characters).`,
        path: "",
      },
    ];
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.slice(0, MAX_ISSUES).map((issue) => ({
    code: issue.code,
    message: issue.message.slice(0, MAX_MESSAGE),
    path: issue.path.map(String).join("."),
  }));
}
