import {
  DataTableSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";
import { FLUSH_TABLE_CARD_CLASS } from "@/components/ui/table-styles";

export default function TradeTypesLoading() {
  return (
    <PageSkeleton label="Loading trade types" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div
        className={`rounded-xl bg-card py-4 shadow-sm ring-1 ring-foreground/4 ${FLUSH_TABLE_CARD_CLASS}`}
      >
        <div className="space-y-2 border-b border-border/70 px-4 pb-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="pt-9 md:pt-0">
          <div className="space-y-4">
            <div className="px-4 md:pt-5">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Skeleton className="h-11 w-full sm:flex-1" />
                <Skeleton className="h-11 w-24" />
                <Skeleton className="h-11 w-28" />
              </div>
            </div>
            <div className="px-4 md:px-0">
              <DataTableSkeleton columnCount={5} mobileColumns={1} flush />
            </div>
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
