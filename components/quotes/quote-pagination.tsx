"use client";
import { PaginatedQuotesResult } from "@/types/quote";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useMemo, useState } from "react";

export function QuotePagination({ quotes, onPageChange }: { quotes: PaginatedQuotesResult; onPageChange: (page: number) => void }) {
  const [currentPage, setCurrentPage] = useState(quotes.page);
  const paginationItems = useMemo(() => {
    const totalPages = quotes.totalPages;

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
  }, [quotes, currentPage]);

  return (
    <>
      {quotes.totalCount > 0 ? (
        <div className="space-y-3 pt-2">
          <div className="text-center text-xs text-muted-foreground">
            Showing {quotes.items.length} of {quotes.totalCount} quotes
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    setCurrentPage((page) => Math.max(1, page - 1));
                  }}
                  aria-disabled={quotes.page === 1}
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
                      isActive={item === quotes.page}
                      onClick={(event) => {
                        event.preventDefault();
                        setCurrentPage(item);
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
                    setCurrentPage((page) =>
                      Math.min(quotes.totalPages, page + 1),
                    );
                  }}
                  aria-disabled={quotes.page >= quotes.totalPages}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
    </>
  );
}
