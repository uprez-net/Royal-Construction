"use client";

import { useEffect, useSyncExternalStore } from "react";

import { fetchJson } from "@/utils/fetch";
import type { TradeTypeOption } from "@/types/trade-type";

// The trade list for every picker, badge and tile, fetched once per page
// session and shared. The list is the `TradeType` table (Admin → Trade types);
// it changes a few times a year, so one fetch is plenty, and Admin → Trade
// types reloads it after each edit so its own tab sees the change at once.

type TradeTypesState = {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly tradeTypes: readonly TradeTypeOption[];
  readonly error: string | null;
};

const LOAD_FAILED = "Couldn't load the trade list.";
const INITIAL: TradeTypesState = {
  status: "idle",
  tradeTypes: [],
  error: null,
};

let state: TradeTypesState = INITIAL;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: TradeTypesState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Fetch the list unless it is already here. `force` fetches again, after a
 * request already in flight if there is one, since that one may predate the
 * edit being reloaded for.
 */
export function loadTradeTypes(force = false): Promise<void> {
  if (inflight) {
    return force ? inflight.then(() => loadTradeTypes(true)) : inflight;
  }
  if (!force && state.status === "ready") return Promise.resolve();

  setState({ ...state, status: "loading", error: null });
  inflight = fetchJson<TradeTypeOption[]>(
    "/api/trade-types",
    { method: "GET" },
    LOAD_FAILED,
  )
    .then((response) => {
      setState({ status: "ready", tradeTypes: response.data, error: null });
    })
    .catch((error: unknown) => {
      // The list already shown stays; the error says it may be out of date.
      setState({
        ...state,
        status: "error",
        error: error instanceof Error ? error.message : LOAD_FAILED,
      });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useTradeTypes() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );

  useEffect(() => {
    void loadTradeTypes();
  }, []);

  return {
    ...snapshot,
    reload: () => loadTradeTypes(true),
  };
}

/** The listed trade with this label, whatever its case. */
export function findTradeType(
  tradeTypes: readonly TradeTypeOption[],
  label: string | null | undefined,
): TradeTypeOption | undefined {
  if (!label) return undefined;
  const wanted = label.trim().toLowerCase();
  return tradeTypes.find((option) => option.label.toLowerCase() === wanted);
}
