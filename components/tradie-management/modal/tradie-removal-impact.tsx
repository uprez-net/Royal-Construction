"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { fetchTradieRemovalImpact } from "@/lib/data/tradie-management";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { dateFormat, formatStatus } from "@/utils/formatters";

export function useTradieRemovalImpact(tradieId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["tradie-removal-impact", tradieId],
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const result = await fetchTradieRemovalImpact(tradieId);
      if (!result.ok) throw new Error(result.error);
      return result.schedules;
    },
  });
}

export function TradieRemovalImpact({
  impact,
}: {
  impact: ReturnType<typeof useTradieRemovalImpact>;
}) {
  if (impact.isPending || impact.isFetching) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking unfinished bookings…
      </p>
    );
  }
  if (impact.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Unable to check bookings</AlertTitle>
        <AlertDescription>
          <p>{impact.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void impact.refetch()}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const schedules = impact.data ?? [];
  return (
    <Alert variant={schedules.length ? "destructive" : "default"}>
      <AlertTriangle />
      <AlertTitle>
        {schedules.length
          ? `${schedules.length} unfinished booking${schedules.length === 1 ? "" : "s"} will be cancelled`
          : "No unfinished bookings"}
      </AlertTitle>
      <AlertDescription>
        <p>
          If approved, this tradie will leave the active directory and all
          unfinished bookings will be cancelled. Completed and declined
          schedules, contact details and approval history will be preserved.
        </p>
        {schedules.length > 0 && (
          <ul
            className="mt-2 max-h-40 space-y-2 overflow-y-auto"
            aria-label="Bookings affected by removal"
          >
            {schedules.map((schedule) => (
              <li key={schedule.id}>
                <span className="font-medium">{schedule.project.name}</span> ·{" "}
                {schedule.milestone?.name ?? "General task"}
                <br />
                {dateFormat.format(new Date(schedule.scheduledDate))} ·{" "}
                {formatStatus(schedule.status)}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">
          Bookings are checked again when the request is approved. Submitting a
          request makes no changes to bookings.
        </p>
      </AlertDescription>
    </Alert>
  );
}
