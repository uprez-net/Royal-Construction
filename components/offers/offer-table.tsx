"use client";
import { CardContent } from "../ui/card";
import { currency, dateFormat } from "@/utils/formatters";
import { DataTable } from "../common/data-table";
import { ReceiptText, RefreshCw } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { OfferStatusLabels, PaginatedOfferResult } from "@/types/offer";
import { fetchOffers, setOffers } from "@/lib/store/slices/offerSlice";
import { OfferPagination } from "./offer-pagination";
import { useRouter } from "next/navigation";
import { OfferStatusBadge } from "./offer/offer-status-badge";

export function OfferTable({
  serverQuotes,
}: {
  serverQuotes: PaginatedOfferResult;
}) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { offers: stateOffers, loading } = useAppSelector(
    (state) => state.offers,
  );
  const offers = useMemo(() => {
    if (stateOffers.items.length === 0) {
      return serverQuotes;
    }
    return stateOffers;
  }, [stateOffers, serverQuotes]);

  useEffect(() => {
    dispatch(setOffers(serverQuotes));
  }, [serverQuotes, dispatch]);

  const handlePageChange = async (page: number) => {
    try {
      await dispatch(fetchOffers({ page, limit: offers.limit })).unwrap();
    } catch (error) {
      console.error("Error fetching offers for page", page, error);
      toast.error("Failed to load offers for page " + page);
    }
  };

  return (
    <CardContent className="px-5 py-4">
      <DataTable
        key={offers.items.map((offer) => offer.id).join("-")} // Force remount when offers change
        headers={[
          "Offer #",
          "Client",
          "Type",
          "Version",
          "Amount (Ex GST)",
          "GST",
          "Total",
          "Sent At",
          "Approved At",
          "Status",
        ]}
        rows={offers.items.map((row, index) => [
          `OF-${index + 1}`,
          row.lead?.name || "N/A",
          row.lead.type.length > 0 ? row.lead.type.join(", ") : "-",
          row.version,
          currency.format(parseFloat(row.amount)),
          currency.format(parseFloat(row.gstAmount)),
          currency.format(parseFloat(row.totalAmount)),
          row.sentAt ? dateFormat.format(row.sentAt) : "-",
          row.acceptedAt ? dateFormat.format(row.acceptedAt) : "-",
          <OfferStatusBadge key={row.id} status={row.offerStatus} />,
        ])}
        onRowClick={(rowIndex) => {
          const offer = offers.items[rowIndex];
          router.push(`/offers/${offer.leadId}`);
        }}
        emptyState={
          loading ? (
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="flex size-12 items-center justify-center">
                <RefreshCw className="animate-spin size-5 text-muted-foreground" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Loading offers...
                </p>

                <p className="text-xs text-muted-foreground">
                  Your offers will appear here.
                </p>
              </div>
            </div>
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
          )
        }
      />
      <OfferPagination offers={offers} onPageChange={handlePageChange} />
    </CardContent>
  );
}
