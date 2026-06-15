import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "../ui/skeleton";
import { cn } from "@/lib/utils";
import { List, Pencil, Send, Sparkles } from "lucide-react";
import type { Lead } from "@/lib/leads/types";
import { useEffect, useRef, useEffectEvent } from "react";

interface LeadCardListProps {
  loading: boolean;
  loadingMore: boolean;
  items: Lead[];
  currentPage: number;
  totalPages: number;
  selectedLeadId: number | null;
  setSelectedLeadId: (id: number | null) => void;
  setPage: (page: number) => void;
}

const skeletonGrid: React.ReactNode = (
  <div className="grid gap-3 sm:grid-cols-2 max-h-[24vh] scrollbar-thin overflow-y-auto p-2">
    {Array.from({ length: 10 }).map((_, i) => (
      <Card key={i} className="animate-pulse overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);

export function LeadCardList({
  loading,
  items,
  loadingMore,
  currentPage,
  totalPages,
  selectedLeadId,
  setSelectedLeadId,
  setPage,
}: LeadCardListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // useEffectEvent gives a stable reference that always reads latest values
  // without needing to be listed as a dependency — ideal for event callbacks
  const onIntersect = useEffectEvent(() => {
    console.log("Intersected sentinel. Loading more?", {
      loadingMore,
      currentPage,
      totalPages,
    });
    if (!loadingMore && totalPages > 0 && currentPage < totalPages) {
      setPage(currentPage + 1);
    }
  });

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onIntersect();
        }
      },
      {
        root: container, // scope to the scroll container, not the viewport
        threshold: 0.1,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [totalPages]); // stable — onIntersect is an EffectEvent, not a dependency

  if (loading) return skeletonGrid;

  return (
    <div
      ref={scrollContainerRef}
      className="grid gap-3 sm:grid-cols-2 max-h-[24vh] scrollbar-thin overflow-y-auto p-2"
    >
      {items.map((lead) => (
        <Card
          key={lead.id}
          className={cn(
            "relative cursor-pointer transition-colors",
            lead.id === selectedLeadId &&
              "border-teal-700 ring-2 ring-teal-700",
            lead.stage === "Quoted" && "opacity-75",
          )}
          onClick={() =>
            setSelectedLeadId(lead.id === selectedLeadId ? null : lead.id)
          }
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              {(lead.creatingOffer ||
                lead.stage === "Quoted" ||
                lead.runId) && (
                <div className="absolute top-7.5 right-10">
                  {lead.stage === "Quoted" ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                      <Send className="mr-1.5 h-4 w-4" />
                      Quoted - Awaiting Feedback
                    </span>
                  ) : lead.creatingOffer ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                      <Pencil className="mr-1.5 h-4 w-4" />
                      Update Offer
                    </span>
                  ) : lead.runStatus === "RUNNING" ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      <Sparkles className="mr-1.5 h-4 w-4 animate-pulse" />
                      Generating Offer
                    </span>
                  ) : lead.runStatus === "COMPLETED" ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      Offer Generated
                    </span>
                  ) : lead.runStatus === "FAILED" ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                      <Sparkles className="mr-1.5 h-4 w-4 animate-pulse" />
                      Offer Generation Failed
                    </span>
                  ) : null}
                </div>
              )}
              <div>
                <p className="font-medium text-slate-950">{lead.name}</p>
                <p className="text-sm text-muted-foreground">{lead.location}</p>
              </div>
              <List className="size-4 text-teal-700" />
            </div>
            <div className="mt-3 space-y-1 text-sm text-slate-700">
              <p>{lead.type}</p>
              <p>{lead.phone}</p>
              <p>{lead.email}</p>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Sentinel: observed by IntersectionObserver to trigger next page */}
      <div ref={sentinelRef} className="col-span-full h-1" aria-hidden />

      {/* "Load more" skeleton row — shown while fetching the next page */}
      {loadingMore &&
        Array.from({ length: 2 }).map((_, i) => (
          <Card key={`more-${i}`} className="animate-pulse overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-4 rounded-full" />
              </div>
              <div className="mt-3 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </CardContent>
          </Card>
        ))}

      {currentPage >= totalPages && totalPages > 0 && (
        <p className="text-center text-sm text-muted-foreground col-span-full mt-2">
          You&apos;ve reached the end of the list.
        </p>
      )}
    </div>
  );
}
