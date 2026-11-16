import {
  DataTableSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";
import { FLUSH_TABLE_CARD_CLASS } from "@/components/ui/table-styles";

export default function ManageTeamSkeleton() {
  return (
    <PageSkeleton
      label="Loading team management"
      className="container py-4 sm:py-10"
    >
      <div
        className={`mb-8 w-full rounded-xl bg-card py-4 shadow-sm ring-1 ring-foreground/4 ${FLUSH_TABLE_CARD_CLASS}`}
      >
        <div className="space-y-2 px-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-72" />
        </div>
        <div className="mt-4 space-y-4 px-4 md:mt-0 md:px-4 md:pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
            <Skeleton className="h-11 w-full sm:flex-1" />
            <Skeleton className="h-11 w-full sm:w-45" />
            <Skeleton className="h-11 w-full sm:w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-11 w-28 sm:h-9" />
            <Skeleton className="h-11 w-24 sm:h-9" />
          </div>
        </div>
        <div className="mt-4 px-4">
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="mt-4 px-4 md:px-0">
          <DataTableSkeleton columnCount={5} mobileColumns={1} flush />
        </div>
        <div className="px-4 pt-2 md:pb-4">
          <Skeleton className="mx-auto h-11 w-60" />
        </div>
      </div>
    </PageSkeleton>
  );
}
