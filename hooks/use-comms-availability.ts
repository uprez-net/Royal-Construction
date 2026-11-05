"use client";

import { useEffect, useState } from "react";

import { fetchCommsStatus } from "@/lib/leads/comms-service";

/**
 * Whether this deployment can call or text through the app. Read once per
 * page load and shared, so a list of fifty rows asks once. Until it answers,
 * or when it fails, both are false and callers keep their plain `tel:` link.
 */
export type CommsAvailability = { calls: boolean; sms: boolean };

let pending: Promise<CommsAvailability> | null = null;

function load(): Promise<CommsAvailability> {
  pending ??= fetchCommsStatus()
    .then((status) => ({
      calls: status.callsAvailable,
      sms: status.smsAvailable,
    }))
    .catch(() => {
      pending = null;
      return { calls: false, sms: false };
    });
  return pending;
}

export function useCommsAvailability(): CommsAvailability {
  const [availability, setAvailability] = useState<CommsAvailability>({
    calls: false,
    sms: false,
  });
  useEffect(() => {
    let cancelled = false;
    void load().then((value) => {
      if (!cancelled) setAvailability(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return availability;
}
