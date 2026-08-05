import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

export default function OfferPageSkeleton() {
  return (
    <div className="space-y-6">
      <Spinner className="mx-auto" />
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-6 w-1/4" />
    </div>
  );
}
