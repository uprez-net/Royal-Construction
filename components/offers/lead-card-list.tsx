import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "../ui/skeleton";
import { cn } from "@/lib/utils";
import { Check, List, Pencil, Send, Sparkles } from "lucide-react";
import type { Lead } from "@/lib/leads/types";
import { useEffect, useRef, useEffectEvent } from "react";

interface LeadCardListProps {
  loading: boolean;
  loadingMore: boolean;
  items: Lead[];
  currentPage: number;
  totalPages: number;
  selectedLeadId: number | null;
  setSelectedLeadId: (id: number | null, location: string | null) => void;
  setPage: (page: number) => void;
  /** The list is its own scroll area, so each caller sizes it (max-h-*). */
  className?: string;
}

// Shared by the list and its skeleton so the swap between them keeps the
// dialog's layout still.
const listClassName =
  "grid max-h-[24vh] gap-3 overflow-y-auto overscroll-contain p-2 sm:grid-cols-2";

function LeadCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="size-4 rounded-full" />
        </div>
        <div className="mt-3 space-y-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </CardContent>
    </Card>
  );
}

function LeadCardListSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(listClassName, className)}>
      {Array.from({ length: 10 }).map((_, i) => (
        <LeadCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function LeadCardList({
  loading,
  items,
  loadingMore,
  currentPage,
  totalPages,
  selectedLeadId,
  setSelectedLeadId,
  setPage,
  className,
}: LeadCardListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // useEffectEvent gives a stable reference that always reads latest values
  // without needing to be listed as a dependency — ideal for event callbacks
  const onIntersect = useEffectEvent(() => {
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
    // `loading` because the skeleton replaces the whole list while page 1
    // loads: the sentinel is a new node afterwards, and with only totalPages
    // here a search that kept the same page count left the observer watching
    // the detached one, so scrolling never loaded page 2. onIntersect is an
    // EffectEvent, not a dependency.
  }, [loading, totalPages]);

  const toggleLead = (lead: Lead) =>
    setSelectedLeadId(lead.id === selectedLeadId ? null : lead.id, lead.location);

  if (loading) return <LeadCardListSkeleton className={className} />;

  return (
    <div ref={scrollContainerRef} className={cn(listClassName, className)}>
      {items.map((lead) => (
        <Card
          key={lead.id}
          // A toggle button, so the picker works from the keyboard and a
          // screen reader hears which lead is chosen. The card holds no
          // controls of its own, so nothing interactive ends up nested.
          role="button"
          tabIndex={0}
          aria-pressed={lead.id === selectedLeadId}
          className={cn(
            "relative cursor-pointer outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            lead.id === selectedLeadId &&
              "border-royal-gold-ink ring-2 ring-royal-gold-ink",
            lead.stage === "Quoted" && "opacity-75",
          )}
          onClick={() => toggleLead(lead)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            // Space would otherwise scroll the list, and a held key would
            // flip the selection on every repeat.
            event.preventDefault();
            if (!event.repeat) toggleLead(lead);
          }}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              {(lead.creatingOffer ||
                lead.stage === "Quoted" ||
                lead.runId ||
                lead.runStatus) && (
                <div className="absolute top-7.5 right-10">
                  {lead.stage === "Quoted" ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                      <Send className="mr-1.5 h-4 w-4" />
                      Quoted - Awaiting Feedback
                    </span>
                  ) : lead.creatingOffer ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-royal-gold-light px-2.5 py-0.5 text-xs font-medium text-royal-gold-ink">
                      <Pencil className="mr-1.5 h-4 w-4" />
                      Update Offer
                    </span>
                  ) : lead.runStatus === "RUNNING" ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      <Sparkles className="mr-1.5 h-4 w-4 animate-pulse motion-reduce:animate-none" />
                      Generating Offer
                    </span>
                  ) : lead.runStatus === "COMPLETED" ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      Offer Generated
                    </span>
                  ) : lead.runStatus === "FAILED" ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                      <Sparkles className="mr-1.5 h-4 w-4 animate-pulse motion-reduce:animate-none" />
                      Offer Generation Failed
                    </span>
                  ) : null}
                </div>
              )}
              <div>
                <p className="font-medium text-slate-950">{lead.name}</p>
                <p className="text-sm text-muted-foreground">{lead.location}</p>
              </div>
              {/* The check marks the selection without relying on the ring's
                  colour alone. */}
              {lead.id === selectedLeadId ? (
                <Check aria-hidden className="size-4 text-royal-gold-ink" />
              ) : (
                <List aria-hidden className="size-4 text-muted-foreground" />
              )}
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
          <LeadCardSkeleton key={`more-${i}`} />
        ))}

      {currentPage >= totalPages && totalPages > 0 && (
        <p className="text-center text-sm text-muted-foreground col-span-full mt-2">
          You&apos;ve reached the end of the list.
        </p>
      )}
    </div>
  );
}
