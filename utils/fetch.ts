export function fetchErrorMessage(responseBody: unknown, fallback: string) {
  if (responseBody && typeof responseBody === "object" && "error" in responseBody) {
    const message = (responseBody as { error?: unknown }).error;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

export async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(fetchErrorMessage(body, fallback));
  }

  return body as T;
}