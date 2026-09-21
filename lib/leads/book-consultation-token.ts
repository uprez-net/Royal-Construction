import { createHmac, timingSafeEqual } from "node:crypto";

// Short-lived proof that a public booking link was issued for a specific lead.
// Without this, a caller-supplied numeric id is treated as authorisation.

export const BOOK_CONSULTATION_TOKEN_SECRET_ENV =
  "BOOK_CONSULTATION_TOKEN_SECRET";

/** Booking links in emails may sit unread for weeks. */
const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export const BOOK_CONSULTATION_TOKEN_MIN_SECRET_LENGTH = 32;

export function bookConsultationTokenSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env[BOOK_CONSULTATION_TOKEN_SECRET_ENV]?.trim();
  if (!secret) {
    return null;
  }
  if (secret.length < BOOK_CONSULTATION_TOKEN_MIN_SECRET_LENGTH) {
    console.error(
      `${BOOK_CONSULTATION_TOKEN_SECRET_ENV} is set but too weak (${secret.length} characters, minimum ${BOOK_CONSULTATION_TOKEN_MIN_SECRET_LENGTH}); treating it as unset.`,
    );
    return null;
  }
  return secret;
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Returns null when the secret is not configured. */
export function signBookConsultationToken(
  leadId: number,
  secret: string | null = bookConsultationTokenSecret(),
): string | null {
  if (!secret || !Number.isSafeInteger(leadId) || leadId <= 0) {
    return null;
  }
  const exp = Math.floor((Date.now() + TOKEN_TTL_MS) / 1000);
  const payload = `${leadId}.${exp}`;
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyBookConsultationToken(
  token: string,
  leadId: number,
  secret: string | null = bookConsultationTokenSecret(),
): boolean {
  if (!secret || !Number.isSafeInteger(leadId) || leadId <= 0) {
    return false;
  }
  const trimmed = token.trim();
  const sigAt = trimmed.lastIndexOf(".");
  if (sigAt <= 0) return false;
  const payload = trimmed.slice(0, sigAt);
  const sig = trimmed.slice(sigAt + 1);
  const parts = payload.split(".");
  if (parts.length !== 2) return false;
  const tokenLeadId = Number(parts[0]);
  const exp = Number(parts[1]);
  if (tokenLeadId !== leadId || !Number.isFinite(exp)) return false;
  if (exp * 1000 < Date.now()) return false;

  const expected = mac(payload, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
