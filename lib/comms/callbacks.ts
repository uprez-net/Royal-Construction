import type { CommsProviderName } from "@/lib/domain/ports/comms";

// The only function that builds a carrier callback URL (file 06 §5.1).
//
// A signature covers the exact URL, so it is built from the configured
// origin — never from request headers — and the webhook handler rebuilds the
// URL it verifies the same way. Callback URLs carry Royal's own call id
// (`?callId=`) so a callback binds to a CRM row whatever the carrier's ids.

export function commsCallbackUrl(
  origin: string,
  provider: CommsProviderName,
  event: string,
  params: Record<string, string | null | undefined> = {},
): string {
  const url = new URL(`/api/comms/${provider}/${event}`, origin);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** The URL a carrier signed, for a request that reached this deployment. */
export function signedUrlFor(origin: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${origin}${url.pathname}${url.search}`;
}
