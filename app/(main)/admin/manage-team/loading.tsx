import { ListToolbar, TableCard } from "@/components/common/list-toolbar";
import {
  DataTableSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function ManageTeamSkeleton() {
  return (
    <PageSkeleton
      label="Loading team management"
      className="container py-4 sm:py-10"
    >
      <div className="mb-8 space-y-5 rounded-xl bg-card px-4 py-4 shadow-sm ring-1 ring-foreground/4 sm:px-5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
          <Skeleton className="h-11 w-full sm:flex-1" />
          <Skeleton className="h-11 w-full sm:w-45" />
          <Skeleton className="h-11 w-full sm:w-24" />
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
        <TableCard>
          <div className="p-4 sm:p-5 md:p-0">
            <DataTableSkeleton columnCount={5} mobileColumns={1} flush />
          </div>
        </TableCard>
        <div className="space-y-3 pt-2">
          <Skeleton className="mx-auto h-11 w-60" />
        </div>
      </div>
    </PageSkeleton>
  );
}
