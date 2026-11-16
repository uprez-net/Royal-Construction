"use client";
import { CardContent } from "../ui/card";
import { currency, dateFormat } from "@/utils/formatters";
import { ChevronRight, Layers, ReceiptText } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  OfferGroup,
  OfferListRow,
  PaginatedOfferGroupResult,
} from "@/types/offer";
import {
  fetchOffers,
  syncServerOffers,
  updateOffer,
} from "@/lib/store/slices/offerSlice";
import { OfferPagination } from "./offer-pagination";
import { OFFER_TABLE_HEADERS } from "./offer-table-columns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OfferStatusBadge } from "./offer-status-badge";
import { OfferStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { DataTableSkeleton, PageSkeleton, Skeleton } from "../ui/skeleton";
import {
  FLUSH_TABLE_CONTENT_CLASS,
  TABLE_CELL_CLASS,
  TABLE_HEAD_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_ROW_CLASS,
  TABLE_ROW_HOVER_CLASS,
} from "../ui/table-styles";
import { isDefaultOfferFilters } from "@/lib/offer/offer-listing-view";

const money = (value: string) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? currency.format(parsed) : "—";
};

const day = (value: Date | string | null) =>
  value ? dateFormat.format(new Date(value)) : "-";

/** Render paginated offer groups and retain the requested filters across refreshes. */
export function OfferTable({
  serverOffers,
}: {
  serverOffers: PaginatedOfferGroupResult;
}) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const {
    offers: stateOffers,
    filters,
    loading,
    hydrated,
  } = useAppSelector((state) => state.offers);
  const [expandedLeadIds, setExpandedLeadIds] = useState<number[]>([]);

  // Until the store has adopted a result, show the server's page. After that
  // the store is the view, empty or not: falling back to the server's
  // unfiltered page whenever the store had no rows made a search or tab with no
  // matches show every offer.
  const offers = hydrated ? stateOffers : serverOffers;
  const filtered = !isDefaultOfferFilters(
    filters.status,
    filters.q,
    filters.sort,
  );

  // Runs on mount and on every server re-render (router.refresh()). A filtered
  // view refetches its own filters rather than being replaced by the server's
  // unfiltered page.
  useEffect(() => {
    dispatch(syncServerOffers(serverOffers));
  }, [serverOffers, dispatch]);

  /** Load another page with the current filters and close revision rows from the previous page. */
  const handlePageChange = async (page: number) => {
    try {
      // Expansion is keyed by lead id, which only identifies a row on the page
      // it was opened from, so a page change closes everything.
      setExpandedLeadIds([]);
      // Reuse the store's active filters so paginating after a tab/search
      // selection keeps that selection. The old call dropped both, which reset
      // the table to the unfiltered list on every page beyond the first.
      await dispatch(
        fetchOffers({
          page,
          limit: offers.limit,
          status: filters.status,
          q: filters.q,
          sort: filters.sort,
        }),
      ).unwrap();
    } catch (error) {
      console.error("Error fetching offers for page", page, error);
      toast.error("Failed to load offers for page " + page);
    }
  };

  const toggleGroup = useCallback((leadId: number) => {
    setExpandedLeadIds((current) =>
      current.includes(leadId)
        ? current.filter((id) => id !== leadId)
        : [...current, leadId],
    );
  }, []);

  const handleStatusChange = async (
    offerId: string,
    newStatus: OfferStatus,
  ) => {
    try {
      await dispatch(updateOffer({ offerId, status: newStatus })).unwrap();
      toast.success("Offer status updated to " + newStatus);
    } catch (error) {
      console.error("Error updating offer status", error);
      toast.error("Failed to update offer status");
    }
  };

  const openGroup = useCallback(
    (leadId: number) => router.push(`/offers/${leadId}`),
    [router],
  );

  if (loading && offers.items.length === 0) {
    return (
      <CardContent className={cn("px-5 py-4", FLUSH_TABLE_CONTENT_CLASS)}>
        <PageSkeleton label="Loading offers">
          <DataTableSkeleton columnCount={OFFER_TABLE_HEADERS.length} flush />
        </PageSkeleton>
      </CardContent>
    );
  }

  return (
    <CardContent className={cn("px-5 py-4", FLUSH_TABLE_CONTENT_CLASS)}>
      {offers.items.length > 0 ? (
        <div className="flex flex-col gap-3 md:hidden">
          {offers.items.map((group) => (
            <OfferMobileCard
              key={group.leadId}
              group={group}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      ) : null}
      <div
        className={cn(
          "min-w-0 overflow-x-auto",
          offers.items.length > 0 && "hidden md:block",
        )}
      >
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">
            Offers grouped by client, each expandable to its version history
          </caption>
          <thead className={TABLE_HEAD_ROW_CLASS}>
            <tr>
              {OFFER_TABLE_HEADERS.map((header, index) => (
                <th
                  key={`header-${index}`}
                  scope="col"
                  className={cn(
                    TABLE_HEAD_CELL_CLASS,
                    header.align === "end" && "text-right tabular-nums",
                    index === 0 && "w-10 px-2",
                  )}
                >
                  {header.srOnly ? (
                    <span className="sr-only">{header.label}</span>
                  ) : (
                    header.label
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {offers.items.length > 0 ? (
              offers.items.map((group) => (
                <OfferGroupRows
                  key={group.leadId}
                  group={group}
                  expanded={expandedLeadIds.includes(group.leadId)}
                  onToggle={toggleGroup}
                  onOpen={openGroup}
                  onStatusChange={handleStatusChange}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={OFFER_TABLE_HEADERS.length}
                  className={cn("px-4 text-center", loading ? "py-4" : "py-16")}
                >
                  {loading ? (
                    // Block bars, not rows: a <tr> is not valid inside this <td>.
                    <div className="space-y-3">
                      {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton key={index} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="flex size-12 items-center justify-center">
                        <ReceiptText className="size-5 text-muted-foreground" />
                      </div>

                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {filtered
                            ? "No offers match this view"
                            : "No offers available"}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {filtered
                            ? "Try another tab, or clear the search."
                            : "Your offers will appear here."}
                        </p>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* The table runs edge to edge from md up, so the count and pages keep their gutter here. */}
      <div className={cn(offers.totalCount > 0 && "md:px-5 md:pb-4")}>
        <OfferPagination offers={offers} onPageChange={handlePageChange} />
      </div>
    </CardContent>
  );
}

interface OfferGroupRowsProps {
  group: OfferGroup;
  expanded: boolean;
  onToggle: (leadId: number) => void;
  onOpen: (leadId: number) => void;
  onStatusChange: (offerId: string, status: OfferStatus) => Promise<void>;
}

function OfferMobileCard({
  group,
  onStatusChange,
}: Pick<OfferGroupRowsProps, "group" | "onStatusChange">) {
  const { latest } = group;
  return (
    <article className="min-w-0 rounded-lg border border-border/70 bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          href={`/offers/${group.leadId}`}
          className="inline-flex min-h-11 items-center rounded-sm font-mono text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {group.reference}
        </Link>
        <OfferStatusBadge
          status={latest.offerStatus}
          onStatusChange={(status) => onStatusChange(latest.id, status)}
        />
      </div>
      <p className="break-words text-base font-semibold">
        {group.lead.name || "N/A"}
      </p>
      <p className="mt-1 break-words text-sm text-muted-foreground">
        {group.lead.type.join(", ") || "—"}
      </p>
      {/* The ex-GST split rides under the total, and a date shows only once
          it exists: two rows of "-" made every unsent offer about 390px tall. */}
      <dl className="mt-3 rounded-md bg-muted/50 p-3 text-sm">
        <dt className="text-xs text-muted-foreground">
          Total including GST · v{latest.revisionNumber}
        </dt>
        <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
          {money(latest.totalAmount)}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{money(latest.amount)}</span>{" "}
          ex GST ·{" "}
          <span className="font-mono tabular-nums">
            {money(latest.gstAmount)}
          </span>{" "}
          GST
        </dd>
      </dl>
      {latest.sentAt || latest.acceptedAt ? (
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {latest.sentAt ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Sent</dt>
              <dd className="font-mono tabular-nums">{day(latest.sentAt)}</dd>
            </div>
          ) : null}
          {latest.acceptedAt ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Approved</dt>
              <dd className="font-mono tabular-nums">
                {day(latest.acceptedAt)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {group.versionCount > 1 ? (
        <details className="mt-4 border-t border-border/70 pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
            <Layers className="size-4" aria-hidden="true" />{" "}
            {group.versionCount} versions · View history
          </summary>
          <div className="flex flex-col gap-3 pt-2">
            {group.revisions.map((revision) => (
              <div
                key={revision.id}
                className="rounded-md border border-border/70 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">
                    v{revision.revisionNumber}
                    {revision.isActive ? " · Active" : ""}
                  </span>
                  <OfferStatusBadge
                    status={revision.offerStatus}
                    onStatusChange={(status) =>
                      onStatusChange(revision.id, status)
                    }
                  />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Total including GST
                    </dt>
                    <dd className="font-mono tabular-nums">
                      {money(revision.totalAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Document version
                    </dt>
                    <dd>v{revision.version}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Amount excluding GST
                    </dt>
                    <dd className="font-mono tabular-nums">
                      {money(revision.amount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">GST</dt>
                    <dd className="font-mono tabular-nums">
                      {money(revision.gstAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Created</dt>
                    <dd className="font-mono tabular-nums">
                      {day(revision.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Sent</dt>
                    <dd className="font-mono tabular-nums">
                      {day(revision.sentAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Approved</dt>
                    <dd className="font-mono tabular-nums">
                      {day(revision.acceptedAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <Link
        href={`/offers/${group.leadId}`}
        className="mt-3 flex min-h-11 items-center justify-center rounded-lg border border-border text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        Open offer
      </Link>
    </article>
  );
}

/**
 * The collapsed summary row for one lead, plus the version-history panel when it
 * is open. Emits sibling `<tr>`s rather than nesting, so every summary row stays
 * on the outer table's single column grid.
 */
function OfferGroupRows({
  group,
  expanded,
  onToggle,
  onOpen,
  onStatusChange,
}: OfferGroupRowsProps) {
  const { latest, revisions, versionCount } = group;
  const hasHistory = versionCount > 1;
  const panelId = `offer-versions-${group.leadId}`;

  return (
    <>
      {/* A plain row, not role="button": that role replaced the row's table
          semantics, so a screen reader lost each cell's column header. The row
          click is a mouse shortcut; the Offer # link is the keyboard route. */}
      <tr
        onClick={() => onOpen(group.leadId)}
        className={cn(
          TABLE_ROW_CLASS,
          "cursor-pointer",
          TABLE_ROW_HOVER_CLASS,
          expanded && "bg-muted/30",
        )}
      >
        <td className={cn(TABLE_CELL_CLASS, "w-10 px-2")}>
          {hasHistory ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              aria-label={
                expanded
                  ? `Hide ${versionCount} versions`
                  : `Show ${versionCount} versions`
              }
              onClick={(event) => {
                event.stopPropagation();
                onToggle(group.leadId);
              }}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ChevronRight
                className={cn(
                  "size-4 transition-transform duration-200",
                  expanded && "rotate-90",
                )}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </td>
        <td
          className={cn(TABLE_CELL_CLASS, "font-mono font-medium tabular-nums")}
        >
          {/* stopPropagation: the row's click would push the same route again,
              and on cmd-click it would navigate this tab as well as opening
              the new one. */}
          <Link
            href={`/offers/${group.leadId}`}
            onClick={(event) => event.stopPropagation()}
            className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {group.reference}
          </Link>
        </td>
        <td className={TABLE_CELL_CLASS}>{group.lead?.name || "N/A"}</td>
        <td className={TABLE_CELL_CLASS}>
          {group.lead.type.length > 0 ? group.lead.type.join(", ") : "-"}
        </td>
        <td className={TABLE_CELL_CLASS}>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
              hasHistory
                ? "bg-muted text-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Layers className="size-3" aria-hidden="true" />
            {/* Names the revision the collapsed row's amounts and status come
                from, which the count alone did not. */}
            v{latest.revisionNumber} · {versionCount}{" "}
            {versionCount === 1 ? "version" : "versions"}
          </span>
        </td>
        <td
          className={cn(
            TABLE_CELL_CLASS,
            "whitespace-nowrap text-right font-mono tabular-nums",
          )}
        >
          {money(latest.amount)}
        </td>
        <td
          className={cn(
            TABLE_CELL_CLASS,
            "whitespace-nowrap text-right font-mono tabular-nums",
          )}
        >
          {money(latest.gstAmount)}
        </td>
        <td
          className={cn(
            TABLE_CELL_CLASS,
            "whitespace-nowrap text-right font-mono font-medium tabular-nums",
          )}
        >
          {money(latest.totalAmount)}
        </td>
        <td
          className={cn(
            TABLE_CELL_CLASS,
            "whitespace-nowrap font-mono tabular-nums",
          )}
        >
          {day(latest.sentAt)}
        </td>
        <td
          className={cn(
            TABLE_CELL_CLASS,
            "whitespace-nowrap font-mono tabular-nums",
          )}
        >
          {day(latest.acceptedAt)}
        </td>
        <td className={TABLE_CELL_CLASS}>
          <OfferStatusBadge
            status={latest.offerStatus}
            onStatusChange={(newStatus) => onStatusChange(latest.id, newStatus)}
          />
        </td>
      </tr>

      {expanded && hasHistory ? (
        <tr id={panelId} className={cn(TABLE_ROW_CLASS, "bg-muted/20")}>
          <td colSpan={OFFER_TABLE_HEADERS.length} className="px-4 py-3">
            <div className="ml-6 border-l-2 border-border pl-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Version history
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <caption className="sr-only">
                    {`Every version of the offer for ${group.lead.name || "this client"}`}
                  </caption>
                  <thead className={TABLE_HEAD_ROW_CLASS}>
                    <tr>
                      <th scope="col" className={TABLE_HEAD_CELL_CLASS}>
                        Version
                      </th>
                      <th
                        scope="col"
                        className={cn(TABLE_HEAD_CELL_CLASS, "text-right")}
                      >
                        Amount (Ex GST)
                      </th>
                      <th
                        scope="col"
                        className={cn(TABLE_HEAD_CELL_CLASS, "text-right")}
                      >
                        GST
                      </th>
                      <th
                        scope="col"
                        className={cn(TABLE_HEAD_CELL_CLASS, "text-right")}
                      >
                        Total
                      </th>
                      <th scope="col" className={TABLE_HEAD_CELL_CLASS}>
                        Created
                      </th>
                      <th scope="col" className={TABLE_HEAD_CELL_CLASS}>
                        Sent At
                      </th>
                      <th scope="col" className={TABLE_HEAD_CELL_CLASS}>
                        Approved At
                      </th>
                      <th scope="col" className={TABLE_HEAD_CELL_CLASS}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisions.map((revision) => (
                      <OfferRevisionRow
                        key={revision.id}
                        revision={revision}
                        onStatusChange={onStatusChange}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function OfferRevisionRow({
  revision,
  onStatusChange,
}: {
  revision: OfferListRow;
  onStatusChange: (offerId: string, status: OfferStatus) => Promise<void>;
}) {
  // The live revision is marked three ways, tint, a gold rule and the pill,
  // because the old pale tint was all but invisible and the 10px pill failed
  // AA contrast.
  return (
    <tr
      className={cn(
        TABLE_ROW_CLASS,
        revision.isActive && "bg-royal-gold-light/60",
      )}
    >
      <td
        className={cn(
          "px-3 py-2",
          revision.isActive && "shadow-[inset_3px_0_0_0_var(--royal-gold-ink)]",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium tabular-nums">
            v{revision.revisionNumber}
          </span>
          {revision.isActive ? (
            <span className="rounded-full bg-royal-gold-light px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-royal-gold-ink-text">
              Active
            </span>
          ) : null}
        </div>
        {/* Version of the generated document, which does not always track the
            revision number of the offer that produced it. */}
        <span className="text-[10.5px] text-muted-foreground">
          Doc v{revision.version}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
        {money(revision.amount)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
        {money(revision.gstAmount)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-medium tabular-nums">
        {money(revision.totalAmount)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
        {day(revision.createdAt)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
        {day(revision.sentAt)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
        {day(revision.acceptedAt)}
      </td>
      <td className="px-3 py-2">
        <OfferStatusBadge
          status={revision.offerStatus}
          onStatusChange={(newStatus) => onStatusChange(revision.id, newStatus)}
        />
      </td>
    </tr>
  );
}
