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
      <div className="mb-8 w-full rounded-lg border border-border/70 bg-card py-4 shadow-sm">
        <div className="space-y-2 px-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-72" />
        </div>
        <div className="mt-4 space-y-4 px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
            <Skeleton className="h-11 w-full sm:flex-1" />
            <Skeleton className="h-11 w-full sm:w-45" />
            <Skeleton className="h-11 w-full sm:w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-11 w-28 sm:h-9" />
            <Skeleton className="h-11 w-24 sm:h-9" />
          </div>
          <Skeleton className="h-11 w-full" />
          <DataTableSkeleton columnCount={5} mobileColumns={1} />
          <Skeleton className="mx-auto h-11 w-60" />
        </div>
      </div>
    </PageSkeleton>
  );
}
