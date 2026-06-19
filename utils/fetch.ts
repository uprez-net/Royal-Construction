export class FetchError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FetchError";
    this.status = status;
  }
}

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

export async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit, fallback: string, signal?: AbortSignal): Promise<FetchJsonResponse<T>> {
  const response = await fetch(input, { ...init, signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new FetchError(fetchErrorMessage(body, fallback), response.status);
  }

  return body as FetchJsonResponse<T>;
}