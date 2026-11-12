// Spoken and typed answers to an approval, for the surfaces with no buttons.
//
// In the /agent workspace an approval is two buttons. Over MCP it is an
// `input_required` invocation that the client must answer through
// `agent_update` with `optionId: "approve" | "cancel"`. A person talking to a
// hosted client does not say an option id: they say "yeah go ahead" or "no,
// hold off". The client passes those words through as `text`, and eve reads
// an approval answer with no option id as invalid and denies the call — so a
// spoken yes used to cancel the very thing the person approved.
//
// This module decides what such words mean, and refuses to guess: only an
// answer that is clearly yes or clearly no becomes a decision. Anything else
// goes back to the person as a question. A wrongly approved client email is
// the expensive mistake here; asking twice is not.

export type VerbalDecision = "approve" | "reject" | "unclear";

/** Phrases containing "no" that are not a refusal. */
const NOT_A_REFUSAL = [
  /\bno (?:problem|worries|dramas|issues?|probs)\b/g,
  /\bnot a problem\b/g,
  /\bwhy not\b/g,
  /\bno doubt\b/g,
];

const REFUSALS = [
  /\bno+\b/,
  /\bnope\b/,
  /\bnah\b/,
  /\bdon'?t\b/,
  /\bdo not\b/,
  /\bdoesn'?t\b/,
  /\bnot (?:now|yet|today|this|that|it|approved?)\b/,
  /\bcancel(?:led|ed)?\b/,
  /\breject(?:ed)?\b/,
  /\bdecline[d]?\b/,
  /\bdeny\b|\bdenied\b/,
  /\bstop\b/,
  /\babort\b/,
  /\bhold (?:off|on)\b/,
  /\bwait\b/,
  /\bnever ?mind\b/,
  /\bscrap (?:it|that)\b/,
  /\bnegative\b/,
  /\bleave it\b/,
  /👎|❌|🚫/u,
];

const APPROVALS = [
  /\by(?:es|ep|eah|up|ea|a)\b/,
  /\baye\b/,
  /\bapprove[ds]?\b/,
  /\bgo ahead\b/,
  /\bgo for it\b/,
  /\bdo it\b/,
  /\bdo that\b/,
  /\bconfirm(?:ed)?\b/,
  /\bok(?:ay)?\b|\bk\b/,
  /\bsure\b/,
  /\bproceed\b/,
  /\bsend (?:it|that)\b/,
  /\bsounds good\b/,
  /\blooks good\b/,
  /\blgtm\b/,
  /\babsolutely\b/,
  /\bplease do\b/,
  /\baffirmative\b/,
  /\ball good\b/,
  /\bthat'?s (?:fine|right|correct)\b/,
  /\bcorrect\b/,
  /\bperfect\b/,
  /\bgood to go\b/,
  /\bship it\b/,
  /\bon you go\b/,
  /👍|✅|👌/u,
];

/** What a person's answer to "approve this?" means. Pure. */
export function classifyVerbalDecision(text: string): VerbalDecision {
  let normalized = text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "unclear";
  for (const phrase of NOT_A_REFUSAL)
    normalized = normalized.replace(phrase, " ");

  const refuses = REFUSALS.some((pattern) => pattern.test(normalized));
  const approves = APPROVALS.some((pattern) => pattern.test(normalized));
  if (refuses && approves) return "unclear";
  if (refuses) return "reject";
  if (approves) return "approve";
  return "unclear";
}

export type PendingInputRequest = {
  requestId: string;
  kind: string;
  options?: readonly { id: string; label: string }[];
  allowFreeform?: boolean;
  prompt?: string;
  action?: { toolName?: string; input?: Record<string, unknown> };
};

export type InputResponse = {
  requestId: string;
  optionId?: string;
  text?: string;
};

/** The option each request kind uses for yes and for no. */
const DECISION_OPTIONS: Readonly<
  Record<string, { approve: string; reject: string }>
