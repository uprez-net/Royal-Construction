import { Skeleton } from "@/components/ui/skeleton";

export default function TradieDetailsSkeleton() {
  return (
    <div className="space-y-4">
      {/* Back Button */}
      <Skeleton className="h-5 w-32" />

      {/* Header */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-xl" />

            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <div className="flex gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-10 w-32 rounded-lg" />
            <Skeleton className="h-10 w-24 rounded-lg" />
            <Skeleton className="h-10 w-32 rounded-lg" />
            <Skeleton className="h-10 w-24 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Details + Rating */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Contact Card */}
        <div className="rounded-xl border bg-card p-6">
          <Skeleton className="mb-8 h-7 w-64" />

          <div className="grid gap-8 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-48" />
              </div>
            ))}
          </div>
        </div>

        {/* Rating Card */}
        <div className="rounded-xl border bg-card p-6">
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-7 w-32" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-4">
                <Skeleton className="mx-auto mb-3 h-4 w-20" />
                <Skeleton className="mx-auto h-8 w-16" />
              </div>

              <div className="rounded-lg border p-4">
                <Skeleton className="mx-auto mb-3 h-4 w-20" />
                <Skeleton className="mx-auto h-8 w-12" />
              </div>
            </div>

            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        </div>
      </div>

      {/* Incidents */}
      <div className="rounded-xl border bg-card p-6">
        <Skeleton className="mb-6 h-7 w-40" />

        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <Skeleton className="h-5 w-64" />
                  <Skeleton className="h-4 w-96" />
                  <Skeleton className="h-4 w-80" />
                </div>

                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
