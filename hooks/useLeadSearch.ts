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
        const timer = setTimeout(async () => {
            setLoading(true);
            setError(null);
            const params = new URLSearchParams();
            if (query.trim().length > 0) params.append('q', query.trim());
            params.append('page', '1');
            params.append('limit', '10');
            try {
                const { data } = await fetchJson<PaginatedLeadsResult>(
                    `/api/leads?${params.toString()}`,
                    { method: "GET", cache: 'no-store' },
                    "Failed to fetch leads",
                    controller.signal
                );
                setItems(data.items);
            } catch (err) {
                if (err instanceof Error) {
                    setError(err.message);
                } else {
                    setError("An unknown error occurred");
                }
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    return { query, setQuery, items, loading, error } as const;
}