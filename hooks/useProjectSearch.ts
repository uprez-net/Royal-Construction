"use client";

import { useEffect, useState } from "react";

export type ProjectLookupItem = { id: string; name: string };

export function useProjectSearch(initialQuery = "") {
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<ProjectLookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);

      const q = encodeURIComponent(query.trim());
      fetch(`/api/projects?mode=lookup&q=${q}&limit=20`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch projects");
          return res.json();
        })
        .then((data) => {
          setItems(Array.isArray(data.items) ? data.items : data.items ?? []);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          console.error("useProjectSearch error", err);
          setError(String(err?.message ?? "Unknown error"));
          setItems([]);
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { query, setQuery, items, loading, error } as const;
}
