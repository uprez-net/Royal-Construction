import { Skeleton } from "@/components/ui/skeleton";

export default function OfferPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm sm:p-5 lg:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>

          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm"
          >
            <Skeleton className="size-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-5 w-12 rounded-md" />
          </div>
        ))}
      </div>

      {/* Table Card */}
      <div className="rounded-lg border border-border/70 bg-card shadow-sm">
        {/* Tabs */}
        <div className="border-b px-6 py-5">
          <div className="flex gap-6">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-20 rounded-full" />
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center justify-between px-6 py-4">
          <Skeleton className="h-10 w-72 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>

        {/* Table */}
        <div className="px-6 pb-6">
          <div className="overflow-hidden rounded-lg border">
            {/* Header */}
            <div className="grid grid-cols-9 gap-4 border-b bg-muted/40 px-4 py-4">
              {Array.from({ length: 9 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full max-w-20" />
              ))}
            </div>

            {/* Rows */}
            {Array.from({ length: 5 }).map((_, row) => (
              <div
                key={row}
                className="grid grid-cols-9 gap-4 border-b px-4 py-5 last:border-0"
              >
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-6 flex flex-col items-center gap-4">
            <Skeleton className="h-4 w-36" />

            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
