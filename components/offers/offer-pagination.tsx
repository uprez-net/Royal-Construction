"use client";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { PaginatedOfferGroupResult } from "@/types/offer";
import { useMemo } from "react";

export function OfferPagination({ offers, onPageChange }: { offers: PaginatedOfferGroupResult; onPageChange: (page: number) => void }) {
  // Read the page off the fetched result rather than holding a second copy in
  // state: a local `useState(offers.page)` initialiser never re-syncs, so the
  // window of page numbers and the highlighted page drifted apart after a
  // search reset the result to page 1.
  const currentPage = offers.page;
  const paginationItems = useMemo(() => {
    const totalPages = offers.totalPages;

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);

    return items;
  }, [offers, currentPage]);

  return (
    <>
      {offers.totalCount > 0 ? (
        <div className="space-y-3 pt-2">
          <div className="text-center text-xs text-muted-foreground">
            Showing {offers.items.length} of {offers.totalCount} offers
            {offers.totalOfferCount > offers.totalCount
              ? ` (${offers.totalOfferCount} versions in this view)`
              : null}
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    const page = Math.max(1, currentPage - 1);
                    if (page !== currentPage) onPageChange(page);
                  }}
                  aria-disabled={currentPage === 1}
                />
              </PaginationItem>
              {paginationItems.map((item, index) =>
                item === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink
                      href="#"
                      isActive={item === currentPage}
                      onClick={(event) => {
                        event.preventDefault();
                        if (item !== currentPage) onPageChange(item);
                      }}
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    const page = Math.min(offers.totalPages, currentPage + 1);
                    if (page !== currentPage) onPageChange(page);
                  }}
                  aria-disabled={currentPage >= offers.totalPages}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
    </>
  );
}
