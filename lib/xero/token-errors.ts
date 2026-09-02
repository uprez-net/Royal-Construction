/**
 * Whether Xero rejected the refresh token itself, as opposed to failing to
 * answer.
 *
 * This distinction decides whether a failed refresh tears the connection down.
 * `invalid_grant` is terminal — the token was revoked, or went 60 days unused
 * and Xero dropped it — and a person has to re-consent. Everything else (a 429,
 * a 5xx, a dropped socket) is transient, and deactivating on it would be
 * self-inflicted: one blip would take the organisation offline and demand a
 * manual reconnect for a fault that would have cleared by itself.
 *
 * `refreshWithRefreshToken` posts through axios, so a non-2xx surfaces as an
 * error carrying the parsed OAuth error body — `{ error: "invalid_grant" }` per
 * RFC 6749 — on `response.data`. Some gateways hand that back as text instead.
 */
export function isInvalidGrant(error: unknown): boolean {
  const data = (error as { response?: { data?: unknown } })?.response?.data;

  if (typeof data === "string") {
    return data.includes("invalid_grant");
  }

  return (data as { error?: string } | undefined)?.error === "invalid_grant";
}
