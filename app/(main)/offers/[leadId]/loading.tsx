import { Skeleton } from "@/components/ui/skeleton";

export default function OfferDetailsPageSkeleton() {
  return (
    <div className="flex h-[calc(100vh-120px)] overflow-hidden rounded-xl border bg-background">
      {/* Chat Panel */}
      <div className="flex w-105 flex-col border-r">
        {/* Header */}
        <div className="flex items-center gap-3 border-b p-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-6 w-40" />
        </div>

        {/* Chat Message */}
        <div className="flex-1 p-4">
          <div className="flex gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />

            <div className="flex-1 space-y-3 rounded-2xl border p-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[95%]" />
              <Skeleton className="h-4 w-[88%]" />
              <Skeleton className="h-4 w-[92%]" />
              <Skeleton className="h-4 w-[70%]" />
            </div>
          </div>
        </div>

        {/* Input */}
        <div className="border-t p-4">
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      </div>

      {/* Offer Preview */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Controls */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex gap-4">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>

          <div className="flex gap-3">
            <Skeleton className="h-9 w-28 rounded-md" />
            <Skeleton className="h-9 w-36 rounded-md" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        </div>

        {/* Document */}
        <div className="flex-1 overflow-auto bg-muted/30 p-8">
          <div className="mx-auto max-w-4xl rounded-lg border bg-white p-8 shadow-sm">
            {/* Header */}
            <Skeleton className="mb-8 h-12 w-full rounded-md" />

            {/* Company Name */}
            <div className="mb-8 flex flex-col items-center gap-3">
              <Skeleton className="h-10 w-[500px]" />
              <Skeleton className="h-4 w-48" />
            </div>

            {/* Proposal Title */}
            <div className="mb-8 flex flex-col items-center gap-3">
              <Skeleton className="h-8 w-80" />
              <Skeleton className="h-4 w-64" />
            </div>

            {/* Details Table */}
            <div className="mb-8 rounded-lg border overflow-hidden">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border-b p-4 last:border-b-0"
                >
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-52" />
                </div>
              ))}
            </div>

            {/* Promotion Box */}
            <div className="mb-8 rounded-lg border p-6">
              <div className="flex flex-col items-center gap-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-8 w-[450px]" />
                <Skeleton className="h-4 w-56" />
              </div>
            </div>

            {/* Additional Content */}
            <div className="space-y-6">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border p-6 space-y-4"
                >
                  <Skeleton className="h-6 w-52" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-[95%]" />
                  <Skeleton className="h-4 w-[85%]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}