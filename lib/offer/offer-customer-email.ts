const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Placeholder addresses that must never receive a real envelope/email. The
// workspace job seeds clientEmail with a sample value; if it is never replaced
// with the lead's real address, sends would silently go nowhere.
const PLACEHOLDER_EMAILS = new Set([
  "client@example.com",
  "example@example.com",
]);

function isSendable(email: string | null | undefined): email is string {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  return (
    trimmed.length > 0 &&
    EMAIL_RE.test(trimmed) &&
    !PLACEHOLDER_EMAILS.has(trimmed)
  );
}

// Resolve the customer email for a tender/contract send. An explicit override
// wins (a deliberate per-send choice), then the workspace job email (what the
// operator reviewed on screen), then the lead record — and rejects
// blanks/placeholders so a DocuSign envelope is never generated against an
// address that cannot receive it. Returns null when no valid address exists.
export function resolveOfferCustomerEmail(input: {
  jobEmail?: string | null;
  leadEmail?: string | null;
  overrideEmail?: string | null;
}): string | null {
  const candidates = [input.overrideEmail, input.jobEmail, input.leadEmail];
  for (const candidate of candidates) {
    if (isSendable(candidate)) {
      return candidate.trim();
    }
  }
  return null;
}
