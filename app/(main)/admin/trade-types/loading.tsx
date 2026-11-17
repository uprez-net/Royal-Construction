import { TableCard } from "@/components/common/list-toolbar";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import {
  DataTableSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function TradeTypesLoading() {
  return (
    <PageSkeleton label="Loading trade types" className="space-y-6">
      {/* Same layout and title height as PageHeader, so the swap does not jump. */}
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0">
          <Skeleton className="h-8 w-48 max-w-full" />
          <Skeleton className="mt-1 h-4 w-full max-w-2xl" />
          <Skeleton className="mt-1 h-4 w-2/3 max-w-md" />
          <Skeleton className="mt-1 h-4 w-1/2 max-w-xs" />
        </div>
      </div>
      <TableCard
        header={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-11 w-full" />
            </div>
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-28" />
          </div>
        }
      >
        <div className="p-4 sm:p-5 md:p-0">
          <DataTableSkeleton columnCount={5} mobileColumns={1} flush />
        </div>
      </TableCard>
    </PageSkeleton>
  );
}
