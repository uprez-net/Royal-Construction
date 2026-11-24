import { timingSafeEqual } from "node:crypto";
import { agentEffectsSecret } from "@/lib/cache/agent-effects-channel";
import {
  APPROVAL_EXPIRY_PRINCIPAL_ID,
  expiryWithdrawalText,
} from "@/lib/domain/agent/approvals";

// The wire between the app's approval-expiry cron and Eve (#617).
//
// An expired approval is withdrawn through eve itself, the same way the Cancel
// button withdraws one: a POST of `inputResponses` to the conversation. A cron
// has no Clerk session, so this one request shape is let through Eve's channel
// auth on the deployment's internal bearer. Shared by both ends, so the path,
// the credential and the exact body the auth will accept cannot drift apart.
//
// What the bearer can do is as narrow as the body check below: answer pending
// requests in a conversation with Cancel. It cannot send a message, approve
// anything (the approval response policy only accepts the session's owner),
// or reach any other route. Node-clean: Eve's bundle imports it.

export const APPROVAL_EXPIRY_SERVICE_HEADER = "x-guri-service";
// Also the principal eve records as answering: the stream's mark of an expiry.
export const APPROVAL_EXPIRY_SERVICE = APPROVAL_EXPIRY_PRINCIPAL_ID;

/** Most requests one cancellation may carry: one step's approvals and some. */
export const MAX_EXPIRY_RESPONSES = 50;

const SESSION_PATH = /^\/eve\/v1\/session\/([A-Za-z0-9_-]{1,128})\/?$/;

type Env = Readonly<Record<string, string | undefined>>;

/** The conversation endpoint on this deployment, for one session. */
export function eveSessionUrl(
  eveSessionId: string,
  env: Env = process.env,
): string | null {
  const origin =
    env.VERCEL_ENV === "preview" && env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : env.NEXT_PUBLIC_APP_URL?.trim();
  if (!origin || !SESSION_PATH.test(`/eve/v1/session/${eveSessionId}`))
    return null;
  try {
    return new URL(
      `/eve/v1/session/${eveSessionId}`,
      new URL(origin).origin,
    ).toString();
  } catch {
    return null;
  }
}

export type ExpiryResponse = {
  readonly optionId: "cancel";
  readonly requestId: string;
  readonly text: string;
};

export function expiryRequestBody(
  requests: readonly { requestId: string; toolName: string }[],
): { inputResponses: ExpiryResponse[] } {
  return {
    inputResponses: requests.map((request) => ({
      optionId: "cancel",
      requestId: request.requestId,
      text: expiryWithdrawalText(request.toolName),
    })),
  };
}

/**
 * What eve's answer to a withdrawal means. A 2xx withdrew it. A 409 whose code
 * is `session_not_active` is a conversation that already ended (the session
 * timeout is seven days): nothing is left to cancel and the change can never
 * run. Anything else, `session_not_ready` (retryable) included, is a failure
 * the next run retries.
 */
export function withdrawalOutcome(
  status: number,
  body: unknown,
): "withdrawn" | "session-ended" | "failed" {
  if (status >= 200 && status < 300) return "withdrawn";
  if (
    status === 409
    && body !== null
    && typeof body === "object"
    && (body as { code?: unknown }).code === "session_not_active"
  )
    return "session-ended";
  return "failed";
}

export function expiryRequestHeaders(
  env: Env = process.env,
): Record<string, string> | null {
  const secret = agentEffectsSecret(env);
  if (!secret) return null;
  const headers: Record<string, string> = {
    [APPROVAL_EXPIRY_SERVICE_HEADER]: APPROVAL_EXPIRY_SERVICE,
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return headers;
}

/** Whether the request says it is the expiry service. Says nothing about trust. */
export function claimsApprovalExpiryService(request: Request): boolean {
  return (
    request.headers.get(APPROVAL_EXPIRY_SERVICE_HEADER)
    === APPROVAL_EXPIRY_SERVICE
  );
}

function bearerMatches(authorization: string | null, env: Env): boolean {
  const secret = agentEffectsSecret(env);
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A body that only cancels pending requests, and nothing else. */
export function isCancelOnlyBody(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return false;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "inputResponses") return false;
  const responses = (body as { inputResponses: unknown }).inputResponses;
  if (
    !Array.isArray(responses)
    || responses.length === 0
    || responses.length > MAX_EXPIRY_RESPONSES
  )
    return false;
  return responses.every((response) => {
    if (
      response === null
      || typeof response !== "object"
      || Array.isArray(response)
    )
      return false;
    const entry = response as Record<string, unknown>;
    const allowed = new Set(["optionId", "requestId", "text"]);
    return (
      Object.keys(entry).every((key) => allowed.has(key))
      && entry.optionId === "cancel"
      && typeof entry.requestId === "string"
      && entry.requestId.length > 0
      && (entry.text === undefined
        || (typeof entry.text === "string" && entry.text.length <= 500))
    );
  });
}

/**
 * The conversation an authentic expiry request addresses, or null.
 *
 * Authentic means all of: the bearer matches, it is a POST to one
 * conversation's endpoint, and the body only cancels requests. Anything else
 * is null, and the caller falls through to ordinary sign-in.
 */
export async function verifyApprovalExpiryRequest(
  request: Request,
  env: Env = process.env,
): Promise<string | null> {
  if (!claimsApprovalExpiryService(request)) return null;
  if (request.method !== "POST") return null;
  if (!bearerMatches(request.headers.get("authorization"), env)) return null;
  let path: string;
  try {
    path = new URL(request.url).pathname;
  } catch {
    return null;
  }
  const match = SESSION_PATH.exec(path);
  if (!match) return null;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return isCancelOnlyBody(body) ? match[1]! : null;
}
