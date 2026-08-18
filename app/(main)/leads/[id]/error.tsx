"use client";

import { RouteError } from "@/components/common/route-error";

export default function LeadDetailError({
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
      title="This lead could not be loaded"
      description="The lead data did not load. Retrying re-reads it from the server. If it fails again the lead may have been deleted, or the id in the URL may not belong to a lead — check the leads list."
      fallbackHref="/leads"
      fallbackLabel="All leads"
    />
  );
}
