"use client";

import { PaginatedProjectLookupResult, ProjectLookupItem } from "@/lib/data/projects";
import { fetchJson } from "@/utils/fetch";
import { useEffect, useState } from "react";

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
      fetchJson<PaginatedProjectLookupResult>(
        `/api/projects?mode=lookup&q=${q}&limit=20`,
        { method: "GET" },
        "Failed to fetch projects",
        controller.signal
      )
        .then((res) => {
          const { items } = res.data;
          setItems(Array.isArray(items) ? items : items ?? []);
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
