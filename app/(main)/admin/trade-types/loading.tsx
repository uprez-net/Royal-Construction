import { TableCard } from "@/components/common/list-toolbar";
import {
  DataTableSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function TradeTypesLoading() {
  return (
    <PageSkeleton label="Loading trade types" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-5">
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Skeleton className="h-11 w-full sm:flex-1" />
          <Skeleton className="h-11 w-24" />
          <Skeleton className="h-11 w-28" />
        </div>
        <TableCard>
          <div className="p-4 sm:p-5 md:p-0">
            <DataTableSkeleton columnCount={5} mobileColumns={1} flush />
          </div>
        </TableCard>
      </div>
    </PageSkeleton>
  );
}
