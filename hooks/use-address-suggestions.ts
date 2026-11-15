"use client";

import { useCallback, useEffect, useState } from "react";

import type { AddressSuggestion } from "@/types/data";
import { fetchJson } from "@/utils/fetch";

/** Shown by a picker when the lookup failed, as opposed to finding nothing. */
export const ADDRESS_LOOKUP_ERROR =
  "Address search is unavailable right now. Try again in a moment.";

/** Where the address pickers stop asking: the same floor everywhere. */
const MIN_ADDRESS_CHARS = 3;

/**
 * The `/api/address` lookup the three address pickers share (add tradie, edit
 * tradie, create project).
 *
 * It exists so a failed lookup can be told apart from an empty one. Each picker
 * used to `console.error` in a `catch` and leave the suggestions as they were,
 * so an outage (a revoked key, a provider 403) read as "No results found" and
 * the person concluded the address did not exist. With the tradie location
 * required and settable only by picking a suggestion, that blocked saving.
 *
 * `loading` is derived — "typed past the floor and that query has not
 * settled" — rather than set inside the effect.
 */
export function useAddressSuggestions(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  // The query whose lookup has finished, and whether it failed.
  const [settled, setSettled] = useState({ query: "", failed: false });
  // Bumped by `retry` so the same query is fetched again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || query.length < MIN_ADDRESS_CHARS) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      let failed = false;
      try {
        const response = await fetchJson<{ suggestions: AddressSuggestion[] }>(
          `/api/address?query=${encodeURIComponent(query)}`,
          { method: "GET" },
          "Address lookup failed",
          controller.signal,
        );
        setSuggestions(response.data.suggestions);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        failed = true;
        // The route already reports the provider failure; this keeps the
        // browser console useful and drops results for a query that failed, so
        // the previous query's suggestions are not offered as if they matched.
        console.error("Address lookup failed", error);
        setSuggestions([]);
      }
      if (!controller.signal.aborted) setSettled({ query, failed });
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, query, attempt]);

  const retry = useCallback(() => {
    setSettled({ query: "", failed: false });
    setAttempt((n) => n + 1);
  }, []);

  /** Forget the last lookup, for a form that starts over. */
  const reset = useCallback(() => {
    setSuggestions([]);
    setSettled({ query: "", failed: false });
  }, []);

  const searched = query.length >= MIN_ADDRESS_CHARS;
  return {
    suggestions,
    loading: searched && settled.query !== query,
    error:
      searched && settled.query === query && settled.failed
        ? ADDRESS_LOOKUP_ERROR
        : undefined,
    retry,
    reset,
  };
}
