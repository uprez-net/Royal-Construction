"use client";

import { RouteError } from "@/components/common/route-error";

export default function TradieManagementError({
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
      title="Tradies could not be loaded"
      description="The request for tradie records failed on the server. Nothing has been changed — retrying is safe."
      fallbackHref="/dashboard"
      fallbackLabel="Go to dashboard"
    />
  );
}
