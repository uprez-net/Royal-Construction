import { createHmac, timingSafeEqual } from "node:crypto";

// Kept free of prisma, next/* and workflow imports so tests can load it directly.
//
// A workflow run id alone is not an authorization: /api/resume-stream streams
// whatever run it is given. The routes that start a run hand the client this
// capability instead — `<runId>.<userId>.<hmac>` — and resume-stream only opens
// the stream for the user it was issued to.

export const RUN_CAPABILITY_SECRET_ENV = "WORKFLOW_RUN_CAPABILITY_SECRET";

// The token travels as one URL path segment, so neither id may carry "/" or
// anything that needs encoding. The user id may not carry "." either: the token
// is split from the right, which is what lets a tagged run id (`wrun_ABC.tag`)
// keep its dot.
const RUN_ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const USER_ID = /^[A-Za-z0-9_-]+$/;

// A signed-in user can read their own capability, which hands them a message
// and its MAC. A short or guessable secret is then a matter of offline compute,
// after which they can mint a capability for anyone's run. So a weak value is
// treated as no value: the callers already refuse to start a run without one,
// and refusing is better than streaming someone else's run.
//
// Counted in characters, not bytes: 32 random bytes are what we ask for, and
// they arrive base64-encoded as 44 characters (`openssl rand -base64 32`). A
// 32-character floor accepts that and every stronger encoding of it, while
// rejecting the hand-typed values this exists to catch.
export const RUN_CAPABILITY_SECRET_MIN_LENGTH = 32;

export function runCapabilitySecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env[RUN_CAPABILITY_SECRET_ENV]?.trim();
  if (!secret) {
    return null;
  }
  if (secret.length < RUN_CAPABILITY_SECRET_MIN_LENGTH) {
    console.error(
      `${RUN_CAPABILITY_SECRET_ENV} is set but too weak (${secret.length} characters, minimum ${RUN_CAPABILITY_SECRET_MIN_LENGTH}); treating it as unset. Generate one with: openssl rand -base64 32`,
    );
    return null;
  }
  return secret;
}

function mac(runId: string, userId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${runId}.${userId}`)
    .digest("base64url");
}

export function signRunCapability(
  { runId, userId }: { runId: string; userId: string },
  secret: string | null = runCapabilitySecret(),
): string {
  if (!secret) {
    throw new Error(`${RUN_CAPABILITY_SECRET_ENV} is not set`);
  }
  if (!RUN_ID.test(runId) || !USER_ID.test(userId)) {
    throw new Error("Cannot issue a run capability for this run or user id");
  }
  return `${runId}.${userId}.${mac(runId, userId, secret)}`;
}

/** The run id the token grants `userId`, or null when it grants nothing. */
export function verifyRunCapability(
  token: string,
  userId: string,
  secret: string | null = runCapabilitySecret(),
): string | null {
  if (!secret) return null;

  const hmacAt = token.lastIndexOf(".");
  if (hmacAt <= 0) return null;
  const userAt = token.lastIndexOf(".", hmacAt - 1);
  if (userAt <= 0) return null;

  const runId = token.slice(0, userAt);
  const tokenUserId = token.slice(userAt + 1, hmacAt);
  const hmac = token.slice(hmacAt + 1);
  if (!tokenUserId || tokenUserId !== userId || !hmac) return null;

  // Compared as text rather than decoded: base64url decoding tolerates a
  // non-canonical final character, which would let two spellings pass.
  const expected = Buffer.from(mac(runId, tokenUserId, secret));
  const given = Buffer.from(hmac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  return runId;
}
