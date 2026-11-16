import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight, Layers, Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <PageSkeleton
      label="Loading build sequence"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Project planning
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Build sequence
          </h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Loading activities, stages and tradie categories…
          </p>
        </div>
        <div className="flex gap-2" aria-hidden="true">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <Skeleton className="h-4 w-64 max-w-full" aria-hidden="true" />
      <div
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]"
        aria-hidden="true"
      >
        <Card>
          <CardHeader>
            <CardTitle as="h2">Activity order</CardTitle>
            <Skeleton className="mt-1 h-4 w-3/4" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {[0, 1, 2].map((stage) => (
              <div
                key={stage}
                className="overflow-hidden rounded-lg border border-border/70"
              >
                <div className="flex items-center gap-3 bg-muted/50 p-3">
                  <Layers className="size-4 text-muted-foreground" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="ml-auto h-5 w-7" />
                  <ChevronRight className="size-4 rotate-90 text-muted-foreground" />
                </div>
                <div className="flex flex-col gap-4 p-4">
                  {[0, 1, 2].map((row) => (
                    <div
                      key={row}
                      className="flex gap-3"
                      style={{ paddingLeft: row === 1 ? 24 : 0 }}
                    >
                      <Skeleton className="size-6 shrink-0" />
                      <div className="flex flex-1 flex-col gap-2">
                        <Skeleton className="h-4 w-4/5" />
                        <Skeleton className="h-3 w-2/5" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Activity details</CardTitle>
            <Skeleton className="mt-1 h-4 w-40" />
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {[0, 1, 2, 3, 4, 5].map((field) => (
              <div key={field} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-full" />
                {field > 2 ? <Skeleton className="h-3 w-4/5" /> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageSkeleton>
  );
}
