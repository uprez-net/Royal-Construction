"use client";

import { useEffect, useState } from "react";
import type { HbcfProjectBreach } from "@/lib/insurance/hbcf";
import { fetchJson } from "@/utils/fetch";

/**
 * The outcome of one completed fetch, tagged with the project it belongs to.
 *
 * Same shape as `useHbcfTimeline`'s result, and for the same reason: keeping the
 * id inside the state lets `loading` be derived during render, so a result for
 * the previous project is never mistaken for this one's.
 */
interface BreachResult {
  projectId: string;
  data: HbcfProjectBreach | null;
  error: string | null;
}

/**
 * Loads the HBCF pool overrun, if any, that this project's cover window is part
 * of.
 *
 * The badge owns its own data rather than taking it as a prop, so the project
 * header and the detail screen above it stay unaware of the insurance book. A
 * `null` payload is the ordinary answer — no breach — not a failure.
 */
export function useHbcfProjectBreach(projectId: string) {
  const [result, setResult] = useState<BreachResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchJson<HbcfProjectBreach | null>(
      `/api/insurance/hbcf-project-breach?projectId=${encodeURIComponent(projectId)}`,
      { method: "GET" },
      "Failed to load HBCF capacity check",
      controller.signal,
    )
      .then((response) =>
        setResult({ projectId, data: response.data, error: null }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        console.error("useHbcfProjectBreach error", error);
        setResult({
          projectId,
          data: null,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load HBCF capacity check",
        });
      });

    return () => controller.abort();
  }, [projectId]);

  const settled = result?.projectId === projectId ? result : null;

  return {
    data: settled?.data ?? null,
    loading: settled === null,
    error: settled?.error ?? null,
  } as const;
}
