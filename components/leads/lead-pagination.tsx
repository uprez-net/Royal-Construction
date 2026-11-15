import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ResultStatus } from "@/components/common/result-status";
import { useMemo } from "react";
import type { PaginatedLeadsResult } from "@/lib/data/leads";

interface LeadPaginationProps {
  leads: PaginatedLeadsResult;
  onPageChange: (page: number) => void;
}

export function LeadPagination({ leads, onPageChange }: LeadPaginationProps) {
  const paginationItems = useMemo(() => {
    const totalPages = leads.totalPages;

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, leads.page - 1);
    const end = Math.min(totalPages - 1, leads.page + 1);

    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);

    return items;
  }, [leads]);

  return (
    <div className={leads.totalCount > 0 ? "space-y-3 pt-2" : undefined}>
      <ResultStatus
        count={leads.totalCount}
        shown={leads.items.length}
        noun="lead"
        hideWhenEmpty
        className="text-center text-xs text-muted-foreground"
      />
      {leads.totalCount > 0 ? (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  if (leads.page > 1) {
                    onPageChange(leads.page - 1);
                  }
                }}
                aria-disabled={leads.page === 1}
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
                    isActive={item === leads.page}
                    onClick={(event) => {
                      event.preventDefault();
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
                  if (leads.page < leads.totalPages) {
                    onPageChange(leads.page + 1);
                  }
                }}
                aria-disabled={leads.page >= leads.totalPages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}
