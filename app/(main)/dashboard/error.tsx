"use client";

import { RouteError } from "@/components/common/route-error";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="The dashboard could not be loaded"
      description="The request for the dashboard data failed on the server. Nothing has been changed — retrying is safe."
      fallbackHref="/offers"
      fallbackLabel="Go to offers"
    />
  );
}
