import { Skeleton } from "@/components/ui/skeleton";

export function ModalLoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="flex flex-col gap-4 py-3"
    >
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
