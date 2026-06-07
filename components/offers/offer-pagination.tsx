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
import { PaginatedOfferResult } from "@/types/offer";
import { useMemo, useState } from "react";

export function OfferPagination({ offers, onPageChange }: { offers: PaginatedOfferResult; onPageChange: (page: number) => void }) {
  const [currentPage, setCurrentPage] = useState(offers.page);
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
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    const page = Math.max(1, currentPage - 1);
                    setCurrentPage(page);
                    onPageChange(page);
                  }}
                  aria-disabled={offers.page === 1}
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
                      isActive={item === offers.page}
                      onClick={(event) => {
                        event.preventDefault();
                        setCurrentPage(item);
                        onPageChange(item);
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
                    setCurrentPage(page);
                    onPageChange(page);
                  }}
                  aria-disabled={offers.page >= offers.totalPages}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
    </>
  );
}
