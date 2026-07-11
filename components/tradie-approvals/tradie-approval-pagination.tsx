import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { useMemo } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { setQuery } from "@/lib/store/slices/tradieApprovalSlice";

export function TradieApprovalPagination() {
  const dispatch = useAppDispatch();
  const { approvals, page, pageSize, totalCount } = useAppSelector(
    (state) => state.tradieApproval,
  );

  const totalPages = Math.ceil(totalCount / pageSize);
  const paginationItems = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);

    return items;
  }, [page, totalPages]);

  const onPageChange = (newPage: number) => {
    dispatch(setQuery({ page: newPage }));
  }

  return (
    <>
      {totalCount > 0 ? (
        <div className="space-y-3 pt-2">
          <div className="text-center text-xs text-muted-foreground">
            Showing {approvals.length} of {totalCount} approvals
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (page > 1) {
                      onPageChange(page - 1);
                    }
                  }}
                  aria-disabled={page === 1}
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
                      isActive={item === page}
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
                    if (page < totalPages) {
                      onPageChange(page + 1);
                    }
                  }}
                  aria-disabled={page >= totalPages}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
    </>
  );
}
