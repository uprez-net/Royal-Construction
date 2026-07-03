"use client";

import { fetchJson } from "@/utils/fetch";
import { useEffect, useState } from "react";
import type { Lead as UiLead } from "@/lib/leads/types";
import { PaginatedLeadsResult } from "@/lib/data/leads";

const DEFAULT_LIMIT = 10;

export function useLeadSearch(initialQuery = "", initialPage = 1, getLeadsWithoutProject = false) {
    const [query, setQuery] = useState(initialQuery);
    const [items, setItems] = useState<UiLead[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pageInfo, setPageInfo] = useState<Omit<PaginatedLeadsResult, 'items'>>({
        page: initialPage,
        limit: DEFAULT_LIMIT,
        totalCount: 0,
        totalPages: 0,
    })

    const setPage = (newPage: number) => {
        setPageInfo((prev) => ({ ...prev, page: newPage }));
    }

    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            if (items.length === 0 || query.length > 0) setLoading(true);
            else setLoadingMore(true);
            setError(null);
            const params = new URLSearchParams();
            if (query.trim().length > 0) params.append('q', query.trim());
            params.append('page', pageInfo.page.toString());
            params.append('limit', DEFAULT_LIMIT.toString());
            if (getLeadsWithoutProject) {
                params.append('filterLeadsWithoutProject', 'true');
            }
            try {
                const { data } = await fetchJson<PaginatedLeadsResult>(
                    `/api/leads?${params.toString()}`,
                    { method: "GET", cache: 'no-store' },
                    "Failed to fetch leads",
                    controller.signal
                );
                setItems(prev => {
                    if (pageInfo.page === 1) return data.items;
                    const oldData = new Set(prev.map(i => i.id));
                    return [...prev, ...data.items.filter(i => !oldData.has(i.id))];
                });
                setPageInfo({
                    page: data.page,
                    limit: data.limit,
                    totalCount: data.totalCount,
                    totalPages: data.totalPages,
                });
            } catch (err) {
                if (err instanceof Error) {
                    setError(err.message);
                } else {
                    setError("An unknown error occurred");
                }
            } finally {
                setLoading(false);
                setLoadingMore(false);
            }
        }, 300);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query, pageInfo.page, items.length, getLeadsWithoutProject]);

    return { query, setQuery, items, loading, error, pageInfo, setPage, loadingMore } as const;
}