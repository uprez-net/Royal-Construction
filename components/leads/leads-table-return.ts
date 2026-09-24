import { useMemo, useSyncExternalStore } from "react";

/**
 * Where the Leads table was, so coming back from a lead's detail page lands on
 * the same page with the same filters instead of page 1 (issue #350).
 *
 * Per browser tab (sessionStorage), because it is somebody's place in a list,
 * not shared state. It is only the fallback: an explicit `?status=` or
 * `?query=` link to /leads still wins. Page 4 is only meaningful with the
 * filters it was page 4 of, so they travel together.
 */
export type LeadsTableReturn = {
  readonly page: number;
  readonly query: string;
  readonly metric: string | null;
  readonly filterTiming: string;
};

const STORAGE_KEY = "leads:table-return";

function isLeadsTableReturn(value: unknown): value is LeadsTableReturn {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isInteger(v.page)
    && (v.page as number) >= 1
    && typeof v.query === "string"
    && (v.metric === null || typeof v.metric === "string")
    && typeof v.filterTiming === "string"
  );
}

export function parseLeadsTableReturn(
  raw: string | null,
): LeadsTableReturn | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isLeadsTableReturn(value) ? value : null;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked storage (private window, site data off): start on page 1.
    return null;
  }
}

export function saveLeadsTableReturn(state: LeadsTableReturn): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Not remembering the page is the pre-#350 behaviour, not an error.
  }
}

const noSubscription = () => () => {};

/**
 * The saved table position, or `undefined` until it can be read. The server
 * render and hydration see `undefined`, so the table seeds its filters only
 * once the browser can answer, and never renders one set of filters on the
 * server and another on the client.
 */
export function useLeadsTableReturn(): LeadsTableReturn | null | undefined {
  const raw = useSyncExternalStore<string | null | undefined>(
    noSubscription,
    readRaw,
    () => undefined,
  );
  return useMemo(
    () => (raw === undefined ? undefined : parseLeadsTableReturn(raw)),
    [raw],
  );
}
