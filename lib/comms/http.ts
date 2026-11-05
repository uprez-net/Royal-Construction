import { CommsError } from "@/lib/domain/ports/comms";

// One carrier REST call, classified (file 06 §3.2).
//
//   2xx                    → the parsed body
//   4xx other than 429     → `rejected`: the carrier refused, nothing happened
//   429, 5xx, timeout,     → `uncertain`: it may have happened; never retried
//   reset after sending
//   never connected        → `rejected`: nothing left this server
//
// No automatic retries anywhere: a retry is how a customer gets two texts.

export type Fetch = typeof fetch;

export const CARRIER_TIMEOUT_MS = 15_000;

/** Socket errors that mean the request never left this server. */
const UNREACHABLE = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_INVALID_URL",
]);

function causeCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

export type CarrierResponse = {
  readonly status: number;
  readonly text: string;
  readonly json: unknown;
};

export async function carrierRequest(
  fetchImpl: Fetch,
  request: {
    readonly provider: "TWILIO" | "TELNYX";
    readonly method: "GET" | "POST" | "DELETE";
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
    /** What a log line or an operator message calls this call. */
    readonly what: string;
    readonly timeoutMs?: number;
  },
  /** Pull the carrier's own error code and message out of an error body. */
  describe: (json: unknown) => { code: string | null; message: string | null },
): Promise<CarrierResponse> {
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      body: request.body,
      headers: request.headers,
      method: request.method,
      signal: AbortSignal.timeout(request.timeoutMs ?? CARRIER_TIMEOUT_MS),
    });
  } catch (error) {
    const code = causeCode(error);
    if (code && UNREACHABLE.has(code)) {
      throw new CommsError(
        `The phone provider couldn't be reached, so nothing was sent (${request.what}).`,
        "rejected",
        `${request.provider}_UNREACHABLE`,
      );
    }
    throw new CommsError(
      `The phone provider didn't answer in time (${request.what}); it may or may not have acted.`,
      "uncertain",
      `${request.provider}_TIMEOUT`,
    );
  }
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (response.ok) return { json, status: response.status, text };

  const described = describe(json);
  const providerCode = `${request.provider}_${described.code ?? `HTTP_${response.status}`}`;
  const definite =
    response.status >= 400 && response.status < 500 && response.status !== 429;
  throw new CommsError(
    definite
      ? `The phone provider refused ${request.what}${described.message ? `: ${described.message}` : "."}`
      : `The phone provider failed while handling ${request.what} (HTTP ${response.status}); it may or may not have acted.`,
    definite ? "rejected" : "uncertain",
    providerCode,
    response.status,
  );
}

/** Read at most `maxBytes` of a body, or throw a definite refusal. */
export async function readCapped(
  response: Response,
  maxBytes: number,
  provider: "TWILIO" | "TELNYX",
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new CommsError(
      "The recording is larger than the app keeps.",
      "rejected",
      `${provider}_TOO_LARGE`,
    );
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new CommsError(
      "The recording is larger than the app keeps.",
      "rejected",
      `${provider}_TOO_LARGE`,
    );
  }
  return buffer;
}
