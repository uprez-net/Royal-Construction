"use client";

import { RouteError } from "@/components/common/route-error";

export default function TradieApprovalError({
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
      title="Tradie approvals could not be loaded"
      description="The request for the approval queue failed on the server. Nothing has been changed — retrying is safe."
      fallbackHref="/dashboard"
      fallbackLabel="Go to dashboard"
    />
  );
}
