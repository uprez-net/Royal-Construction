// The reference a tradie's reply is matched on.
//
// Tradies answer by hitting Reply, so the subject comes back as "Re: …" with
// whatever we put in it. Before this, a reply was matched by sender alone and
// then guessed among that tradie's open bookings from a date and an address a
// model read out of the reply — and a tradie with two open requests saying
// "Yes, $4,800" was ambiguous every time.
//
// Two kinds, because two kinds of email go out:
//
//   - RCTRQ: one tradie's copy of a request (quote or booking). It names every
//     booking that email asked about.
//   - RCTBK: one booking. Reminders, reschedules and the week-out confirmation
//     are about one booking, so a reply to them names exactly that one.
//
// Pure and dependency-free: the email templates render it in the browser
// preview, and the webhook and the commands read it on the server.

export const TRADIE_REQUEST_REF_PREFIX = "RCTRQ";
export const TRADIE_BOOKING_REF_PREFIX = "RCTBK";

export type TradieRefKind = "request" | "booking";

/**
 * Shown in the request wizard's preview, where each tradie's real reference is
 * not minted until the request is sent.
 */
export const TRADIE_REF_PREVIEW = `${TRADIE_REQUEST_REF_PREFIX}-XXXXXXXXXXXX`;

/**
 * Case-insensitive, for the same reason the certifier and party tokens are:
 * mail clients and ticketing systems lower-case subjects, and a cosmetic
 * change must not orphan the reply.
 */
const TRADIE_REF_RE = /\b(RCT(?:RQ|BK)-[0-9A-F]{12})\b/i;

/**
 * A fresh reference. Six random bytes, matching the other mail tokens: not a
 * secret — it is in a subject line — only unguessable enough that two live
 * threads never collide. Web Crypto, so this module stays importable anywhere.
 */
export function generateTradieRefToken(kind: TradieRefKind): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${kind === "request" ? TRADIE_REQUEST_REF_PREFIX : TRADIE_BOOKING_REF_PREFIX}-${hex}`;
}

/**
 * The first reference found, upper-cased, or null. The subject is read first:
 * it is the one place we wrote, and a body can quote an older thread's.
 */
export function extractTradieRefToken(
  ...texts: readonly (string | null | undefined)[]
): string | null {
  for (const text of texts) {
    const match = text ? TRADIE_REF_RE.exec(text) : null;
    if (match) return match[1].toUpperCase();
  }
  return null;
}

export function tradieRefKind(token: string): TradieRefKind | null {
  const prefix = token.split("-")[0]?.toUpperCase();
  return prefix === TRADIE_REQUEST_REF_PREFIX
    ? "request"
    : prefix === TRADIE_BOOKING_REF_PREFIX
      ? "booking"
      : null;
}

/**
 * The subject with the reference on the end, once. At the end rather than the
 * front, unlike the compliance tokens: a tradie scans their inbox by project
 * and trade, and those should read first.
 */
export function subjectWithTradieRef(
  subject: string,
  token: string | null | undefined,
): string {
  const trimmed = subject.trim();
  if (!token) return trimmed;
  return trimmed.toUpperCase().includes(token.toUpperCase())
    ? trimmed
    : `${trimmed} [${token}]`;
}
