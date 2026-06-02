"use client";
import { CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { Input } from "../ui/input";
import { useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { fetchQuotes } from "@/lib/store/slices/quotesSlice";

type TabId = "all" | "pending" | "approved" | "rejected" | "sent";

interface QuoteFilterProps {
  initialTabCounts: Record<TabId, number>;
  initialTotalCount: number;
}

export function QuoteFilter({
  initialTabCounts,
  initialTotalCount,
}: QuoteFilterProps) {
  const dispatch = useAppDispatch();
  const { quotes } = useAppSelector((state) => state.quotes);
  const [searchInput, setSearchInput] = useState("");
  const [tabId, setTabId] = useState("all");
  const { tabCounts, totalCount } = useMemo(() => {
    if (quotes.items.length === 0) {
      return {
        tabCounts: initialTabCounts,
        totalCount: initialTotalCount,
      };
    }
    const counts: Record<TabId, number> = {
      all: quotes.totalCount,
      pending: quotes.items.filter((q) => q.quoteStatus === "PENDING").length,
      approved: quotes.items.filter((q) => q.quoteStatus === "ACCEPTED").length,
      rejected: quotes.items.filter((q) => q.quoteStatus === "REJECTED").length,
      sent: quotes.items.filter((q) => q.quoteStatus === "SENT").length,
    };
    return {
      tabCounts: counts,
      totalCount: quotes.totalCount,
    };
  }, [quotes]);

  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchInput(query);
    if (query.trim() === "") return;
    try {
      await dispatch(fetchQuotes({ q: query })).unwrap();
    } catch (error) {
      console.error("Error searching quotes", error);
    }
  };

  return (
    <CardHeader className="border-b border-border/70 px-5 py-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 pb-4">
          {(["all", "pending", "approved", "rejected", "sent"] as const).map(
            (tab) => {
              const active = tabId === tab;

              return (
                <button
                  key={tab}
                  onClick={() => setTabId(tab)}
                  className={cn(
                    "group relative inline-flex h-9 items-center rounded-md px-3 text-[12.5px] font-semibold transition-all duration-200",
                    active
                      ? "bg-teal-50 text-teal-700 shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span>
                    {tab === "all"
                      ? "All"
                      : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </span>

                  <span
                    className={cn(
                      "ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold transition-colors",
                      active
                        ? "bg-teal-600 text-white"
                        : "bg-muted text-muted-foreground group-hover:bg-background",
                    )}
                  >
                    {tabCounts[tab]}
                  </span>

                  {active && (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
                  )}
                </button>
              );
            },
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-[280px] flex-1">
            <label htmlFor="search" className="sr-only">
              Search
            </label>

            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              id="search"
              className="h-10 rounded-lg border-border bg-background pl-9 text-[13px] shadow-none transition-all focus-visible:ring-4 focus-visible:ring-teal-500/10 focus-visible:border-teal-600"
              placeholder="Search quotes..."
              value={searchInput}
              onChange={handleSearchChange}
            />
          </div>

          <p className="ml-auto whitespace-nowrap text-[12px] font-medium text-muted-foreground">
            {totalCount} results
          </p>
        </div>
      </div>
    </CardHeader>
  );
}
