import { TableCard } from "@/components/common/list-toolbar";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

// Stands in for the Admin hub while its statuses load: the header, then one
// card of eight tool rows, the same shape as the page.
export default function AdminHubSkeleton() {
  return (
    <PageSkeleton
      label="Loading admin tools"
      className="space-y-6 min-h-[85vh]"
    >
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
      </div>
      <TableCard>
        <ul className="divide-y divide-border/70">
          {Array.from({ length: 8 }).map((_, index) => (
            <li
              key={index}
              className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3.5 w-full max-w-md" />
              </div>
              <Skeleton className="h-[22px] w-24 shrink-0 rounded-full" />
            </li>
          ))}
        </ul>
      </TableCard>
    </PageSkeleton>
  );
}
