"use client";

import { RouteError } from "@/components/common/route-error";

export default function TradieDetailError({
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
      title="This tradie could not be loaded"
      description="The request for this tradie's record failed on the server. Retrying re-reads it from the server. If it fails again the tradie may have been removed — check the tradie list."
      fallbackHref="/tradie-management"
      fallbackLabel="All tradies"
    />
  );
}
