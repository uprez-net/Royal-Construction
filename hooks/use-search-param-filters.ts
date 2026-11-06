"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A table's filters, kept in the URL so a reload, a shared link and the back
 * button all land on the same view. Each key is a search parameter; an empty
 * value removes it.
 */
export function useSearchParamFilters<K extends string>(keys: readonly K[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const keysKey = keys.join(",");

  const values = useMemo(() => {
    const params = new URLSearchParams(searchParamsString);
    return Object.fromEntries(
      keysKey.split(",").map((key) => [key, params.get(key) ?? ""]),
    ) as Record<K, string>;
  }, [keysKey, searchParamsString]);

  const setValues = useCallback(
    (changes: Partial<Record<K, string | null>>) => {
      const params = new URLSearchParams(searchParamsString);
      for (const [key, value] of Object.entries(changes) as [
        K,
        string | null | undefined,
      ][]) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const next = params.toString();
      if (next === searchParamsString) return;
      router.replace(next ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParamsString],
  );

  return [values, setValues] as const;
}

/**
 * A search box over a URL parameter: typing stays local and instant, and the
 * URL catches up once typing pauses, rather than navigating per keystroke.
 */
export function useDebouncedSearchParam(
  value: string,
  commit: (next: string) => void,
  delay = 300,
) {
  const [draft, setDraft] = useState(value);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  // The URL moved on its own (back button, Clear filters): follow it.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft.trim() === value.trim()) return;
    const timer = window.setTimeout(
      () => commitRef.current(draft.trim()),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [delay, draft, value]);

  return [draft, setDraft] as const;
}
