import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ManageTeamSkeleton() {
  return (
    <PageSkeleton label="Loading team management" className="container py-10">
      <div className="mb-8 w-full rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="space-y-2 border-b p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="space-y-4 p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Skeleton className="h-10 flex-1 rounded-md" />
            <Skeleton className="h-10 w-45 rounded-md" />
            <Skeleton className="h-10 w-24 rounded-md" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
          <Skeleton className="h-10 w-full rounded-md" />
          <div className="overflow-x-auto">
            <div className="min-w-[480px] space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="grid grid-cols-4 gap-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-8 w-28 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
