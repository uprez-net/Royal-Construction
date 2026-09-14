"use client";

import { FetchError, fetchJson } from "@/utils/fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead as UiLead } from "@/lib/leads/types";
import { PaginatedLeadsResult } from "@/lib/data/leads";
import { mergeLeadPage, pageAfterQueryChange } from "@/lib/leads/lead-search-paging";

const DEFAULT_LIMIT = 10;

export function useLeadSearch(initialQuery = "", initialPage = 1, getLeadsWithoutProject = false) {
    const [query, setQueryState] = useState(initialQuery);
    // The pickers push their input into setQuery from an effect that runs on
    // every render, so an unchanged value has to be a no-op here or it would
    // keep throwing the user back to page 1.
    const queryRef = useRef(initialQuery);
    const [items, setItems] = useState<UiLead[]>([]);
    // True from the start: the first request waits out the debounce, and until
    // it lands the picker should show its skeleton, not "no leads".
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pageInfo, setPageInfo] = useState<Omit<PaginatedLeadsResult, 'items'>>({
        page: initialPage,
        limit: DEFAULT_LIMIT,
        totalCount: 0,
        totalPages: 0,
    })

    const setPage = useCallback((newPage: number) => {
        setPageInfo((prev) => ({ ...prev, page: newPage }));
    }, []);

    const setQuery = useCallback((nextQuery: string) => {
        const prevQuery = queryRef.current;
        if (nextQuery === prevQuery) return;
        queryRef.current = nextQuery;
        setQueryState(nextQuery);
        setPageInfo((prev) => {
            const page = pageAfterQueryChange(prevQuery, nextQuery, prev.page);
            return page === prev.page ? prev : { ...prev, page };
        });
    }, []);

    const searchTerm = query.trim();
    const page = pageInfo.page;

    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            // Page 1 is a new result set and replaces the list; later pages
            // load under the list the user is already scrolling.
            if (page === 1) setLoading(true);
            else setLoadingMore(true);
            setError(null);
            const params = new URLSearchParams();
            if (searchTerm.length > 0) params.append('q', searchTerm);
            params.append('page', page.toString());
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
                setItems((prev) => mergeLeadPage(prev, data.items, page));
                setPageInfo({
                    page: data.page,
                    limit: data.limit,
                    totalCount: data.totalCount,
                    totalPages: data.totalPages,
                });
            } catch (err) {
                // Aborted because the search changed or the picker closed. The
                // request that replaced it reports its own outcome, so this
                // one must not flash the browser's abort message.
                if (controller.signal.aborted) return;
                // A failed first page leaves nothing valid on screen: the
                // leads there belong to the previous search.
                if (page === 1) setItems([]);
                // FetchError carries the API's message. Anything else is the
                // browser's own network text ("Load failed"), which means
                // nothing to the user.
                setError(err instanceof FetchError ? err.message : "Failed to fetch leads");
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                    setLoadingMore(false);
                }
            }
        }, 300);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [searchTerm, page, getLeadsWithoutProject]);

    return { query, setQuery, items, loading, error, pageInfo, setPage, loadingMore } as const;
}
