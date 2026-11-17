import { ListToolbar, TableCard } from "@/components/common/list-toolbar";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import {
  DataTableSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function ManageTeamSkeleton() {
  return (
    <PageSkeleton
      label="Loading team management"
      className="container space-y-6 py-4 sm:py-10"
    >
      {/* Same layout and title height as PageHeader, so the swap does not jump. */}
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-1 h-4 w-96 max-w-full" />
        </div>
      </div>

      <ListToolbar
        start={
          <div className="flex gap-1.5">
            <Skeleton className="h-11 w-28 rounded-md" />
            <Skeleton className="h-11 w-24 rounded-md" />
          </div>
        }
      >
        <Skeleton className="h-11 w-full rounded-lg sm:w-55" />
      </ListToolbar>

      <div className="pt-5">
        <TableCard
          header={
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_11.25rem_auto] md:items-center">
              <Skeleton className="h-11 w-full md:h-[2.125rem]" />
              <Skeleton className="h-11 w-full sm:w-45 md:h-[2.125rem]" />
              <Skeleton className="h-11 w-full md:h-[2.125rem] md:w-24" />
            </div>
          }
        >
          <div className="p-4 sm:p-5 md:p-0">
            <DataTableSkeleton columnCount={4} mobileColumns={1} flush />
          </div>
        </TableCard>
        <div className="space-y-3 pt-2">
          <Skeleton className="mx-auto h-11 w-60" />
        </div>
      </div>
    </PageSkeleton>
  );
}
