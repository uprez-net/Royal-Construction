"use client";

import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query.
 *
 * Returns `false` on the server and for the first client render so markup
 * matches during hydration, then settles on the real value. Use it for layout
 * that has to change behaviour, not just appearance — a rail that becomes a
 * drawer, for example. Anything a CSS breakpoint can express belongs in CSS.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
