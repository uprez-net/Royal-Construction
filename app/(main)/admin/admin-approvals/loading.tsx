import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ApprovalDashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="flex items-center gap-4 p-5">
              <Skeleton className="h-10 w-10 rounded-lg" />

              <div className="space-y-2">
                <Skeleton className="h-7 w-10" />
                <Skeleton className="h-4 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <Skeleton className="h-10 w-full max-w-sm rounded-md" />

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-6 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Approval List */}
      <Card>
        <CardContent className="space-y-4 p-6">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="flex items-center gap-4">
                <Skeleton className="h-12 w-12 rounded-full" />

                <div className="space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-72" />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}