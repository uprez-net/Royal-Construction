"use client";
import { CardContent } from "../ui/card";
import { currency, dateFormat } from "@/utils/formatters";
import { ChevronRight, Layers, ReceiptText } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { KeyboardEvent } from "react";
import type {
  OfferGroup,
  OfferWithLead,
  PaginatedOfferGroupResult,
} from "@/types/offer";
import {
  fetchOffers,
  setOffers,
  updateOffer,
} from "@/lib/store/slices/offerSlice";
import { OfferPagination } from "./offer-pagination";
import { useRouter } from "next/navigation";
import { OfferStatusBadge } from "./offer-status-badge";
import { OfferStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { skeletonTableRows } from "../ui/skeleton";
import { webMcpError, webMcpJson } from "@/components/webmcp/tool-result";
import { useWebMcpTools } from "@/hooks/use-webmcp-tool";

/** Module-level so the registration hook's declaration hash stays stable. */
const searchOffersSchema = {
  type: "object",
  properties: {
    q: {
      type: "string",
      description:
        "Client name or offer reference to search for. Pass an empty string to clear the search and show every offer again.",
    },
  },
  required: ["q"],
  additionalProperties: false,
} as const;

/**
 * One offer group as the agent sees it — the same facts as the visible row.
 *
 * Deliberately not the raw OfferGroup: that carries the whole Lead on every row,
 * which is most of the payload and none of the answer. `leadId` is the id that
 * matters, because it is what navigate_to_offer takes.
 */
function toAgentRow(group: OfferGroup) {
  const { latest } = group;
  return {
    leadId: group.leadId,
    reference: group.reference,
    client: group.lead.name,
    type: group.lead.type,
    versionCount: group.versionCount,
    amountExGst: latest.amount,
    gstAmount: latest.gstAmount,
    totalAmount: latest.totalAmount,
    status: latest.offerStatus,
    sentAt: latest.sentAt ? new Date(latest.sentAt).toISOString() : null,
    acceptedAt: latest.acceptedAt ? new Date(latest.acceptedAt).toISOString() : null,
  };
}

const money = (value: string) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? currency.format(parsed) : "—";
};

const day = (value: Date | string | null) =>
  value ? dateFormat.format(new Date(value)) : "-";

// Index-matched to the header row; "end" right-aligns the money columns so the
// digits line up, the same convention DataTable uses.
const HEADERS = [
  { label: <span className="sr-only">Expand versions</span>, align: "start" },
  { label: "Offer #", align: "start" },
  { label: "Client", align: "start" },
  { label: "Type", align: "start" },
  { label: "Versions", align: "start" },
  { label: "Amount (Ex GST)", align: "end" },
  { label: "GST", align: "end" },
  { label: "Total", align: "end" },
  { label: "Sent At", align: "start" },
  { label: "Approved At", align: "start" },
  { label: "Status", align: "start" },
] as const;

