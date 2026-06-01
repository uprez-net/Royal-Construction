"use client";

import { fetchJson } from "@/utils/fetch";
import { useEffect, useState } from "react";
import type { Lead as UiLead } from "@/lib/leads/types";
import { PaginatedLeadsResult } from "@/lib/data/leads";


export function useLeadSearch(initialQuery = "") {
    const [query, setQuery] = useState(initialQuery);
    const [items, setItems] = useState<UiLead[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setLoading(true);
            setError(null);
            const q = encodeURIComponent(query.trim());
            fetchJson<PaginatedLeadsResult>(
                `/api/leads?q=${q}&limit=50`,
                { method: "GET" },
                "Failed to fetch leads",
                controller.signal
            )
                .then((res) => {
                    const { items } = res.data;
                    setItems(Array.isArray(items) ? items : []);
                }
                )
                .catch((err) => {
                    if (err.name === "AbortError") return;
                    console.error("useLeadSearch error", err);
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