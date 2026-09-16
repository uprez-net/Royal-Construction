"use client";

import { RouteError } from "@/components/common/route-error";

export default function OffersError({
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
      title="Offers could not be loaded"
      description="The request for the offer list failed on the server. Nothing has been changed — retrying is safe."
      fallbackHref="/dashboard"
      fallbackLabel="Go to dashboard"
    />
  );
}
