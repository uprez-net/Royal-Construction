import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import {
  OFFER_WORKFLOW_PHASES,
  OFFER_WORKFLOW_STEPS,
} from "@/lib/offer/workflow-steps";

// Mirrors OfferWorkspaceScreen's frame: command bar, step rail, one work pane,
// summary strip, in the same fixed-height box. The skeleton it replaces drew
// the old horizontal stepper above a 360px side rail, so the page jumped into a
// different layout when the workspace arrived.
export default function OfferWorkspaceSkeleton() {
  return (
    <PageSkeleton
      label="Loading offer workspace"
      className="flex h-[calc(100dvh-7.5rem)] min-h-125 flex-col overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm"
    >
      {/* Command bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 bg-white px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Skeleton className="h-5.5 w-28 shrink-0" />
          <Skeleton className="h-4 w-56 min-w-0" />
          <Skeleton className="hidden h-4 w-32 shrink-0 lg:block" />
          <Skeleton className="h-5.5 w-16 shrink-0 rounded-full" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-8 w-9 rounded-lg lg:w-36" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Step rail */}
        <div className="flex w-14 shrink-0 flex-col border-r border-border/70 bg-white/60 lg:w-60">
          <div className="flex-1 overflow-hidden py-2">
            {OFFER_WORKFLOW_PHASES.map((phase) => {
              const steps = OFFER_WORKFLOW_STEPS.filter(
                (step) => step.phase === phase.id,
              );
              if (steps.length === 0) {
                return null;
              }
              return (
                <div key={phase.id}>
                  <hr className="mx-3 my-2 border-border/70 lg:hidden" />
                  <div className="hidden h-7.5 items-end px-4 pb-1.5 lg:flex">
                    <Skeleton className="h-2 w-14" />
                  </div>
                  {steps.map((step) => (
                    <div
                      key={step.id}
                      className="flex items-center gap-2.5 px-4 py-2"
                    >
                      <Skeleton className="size-5 shrink-0 rounded-full" />
                      <div className="hidden min-w-0 flex-1 space-y-1.5 lg:block">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="h-3 w-36 max-w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="hidden items-center border-t border-border/70 px-4 py-2.5 lg:flex">
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        {/* Work pane */}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden px-5 py-5">
          <div className="space-y-4">
            <Skeleton className="h-6 w-40" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-9 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/70 bg-white px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Skeleton className="h-5.5 w-28 rounded-full" />
          <Skeleton className="h-6 w-28" />
        </div>
      </div>
    </PageSkeleton>
  );
}
