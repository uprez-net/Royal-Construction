export class FetchError extends Error {
  status: number;
  /**
   * The parsed response body, when the server sent one. A non-ok status often
   * carries the detail worth showing the user, and throwing away the body left
   * callers with nothing but a generic fallback message.
   */
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "FetchError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Extract an error message from a response body object if present, otherwise return a fallback.
 * @param responseBody - parsed response body which may contain an `error` property
 * @param fallback - fallback message to use when no error is present
 * @returns extracted error message or the fallback
 */
export function fetchErrorMessage(responseBody: unknown, fallback: string) {
  if (
    responseBody
    && typeof responseBody === "object"
    && "error" in responseBody
  ) {
    const message = (responseBody as { error?: unknown }).error;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}
interface FetchJsonResponse<T> {
  data: T;
  success: boolean;
  timestamp: string;
  meta?: Record<string, unknown>;
}

/**
 * Perform a fetch expecting a JSON API response shaped as `{ data, success, timestamp }`.
 * Throws a human-friendly error when the response is not ok.
 * @template T - expected `data` type inside the JSON response
 * @param input - fetch input (url or Request)
 * @param init - fetch init options
 * @param fallback - fallback error message when response body does not contain one
 * @param signal - optional AbortSignal
 * @returns parsed JSON response
 */
export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  fallback: string,
  signal?: AbortSignal,
): Promise<FetchJsonResponse<T>> {
  const response = await fetch(input, { ...init, signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new FetchError(
      fetchErrorMessage(body, fallback),
      response.status,
      body,
    );
  }

  return body as FetchJsonResponse<T>;
}
