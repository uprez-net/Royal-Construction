"use client";

import { useEffect, useState } from "react";
import type { HbcfTimelinePayload } from "@/lib/insurance/hbcf";
import { fetchJson } from "@/utils/fetch";

/**
 * The outcome of one completed fetch, tagged with the lead it belongs to.
 *
 * Keeping the lead id inside the state is what lets `loading` be derived during
 * render rather than set from inside the effect: a result for a different lead
 * is, by definition, not yet loaded for this one.
 */
interface TimelineResult {
  leadId: number;
  data: HbcfTimelinePayload | null;
  error: string | null;
}

/**
 * Loads the HBCF claim capacity picture for one lead.
 *
 * The card owns its own data (§3) rather than taking it as a prop, so the lead
 * detail screen stays unaware of the insurance book.
 */
export function useHbfcTimeline(leadId: number) {
  const [result, setResult] = useState<TimelineResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchJson<HbcfTimelinePayload>(
      `/api/insurance/hbcf-timeline?leadId=${leadId}`,
      { method: "GET" },
      "Failed to load HBCF claim timeline",
      controller.signal,
    )
      .then((response) =>
        setResult({ leadId, data: response.data, error: null }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        console.error("useHbfcTimeline error", error);
        setResult({
          leadId,
          data: null,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load HBCF claim timeline",
        });
      });

    return () => controller.abort();
  }, [leadId]);

  const settled = result?.leadId === leadId ? result : null;

  return {
    data: settled?.data ?? null,
    loading: settled === null,
    error: settled?.error ?? null,
  } as const;
}
