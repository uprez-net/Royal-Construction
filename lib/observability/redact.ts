// Strips client details out of text before it leaves for a third party.
//
// An error message here is often a provider's response body: a Graph failure
// echoes the recipient, a DocuSign one the signer. Those are a customer's
// email and phone number, and none of it is needed to fix the bug.
//
// This catches the structured identifiers. It cannot catch a free-text name or
// street address inside a message — that is why `dataCollection` is locked down and
// why context is built from ids, never from record contents.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// +61 / 0 then a 9-digit Australian number in any common grouping.
const AU_PHONE = /(?:\+61|\b0)[\s-]?[2-478](?:[\s-]?\d){8}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g;
const DATABASE_URL = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi;

export function redactText(text: string): string {
  return text
    .replace(DATABASE_URL, "[connection-string]")
    .replace(BEARER, "Bearer [token]")
    .replace(EMAIL, "[email]")
    .replace(AU_PHONE, "[phone]");
}

/** Redacts the string values one level deep, leaving everything else alone. */
export function redactRecord<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = typeof value === "string" ? redactText(value) : value;
  }
  return out as T;
}
