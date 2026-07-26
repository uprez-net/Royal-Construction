"use client";

import { RouteError } from "@/components/common/route-error";

export default function ProjectsError({
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
      title="Projects could not be loaded"
      description="The request for the project list failed on the server. Nothing has been changed — retrying is safe."
      fallbackHref="/dashboard"
      fallbackLabel="Go to dashboard"
    />
  );
}
