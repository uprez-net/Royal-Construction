import type { AgentSessionListItem } from "@/lib/domain/agent/sessions";

/**
 * Connection decisions for the operations workspace, kept apart from the
 * component so each rule can be pinned by a test.
 */

type SessionStatus = AgentSessionListItem["status"];

/**
 * A session Eve has ended. Sending to it returns `409 session_not_active`, and
 * Eve never replaces it on its own, so the workspace shows its history
 * read-only instead of mounting it as a live conversation.
 */
export function isTerminalSessionStatus(
  status: SessionStatus | undefined,
): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

export type SendFailure =
  /** Eve took the message; only the live stream failed to attach. */
  | "accepted"
  /** The session has ended; the message went nowhere. */
  | "closed"
  /** The message did not reach the agent. */
  | "failed";

/**
 * What a failed `send` actually means for the message.
 *
 * A first message creates its session and is accepted with it: Eve answers
 * `202` with the session id before the stream attaches, and `onSessionChange`
 * fires on that answer. If the stream is then refused, the turn is already
 * running — telling the operator it was not sent invites a resend that runs
 * the request twice. A follow-up gets no such benefit of the doubt: its session
 * was already registered, so a failure there means the message was refused.
 */
export function classifySendFailure({
  error,
  sessionBefore,
  sessionAfter,
}: {
  error: unknown;
  sessionBefore: string | null;
  sessionAfter: string | null;
}): SendFailure {
  if (errorCode(error) === "session_not_active") return "closed";
  if (sessionBefore === null && sessionAfter !== null) return "accepted";
  return "failed";
}

/** No stream event for this long, mid-turn, reads as a dropped connection. */
export const STALL_AFTER_MS = 90_000;

/**
 * A turn that has gone quiet for longer than any step takes.
 *
 * A specialist's progress is forwarded onto this stream, so a working turn is
 * never silent for a minute and a half. A turn waiting on an approval is
 * silent by design and is not a stall.
 */
export function isStalledTurn({
  busy,
  lastEventAt,
  now,
  pendingApprovals,
}: {
  busy: boolean;
  lastEventAt: number;
  now: number;
  pendingApprovals: number;
}): boolean {
  return busy && pendingApprovals === 0 && now - lastEventAt >= STALL_AFTER_MS;
}

/** Where an unsent message waits while the page reloads or moves on. */
export function draftStorageKey(sessionId: string | null): string {
  return `rc-agent-draft:${sessionId ?? "new"}`;
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("code" in error))
    return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}