> = {
  "session-limit": { approve: "continue", reject: "stop" },
  "tool-approval": { approve: "approve", reject: "cancel" },
};

function matchOption(
  text: string,
  options: readonly { id: string; label: string }[] | undefined,
): string | null {
  const answer = text.trim().toLowerCase();
  const match = options?.find(
    (option) =>
      option.id.toLowerCase() === answer
      || option.label.toLowerCase() === answer,
  );
  return match?.id ?? null;
}

/**
 * Turn words into option ids where the words are unambiguous.
 *
 * A response that already carries an option id, answers a question (whose
 * text is the answer), or names a request we were not shown, passes through
 * untouched. `unclear` lists the decisions that could not be read, so the
 * caller can refuse the whole update instead of letting eve deny them.
 */
export function interpretVerbalResponses(
  responses: readonly InputResponse[],
  pending: Readonly<Record<string, PendingInputRequest>>,
): { responses: InputResponse[]; unclear: InputResponse[] } {
  const unclear: InputResponse[] = [];
  const interpreted = responses.map((response) => {
    if (response.optionId || typeof response.text !== "string") return response;
    const request = pending[response.requestId];
    const options = request ? DECISION_OPTIONS[request.kind] : undefined;
    if (!request || !options) return response;

    const exact = matchOption(response.text, request.options);
    if (exact) return { ...response, optionId: exact };
    const decision = classifyVerbalDecision(response.text);
    if (decision === "unclear") {
      unclear.push(response);
      return response;
    }
    return {
      ...response,
      optionId: decision === "approve" ? options.approve : options.reject,
    };
  });
  return { responses: interpreted, unclear };
}

/** True when any response is words-only and might need reading. */
export function hasWordsOnlyResponse(responses: readonly InputResponse[]) {
  return responses.some(
    (response) => !response.optionId && typeof response.text === "string",
  );
}

const ID_FIELD = /(^id$|Id$|Ids$)/;
const MAX_DETAIL_FIELDS = 8;

function humanizeToolName(toolName: string) {
  const words = toolName.replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describeValue(value: unknown): string | null {
  if (value === null) return "cleared";
  if (typeof value === "string") {
    const flat = value.replace(/\s+/g, " ").trim();
    return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return null;
}

/** The non-id facts of a tool input, one level of nesting deep. */
function inputDetails(input: Record<string, unknown>): string[] {
  const details: string[] = [];
  const visit = (record: Record<string, unknown>, prefix: string) => {
    for (const [field, value] of Object.entries(record)) {
      if (details.length >= MAX_DETAIL_FIELDS) return;
      if (ID_FIELD.test(field) || field.startsWith("expected")) continue;
      if (
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && !prefix
      ) {
        visit(value as Record<string, unknown>, `${field}.`);
        continue;
      }
      const described = describeValue(value);
      if (described !== null && described !== "") {
        details.push(`${prefix}${field}: ${described}`);
      }
    }
  };
  visit(input, "");
  return details;
}

/**
 * An approval prompt a person can say yes or no to.
 *
 * eve's own prompt is "Approve tool call: update_lead" with the raw input
 * beside it — ids and all. This names the records (labels come from
 * describeApprovalTargets, which looks them up under the caller's own access
 * rules, never from the model), lists what changes, and says how to answer.
 */
export function describeApprovalPrompt(
  toolName: string,
  input: Record<string, unknown> | undefined,
  labels: Readonly<Record<string, string>>,
): string {
  const targets = Object.values(labels);
  const details = input ? inputDetails(input) : [];
  return [
    `Approve "${humanizeToolName(toolName)}"${targets.length ? ` for ${targets.join("; ")}` : ""}?`,
    details.length ? `Details — ${details.join("; ")}.` : null,
    'Answer approve or cancel; a plain "yes, go ahead" or "no" is understood. Anything less clear is asked again rather than guessed.',
  ]
    .filter(Boolean)
    .join(" ");
}
