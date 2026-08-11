"use client";

import { RouteError } from "@/components/common/route-error";

export default function ProjectDetailError({
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
      title="This project could not be loaded"
      description="The project data did not load. Retrying re-reads it from the server. If it fails again the project may have been deleted — check the projects list."
      fallbackHref="/projects"
      fallbackLabel="All projects"
    />
  );
}