export function OfferTable({
  serverOffers,
}: {
  serverOffers: PaginatedOfferGroupResult;
}) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { offers: stateOffers, loading } = useAppSelector(
    (state) => state.offers,
  );
  const [expandedLeadIds, setExpandedLeadIds] = useState<number[]>([]);

  const offers = useMemo(() => {
    if (stateOffers.items.length === 0) {
      return serverOffers;
    }
    return stateOffers;
  }, [stateOffers, serverOffers]);

  useEffect(() => {
    dispatch(setOffers(serverOffers));
  }, [serverOffers, dispatch]);

  const handlePageChange = async (page: number) => {
    try {
      // Expansion is keyed by lead id, which only identifies a row on the page
      // it was opened from, so a page change closes everything.
      setExpandedLeadIds([]);
      await dispatch(fetchOffers({ page, limit: offers.limit })).unwrap();
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

  /* ── WebMCP: the offers list ──
     Reads the rows already on screen rather than re-querying, so the agent and
     the user are looking at the same page of the same list. The status tabs are
     not part of this: `tabId` in offer-filter.tsx is local state nothing reads,
     so there is no filter to report and the payload says so rather than
     implying a filter was applied. */
  useWebMcpTools([
    {
      name: "get_offers",
      title: "List the offers on screen",
      description:
        "Returns the page of offers the user is currently looking at, one row per lead with its revision count and latest amounts. Use leadId with navigate_to_offer to open one. This is the visible page, not the whole database — check page against totalPages before concluding an offer does not exist, and use search_offers to narrow instead of paging through.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () =>
        webMcpJson({
          items: offers.items.map(toAgentRow),
          page: offers.page,
          limit: offers.limit,
          totalCount: offers.totalCount,
          totalPages: offers.totalPages,
          totalOfferCount: offers.totalOfferCount,
          // Said plainly because the screen implies otherwise: the tab strip
          // above the table renders Pending/Approved/Rejected/Sent buttons that
          // filter nothing. An agent that assumed they did would under-report.
          statusFilter: null,
          note: "No status filter is applied — the list's status tabs do not filter. Filter these rows yourself if the user asked for one status.",
        }),
    },
    {
      name: "search_offers",
      title: "Search the offers list",
      description:
        "Searches offers by client name or reference and replaces what the table shows. Pass an empty q to clear the search. Returns the same shape as get_offers. This moves the user's view, so say what you searched for.",
      inputSchema: searchOffersSchema as unknown as Record<string, unknown>,
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        if (typeof input.q !== "string") {
          return webMcpError("q is required. Pass an empty string to clear the search.");
        }
        const q = input.q.trim();

        try {
          // page 1: a search that kept the old page number would land on an
          // empty page whenever the result set shrank.
          const result = await dispatch(
            fetchOffers({ page: 1, limit: offers.limit, q }),
          ).unwrap();

          return webMcpJson({
            query: q,
            items: result.items.map(toAgentRow),
            page: result.page,
            limit: result.limit,
            totalCount: result.totalCount,
            totalPages: result.totalPages,
          });
        } catch (error) {
          return webMcpError(
            `Could not search offers: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
  ]);

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>, leadId: number) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      // Let the chevron and the status popover handle their own keys.
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      openGroup(leadId);
    },
    [openGroup],
  );

  return (
    <CardContent className="px-5 py-4">
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Offers grouped by client, each expandable to its version history
          </caption>
          <thead className="bg-muted/70 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {HEADERS.map((header, index) => (
                <th
                  key={`header-${index}`}
                  scope="col"
                  className={cn(
                    "px-4 py-3 font-medium",
                    header.align === "end"
                      ? "text-right tabular-nums"
                      : "text-left",
                    index === 0 && "w-10 px-2",
                  )}
                >
                  {header.label}
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
                  onRowKeyDown={handleRowKeyDown}
                  onStatusChange={handleStatusChange}
                />
              ))
            ) : (
              <tr>
                <td colSpan={HEADERS.length} className="px-4 py-16 text-center">
                  {loading ? (
                    skeletonTableRows(HEADERS.length, 5).map((row, rowIndex) => (
                      <tr key={`skeleton-row-${rowIndex}`} className="border-t border-border/70">
                        {row.map((cell, cellIndex) => (
                          <td key={`skeleton-cell-${cellIndex}`} className="px-4 py-3">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="flex size-12 items-center justify-center">
                        <ReceiptText className="size-5 text-muted-foreground" />
                      </div>

                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          No offers available
                        </p>

                        <p className="text-xs text-muted-foreground">
                          Your offers will appear here.
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
      <OfferPagination offers={offers} onPageChange={handlePageChange} />
    </CardContent>
  );
}

interface OfferGroupRowsProps {
  group: OfferGroup;
  expanded: boolean;
  onToggle: (leadId: number) => void;
  onOpen: (leadId: number) => void;
  onRowKeyDown: (
    event: KeyboardEvent<HTMLTableRowElement>,
    leadId: number,
  ) => void;
  onStatusChange: (offerId: string, status: OfferStatus) => Promise<void>;
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
  onRowKeyDown,
  onStatusChange,
}: OfferGroupRowsProps) {
  const { latest, revisions, versionCount } = group;
  const hasHistory = versionCount > 1;
  const panelId = `offer-versions-${group.leadId}`;

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-label={`Open offer for ${group.lead.name || "unnamed client"}`}
        onClick={() => onOpen(group.leadId)}
        onKeyDown={(event) => onRowKeyDown(event, group.leadId)}
        className={cn(
          "border-t border-border/70 transition-colors",
          "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          expanded && "bg-muted/30",
        )}
      >
        <td className="w-10 px-2 py-3">
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
        <td className="px-4 py-3 font-medium">{group.reference}</td>
        <td className="px-4 py-3">{group.lead?.name || "N/A"}</td>
        <td className="px-4 py-3">
          {group.lead.type.length > 0 ? group.lead.type.join(", ") : "-"}
        </td>
        <td className="px-4 py-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              hasHistory
                ? "bg-teal-50 text-teal-700"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Layers className="size-3" aria-hidden="true" />
            {versionCount} {versionCount === 1 ? "version" : "versions"}
          </span>
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {money(latest.amount)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {money(latest.gstAmount)}
        </td>
        <td className="px-4 py-3 text-right font-medium tabular-nums">
          {money(latest.totalAmount)}
        </td>
        <td className="px-4 py-3">{day(latest.sentAt)}</td>
        <td className="px-4 py-3">{day(latest.acceptedAt)}</td>
        <td className="px-4 py-3">
          <OfferStatusBadge
            status={latest.offerStatus}
            onStatusChange={(newStatus) => onStatusChange(latest.id, newStatus)}
          />
        </td>
      </tr>

      {expanded && hasHistory ? (
        <tr id={panelId} className="border-t border-border/70 bg-muted/20">
          <td colSpan={HEADERS.length} className="px-4 py-3">
            <div className="ml-6 border-l-2 border-teal-200 pl-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Version history
              </p>
              <div className="overflow-x-auto rounded-md border border-border/70 bg-background">
                <table className="w-full border-collapse text-[13px]">
                  <caption className="sr-only">
                    {`Every version of the offer for ${group.lead.name || "this client"}`}
                  </caption>
                  <thead className="bg-muted/50 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-2 text-left font-medium"
                      >
                        Version
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        Amount (Ex GST)
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        GST
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        Total
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-left font-medium"
                      >
                        Created
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-left font-medium"
                      >
                        Sent At
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-left font-medium"
                      >
                        Approved At
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-left font-medium"
                      >
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
  revision: OfferWithLead;
  onStatusChange: (offerId: string, status: OfferStatus) => Promise<void>;
}) {
  return (
    <tr
      className={cn(
        "border-t border-border/70",
        revision.isActive && "bg-teal-50/40",
      )}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium tabular-nums">
            v{revision.revisionNumber}
          </span>
          {revision.isActive ? (
            <span className="rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
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
      <td className="px-3 py-2 text-right tabular-nums">
        {money(revision.amount)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {money(revision.gstAmount)}
      </td>
      <td className="px-3 py-2 text-right font-medium tabular-nums">
        {money(revision.totalAmount)}
      </td>
      <td className="px-3 py-2">{day(revision.createdAt)}</td>
      <td className="px-3 py-2">{day(revision.sentAt)}</td>
      <td className="px-3 py-2">{day(revision.acceptedAt)}</td>
      <td className="px-3 py-2">
        <OfferStatusBadge
          status={revision.offerStatus}
          onStatusChange={(newStatus) => onStatusChange(revision.id, newStatus)}
        />
      </td>
    </tr>
  );
}
