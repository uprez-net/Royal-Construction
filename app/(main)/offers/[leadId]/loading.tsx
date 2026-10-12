import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { OFFER_WORKSPACE_FRAME_CLASS } from "@/components/offers/new-workflow/shell/offer-workspace-layout";
import {
  OFFER_WORKFLOW_PHASES,
  OFFER_WORKFLOW_STEPS,
} from "@/lib/offer/workflow-steps";

export default function OfferWorkspaceSkeleton() {
  return (
    <PageSkeleton
      label="Loading offer workspace"
      className={OFFER_WORKSPACE_FRAME_CLASS}
    >
      <div className="flex shrink-0 flex-col gap-3 border-b border-border/70 bg-white px-3 py-3 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-2 md:px-4 md:py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:flex-1 md:flex-nowrap md:gap-2.5">
          <Skeleton className="order-first h-5 w-full md:order-none md:w-56" />
          <Skeleton className="h-5.5 w-28 shrink-0" />
          <Skeleton className="h-5.5 w-16 shrink-0 rounded-full" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="mr-auto space-y-1 md:mr-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="size-11 md:h-8 md:w-9" />
          <Skeleton className="h-11 w-24 md:h-8" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="shrink-0 border-b border-border/70 p-2 md:hidden">
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="hidden w-14 shrink-0 flex-col border-r border-border/70 bg-white/60 md:flex lg:w-60">
          <div className="flex-1 overflow-hidden py-2">
            {OFFER_WORKFLOW_PHASES.map((phase) => (
              <div key={phase.id}>
                <div className="hidden px-4 pb-1 pt-3 lg:block">
                  <Skeleton className="h-3 w-20" />
                </div>
                {OFFER_WORKFLOW_STEPS.filter(
                  (step) => step.phase === phase.id,
                ).map((step) => (
                  <div
                    key={step.id}
                    className="flex items-center gap-2.5 px-4 py-2"
                  >
                    <Skeleton className="size-5 shrink-0 rounded-full" />
                    <div className="hidden min-w-0 flex-1 space-y-1 lg:block">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-36" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="hidden border-t border-border/70 px-4 py-2.5 lg:block">
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3 md:p-5">
          <div className="space-y-4">
            <Skeleton className="h-6 w-40" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-11 w-full md:h-9" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 bg-white px-3 py-2.5 md:gap-x-6 md:px-5">
        <Skeleton className="h-11 w-full md:hidden" />
        <div className="hidden flex-wrap gap-x-6 gap-y-2 md:flex">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="ml-auto flex gap-3">
          <Skeleton className="h-5.5 w-24 rounded-full" />
          <Skeleton className="h-6 w-28" />
        </div>
      </div>
    </PageSkeleton>
  );
}
