"use client";

import { useEffect, useState } from "react";

export type LookupOption = {
  id: string;
  name: string;
  company?: string | null;
  tradeType?: string | null;
  phone?: string | null;
  email?: string | null;
};

export function useTradieSearch(initialQuery = "") {
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);

      const q = encodeURIComponent(query.trim());
      fetch(`/api/tradies?search=${q}&limit=50`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch");
          return res.json();
        })
        .then((data) => {
          setItems(Array.isArray(data) ? data : []);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          console.error("useTradieSearch error", err);
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
