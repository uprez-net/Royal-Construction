/**
 * Extract an error message from a response body object if present, otherwise return a fallback.
 * @param responseBody - parsed response body which may contain an `error` property
 * @param fallback - fallback message to use when no error is present
 * @returns extracted error message or the fallback
 */
export function fetchErrorMessage(responseBody: unknown, fallback: string) {
  if (responseBody && typeof responseBody === "object" && "error" in responseBody) {
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
export async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit, fallback: string, signal?: AbortSignal): Promise<FetchJsonResponse<T>> {
  const response = await fetch(input, { ...init, signal });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(fetchErrorMessage(body, fallback));
  }

  return body as FetchJsonResponse<T>;
}