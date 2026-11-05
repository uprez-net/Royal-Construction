import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio's webhook signature (file 02, file 06 §6.2).
//
// X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + each POST param
// name+value, sorted by name)). The URL is the one Twilio was told to call,
// query string included — which is why the handler rebuilds it from the
// configured origin rather than trusting the Host header behind a proxy.
//
// Fails closed: no token, no header, a header of the wrong length is a
// rejection. The previous Auth Token is accepted during a rotation.

export const TWILIO_SIGNATURE_HEADER = "x-twilio-signature";

export function twilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
): string {
  const names = [...new Set(params.keys())].sort();
  let data = url;
  for (const name of names) {
    // A repeated name signs every value, in order, each with its name.
    for (const item of params.getAll(name)) data += name + item;
  }
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilioSignature(input: {
  readonly headers: Headers;
  readonly url: string;
  readonly params: URLSearchParams;
  readonly authTokens: readonly (string | null)[];
}): boolean {
  const presented = input.headers.get(TWILIO_SIGNATURE_HEADER)?.trim();
  if (!presented) return false;
  const actual = Buffer.from(presented, "base64");
  if (actual.length !== 20) return false;
  return input.authTokens.some((token) => {
    if (!token) return false;
    const expected = Buffer.from(twilioSignature(token, input.url, input.params), "base64");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}
