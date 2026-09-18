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
  /** Why the last load failed, shown in the list. */
  error?: string | null;
  /** The caller's copy for a load that succeeded with no leads. */
  emptyMessage: string;
  /** The list is its own scroll area, so each caller sizes it (max-h-*). */
  className?: string;
}

// Shared by the list and its skeleton so the swap between them keeps the
// dialog's layout still.
const listClassName =
  "grid max-h-[24vh] gap-3 overflow-y-auto overscroll-contain p-2 sm:grid-cols-2";

const emptyHint = "Only leads that don't have a project yet appear here.";

// Plain tiles, not Card: Card's overflow-hidden zeroes the automatic min-height
// of CSS Grid items, which collapsed every row to a padding bar and hid names.
const tileClassName =
  "rounded-lg border border-border/70 bg-card p-4 text-sm text-card-foreground";

function LeadStatusBadge({ lead }: { lead: Lead }) {
  if (lead.stage === "Quoted") {
    return (
      <span className="mt-1.5 inline-flex items-center justify-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
        <Send className="mr-1.5 h-4 w-4" />
        Quoted - Awaiting Feedback
      </span>
    );
  }
  if (lead.creatingOffer) {
    return (
      <span className="mt-1.5 inline-flex items-center justify-center rounded-full bg-royal-gold-light px-2.5 py-0.5 text-xs font-medium text-royal-gold-ink">
        <Pencil className="mr-1.5 h-4 w-4" />
        Update Offer
      </span>
    );
  }
  if (lead.runStatus === "RUNNING") {
    return (
      <span className="mt-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
        <Sparkles className="mr-1.5 h-4 w-4 animate-pulse motion-reduce:animate-none" />
        Generating Offer
      </span>
    );
  }
  if (lead.runStatus === "COMPLETED") {
    return (
      <span className="mt-1.5 inline-flex items-center justify-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
        <Sparkles className="mr-1.5 h-4 w-4" />
        Offer Generated
      </span>
    );
  }
  if (lead.runStatus === "FAILED") {
    return (
      <span className="mt-1.5 inline-flex items-center justify-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
        <Sparkles className="mr-1.5 h-4 w-4 animate-pulse motion-reduce:animate-none" />
        Offer Generation Failed
      </span>
    );
  }
  return null;
}

function LeadCardSkeleton() {
  return (
    <div className={tileClassName}>
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
    </div>
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
  error,
  emptyMessage,
  className,
}: LeadCardListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // useEffectEvent gives a stable reference that always reads latest values
  // without needing to be listed as a dependency — ideal for event callbacks
  const onIntersect = useEffectEvent(() => {
    // Not after a failure: the page counter has already moved on, so the next
    // scroll would fetch the page after the one that failed and silently skip
    // its leads.
    if (!loadingMore && !error && totalPages > 0 && currentPage < totalPages) {
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
    setSelectedLeadId(
      lead.id === selectedLeadId ? null : lead.id,
      lead.location,
    );

  // One live region for both branches, so it stays mounted while the skeleton
  // swaps out. A region inserted with its text already in it is often not
  // read out, and a search with no matches would pass in silence. Errors need
  // no help: role=alert is announced on insertion.
  const liveRegion = (
    <p role="status" className="sr-only">
      {!loading && !error && items.length === 0
        ? `${emptyMessage} ${emptyHint}`
        : ""}
    </p>
  );

  if (loading) {
    return (
      <>
        {liveRegion}
        <LeadCardListSkeleton className={className} />
      </>
    );
  }

  return (
    <>
      {liveRegion}
      <div ref={scrollContainerRef} className={cn(listClassName, className)}>
        {items.map((lead) => (
          <div
            key={lead.id}
            // A toggle button, so the picker works from the keyboard and a
            // screen reader hears which lead is chosen. The tile holds no
            // controls of its own, so nothing interactive ends up nested.
            role="button"
            tabIndex={0}
            aria-pressed={lead.id === selectedLeadId}
            // No outline-none: in Tailwind 4 it sets --tw-outline-style to none,
            // which focus-visible:outline-2 then reads, so the focus ring never
            // drew. A mouse click doesn't match :focus-visible anyway.
            className={cn(
              tileClassName,
              "cursor-pointer transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{lead.name}</p>
                <p className="text-sm text-muted-foreground">
                  {lead.location}
                </p>
                <LeadStatusBadge lead={lead} />
              </div>
              {/* The check marks the selection without relying on the ring's
                  colour alone. */}
              {lead.id === selectedLeadId ? (
                <Check
                  aria-hidden
                  className="size-4 text-royal-gold-ink-text"
                />
              ) : (
                <List aria-hidden className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
              <p>{lead.type}</p>
              <p>{lead.phone}</p>
              <p>{lead.email}</p>
            </div>
          </div>
        ))}

        {/* After the cards, so a failed next page shows where the user has
            scrolled to. A failed first page has no cards above it. */}
        {error && (
          <div
            role="alert"
            className="col-span-full rounded-lg border border-destructive/30 bg-destructive-light px-4 py-3 text-sm"
          >
            <p className="font-medium text-destructive-ink">{error}</p>
            <p className="mt-1 text-muted-foreground">
              Change the search or reload the page to try again.
            </p>
          </div>
        )}

        {!error && items.length === 0 && (
          <div className="col-span-full px-4 py-8 text-center text-sm">
            <p className="font-medium text-foreground">{emptyMessage}</p>
            <p className="mt-1 text-muted-foreground">{emptyHint}</p>
          </div>
        )}

        {/* Sentinel: observed by IntersectionObserver to trigger next page */}
        <div ref={sentinelRef} className="col-span-full h-1" aria-hidden />

        {/* "Load more" skeleton row — shown while fetching the next page */}
        {loadingMore &&
          Array.from({ length: 2 }).map((_, i) => (
            <LeadCardSkeleton key={`more-${i}`} />
          ))}

        {!error &&
          items.length > 0 &&
          currentPage >= totalPages &&
          totalPages > 0 && (
            <p className="text-center text-sm text-muted-foreground col-span-full mt-2">
              You&apos;ve reached the end of the list.
            </p>
          )}
      </div>
    </>
  );
}
