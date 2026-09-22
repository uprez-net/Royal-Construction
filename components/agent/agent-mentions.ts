"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** One business record the operator can point the agent at with `@`. */
export type AgentAnnotation = {
  type: string;
  id: string;
  label: string;
  href: string;
  group: string;
};

/**
 * The most references one turn can carry.
 *
 * `/api/agent/sessions/[sessionId]/context` rejects more than twenty, and a
 * rejected write is reported as "the message was sent, but its references could
 * not be saved" — after the turn has already gone. The composer stops at the
 * same number so the refusal never happens.
 */
export const MAX_ANNOTATIONS = 20;

/** The `@…` token under the caret, if the caret is inside one. */
export type MentionTrigger = {
  query: string;
  start: number;
  end: number;
};

/**
 * Finds the mention token the caret sits in.
 *
 * Anchored on the caret rather than the end of the value, so a reference can be
 * added while editing the middle of a message. A token ends at whitespace or a
 * second `@`, and must start at the beginning of the value or after whitespace
 * so an email address is never read as a mention.
 */
export function findMentionTrigger(
  value: string,
  caret: number,
): MentionTrigger | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  const preceding = at === 0 ? "" : before[at - 1];
  if (preceding !== "" && !/\s/.test(preceding)) return null;
  const query = before.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  return { end: caret, query, start: at };
}

/** Replaces the token under the caret with the chosen label, kept as text. */
export function applyMention(
  value: string,
  trigger: MentionTrigger,
  label: string,
) {
  const tail = value.slice(trigger.end);
  const token = `@${label}${/^\s/.test(tail) ? "" : " "}`;
  return {
    caret: trigger.start + token.length,
    value: value.slice(0, trigger.start) + token + tail,
  };
}

export type MentionSearchState = {
  error: boolean;
  loading: boolean;
  results: readonly AgentAnnotation[];
};

/** Debounced reference search for the token under the caret. */
export function useMentionSearch(query: string | null): MentionSearchState {
  const [fetched, setFetched] = useState<{
    error: boolean;
    query: string;
    results: readonly AgentAnnotation[];
  } | null>(null);
  const requestId = useRef(0);
  const active = query !== null && query.trim().length >= 2;

  useEffect(() => {
    if (!active) return;
    const current = (requestId.current += 1);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/agent/annotations?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Reference search failed");
          return (await response.json()) as {
            annotations?: AgentAnnotation[];
          };
        })
        .then((payload) => {
          if (requestId.current !== current) return;
          setFetched({
            error: false,
            query,
            results: payload.annotations ?? [],
          });
        })
        .catch(() => {
          if (controller.signal.aborted || requestId.current !== current)
            return;
          setFetched({ error: true, query, results: [] });
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, query]);

  // Derived, so a result can never be shown against a query it did not answer.
  // Picking the wrong record off a stale list is the kind of mistake that ends
  // up in front of a client.
  const settled = active && fetched?.query === query ? fetched : null;
  return {
    error: settled?.error ?? false,
    loading: active && settled === null,
    results: settled?.results ?? [],
  };
}

export type MentionGroup = {
  group: string;
  items: { annotation: AgentAnnotation; index: number }[];
};

/**
 * Groups results by record type, preserving the server's ordering and carrying
 * each item's position in the flat list so the menu and the arrow keys agree on
 * what "the next one" is.
 */
export function useGroupedMentions(
  results: readonly AgentAnnotation[],
): MentionGroup[] {
  return useMemo(() => {
    const groups: MentionGroup[] = [];
    results.forEach((annotation, index) => {
      const existing = groups.find((entry) => entry.group === annotation.group);
      if (existing) existing.items.push({ annotation, index });
      else
        groups.push({
          group: annotation.group,
          items: [{ annotation, index }],
        });
    });
    return groups;
  }, [results]);
}

/** What a keystroke in the composer should do. */
export type ComposerKeyAction =
  | { kind: "dismiss" }
  | { kind: "hold" }
  | { kind: "ignore" }
  | { kind: "move"; delta: 1 | -1 }
  | { kind: "pick" }
  | { kind: "send" };

/**
 * Decides who owns a keystroke: the picker, the composer, or the browser.
 *
 * Pure and separately tested because getting this wrong sends a message the
 * operator did not mean to send. It has been wrong twice — first when
 * Enter-to-send ran regardless of the picker, then again when the picker only
 * claimed Enter once results had arrived, so Enter pressed during the search
 * sent the half-typed `@sm` along with the message.
 *
 * While the picker is open, Enter belongs to it whether or not there is
 * anything to choose yet; `hold` swallows the key and the operator dismisses
 * with Escape. Tab is only claimed when there is something to pick, so it
 * still moves focus otherwise.
 */
export function composerKeyAction(
  event: { key: string; shiftKey: boolean; isComposing: boolean },
  state: { menuOpen: boolean; resultCount: number },
): ComposerKeyAction {
  // An IME owns every key while a candidate is being composed, including the
  // Enter that commits it.
  if (event.isComposing) return { kind: "ignore" };

  if (state.menuOpen) {
    if (event.key === "Escape") return { kind: "dismiss" };
    if (state.resultCount > 0) {
      if (event.key === "ArrowDown") return { delta: 1, kind: "move" };
      if (event.key === "ArrowUp") return { delta: -1, kind: "move" };
      if (event.key === "Tab") return { kind: "pick" };
      if (event.key === "Enter" && !event.shiftKey) return { kind: "pick" };
    }
    if (event.key === "Enter" && !event.shiftKey) return { kind: "hold" };
    return { kind: "ignore" };
  }

  if (event.key === "Enter" && !event.shiftKey) return { kind: "send" };
  return { kind: "ignore" };
}
