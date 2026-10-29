"use client";

import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  CircleDollarSign,
  History,
  Loader2,
  Mail,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchTradieActivityLog } from "@/lib/data/tradie-management";
import type { TradieActivityItem } from "@/lib/domain/tradies/queries";
import { useAppSelector } from "@/lib/store/hooks";
import type { TradieActivityLogType } from "@/types/tradieActivityLog";
import { dataTimeFormat } from "@/utils/formatters";

import { CollapsibleCard } from "./collapsible-card";

// The tradie's history across every project: bookings, quotes, request
// emails, selections, cancellations and incidents, newest first. Written by
// the domain commands (lib/domain/audit/tradie-activity-log.ts) from the
// templates in types/tradieActivityLog.ts.
//
// Loaded when the card is first opened, and read fresh rather than from the
// tradie page's cache: Eve, the email-reply webhook and the reminder cron all
// write to it, and none of them can expire that cache.

/** The glyph for each kind of entry. Meaning is in the words, never the icon. */
const ICONS: Record<TradieActivityLogType, LucideIcon> = {
  bookingCancelled: Ban,
  bookingCompleted: CheckCircle2,
  bookingCreated: CalendarPlus,
  bookingDeleted: Ban,
  bookingDeletionRequested: Ban,
  bookingEmailSent: Mail,
  bookingRescheduled: CalendarClock,
  bookingStatusChanged: History,
  incidentReported: AlertTriangle,
  incidentResolved: ShieldCheck,
  invoiceAllocated: ReceiptText,
  invoiceRecorded: ReceiptText,
  invoiceVoided: Ban,
  quoteRecorded: CircleDollarSign,
  removedFromDirectory: Ban,
  requestEmailNotSent: AlertTriangle,
  requestEmailSent: Mail,
  selectedForTrade: Trophy,
  tradeCancellationRequested: Ban,
  tradeCancellationResolved: Ban,
};

function iconFor(type: string): LucideIcon {
  return ICONS[type as TradieActivityLogType] ?? History;
}

/** Dates arrive as `Date` across the action boundary; coerce defensively. */
function when(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : dataTimeFormat.format(date);
}

type Status = "idle" | "loading" | "error";

export function TradieActivityLogCard() {
  const tradieId = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails?.id,
  );
  const [items, setItems] = useState<TradieActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  /** A page has been read at least once, so "nothing yet" means nothing. */
  const [loaded, setLoaded] = useState(false);

  if (!tradieId) return null;

  /** The first page again, or the next older one after `from`. */
  const load = async (from: string | null) => {
    setStatus("loading");
    setError(null);
    try {
      const page = await fetchTradieActivityLog(tradieId, from);
      if (!page.ok) {
        setStatus("error");
        setError(page.error);
        return;
      }
      setItems((previous) =>
        from ? [...previous, ...page.items] : [...page.items],
      );
      setCursor(page.nextCursor);
      setStatus("idle");
      setLoaded(true);
    } catch {
      setStatus("error");
      setError("The activity log could not be loaded. Try again.");
    }
  };

  return (
    <CollapsibleCard
      title="Activity log"
      summary="Bookings, quotes, emails and decisions across every project"
      onOpenChange={(open) => {
        if (open && !loaded && status !== "loading") void load(null);
      }}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Refresh the activity log"
          title="Refresh"
          disabled={status === "loading"}
          onClick={() => void load(null)}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
        </Button>
      }
    >
      <div className="px-6 pb-6" aria-busy={status === "loading"}>
        {error ? (
          <p role="alert" className="mb-3 text-sm text-destructive-ink">
            {error}
          </p>
        ) : null}

        {items.length === 0 && status === "loading" ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Loading the activity log…
          </p>
        ) : items.length === 0 && loaded ? (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <History className="size-10" aria-hidden="true" />
            Nothing recorded for this tradie yet
          </div>
        ) : (
          <ol className="space-y-3">
            {items.map((item) => {
              const Icon = iconFor(item.type);
              const at = when(item.createdAt);
              return (
                <li
                  key={item.id}
                  className="flex gap-3 rounded-lg border border-border/70 p-3"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground break-words">
                      {item.message}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {item.project ? (
                        <Link
                          href={`/projects/${item.project.id}?activeTab=tradies`}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {item.project.name}
                        </Link>
                      ) : null}
                      {item.milestoneName ? (
                        <span>{item.milestoneName}</span>
                      ) : null}
                      <span>{item.authorName ?? "System"}</span>
                      {at ? (
                        <time
                          className="font-mono tabular-nums"
                          dateTime={new Date(item.createdAt).toISOString()}
                        >
                          {at}
                        </time>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {cursor ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4 w-full"
            disabled={status === "loading"}
            onClick={() => void load(cursor)}
          >
            {status === "loading" ? (
              <Loader2
                className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            Load older entries
          </Button>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
