"use client";

import { useState } from "react";
import { toast } from "sonner";

import { checkMicrophone } from "@/components/comms/microphone";
import type { usePhone } from "@/components/comms/phone-provider";
import { useIdempotencyKeys } from "@/hooks/use-idempotency-key";
import { placeProjectCall } from "@/lib/leads/comms-service";
import type { CallablePhoneDto } from "@/lib/leads/comms-types";

import { useRefreshProjectCalls } from "./project-calls-queries";

// Placing a call from the project dialer, and the attempt keys behind it.
//
// Held by the header's Call button, which stays mounted, not by the dialer
// panel: closing the panel while a call is being placed must not drop the
// attempt's key, or reopening it and pressing Call again would send a new
// key for the same intent and could ring the person twice.
//
// One key per destination: a contact by their `ref`, a typed number by its
// E.164. A retry to the same person reuses the key (the outbox answers
// "already placed", or re-rings only after a definite refusal); a call to
// somebody else is a new intent. The route (browser or a phone) is not part
// of the key, as on a lead: a retry after a definite refusal may switch it,
// and the server rings whichever the retry asked for.

export type CallDestination =
  | { readonly kind: "contact"; readonly ref: string; readonly label: string }
  | { readonly kind: "number"; readonly e164: string; readonly label: string };

export type CallRoute =
  | { readonly target: "browser" }
  | { readonly target: "mobile"; readonly phone: CallablePhoneDto | null };

export type PlacingState = {
  /** The destination's key: a contact's ref, or "number:<e164>". */
  readonly key: string;
  readonly via: "people" | "keypad";
} | null;

function destinationKey(destination: CallDestination): string {
  return destination.kind === "contact"
    ? destination.ref
    : `number:${destination.e164}`;
}

export function useProjectCallPlacer(
  projectId: string,
  phone: ReturnType<typeof usePhone> | null,
) {
  const keys = useIdempotencyKeys();
  const refresh = useRefreshProjectCalls(projectId);
  const [placing, setPlacing] = useState<PlacingState>(null);

  /** True when the call was placed (or already had been). */
  async function place(
    destination: CallDestination,
    route: CallRoute,
  ): Promise<boolean> {
    if (placing) return false;
    if (phone?.active) {
      toast.error("Finish the current call first.");
      return false;
    }
    const viaBrowser = route.target === "browser";
    if (viaBrowser && phone?.status !== "ready") {
      toast.error(
        phone?.message
          ?? "The browser phone isn't connected yet. Pick a phone to take the call, or wait a moment.",
      );
      return false;
    }
    const key = destinationKey(destination);
    setPlacing({
      key,
      via: destination.kind === "number" ? "keypad" : "people",
    });
    try {
      if (viaBrowser) {
        // Before their phone rings: a blocked microphone found now costs
        // nothing; found after they pick up, they hear silence.
        const micProblem = await checkMicrophone();
        if (micProblem) {
          toast.error(micProblem);
          return false;
        }
      }
      const result = await placeProjectCall(
        projectId,
        destination.kind === "contact"
          ? { contactRef: destination.ref }
          : { number: destination.e164 },
        route.target,
        keys.current(key),
        route.target === "mobile" ? (route.phone?.id ?? null) : null,
      );
      // Placed: the next call to this destination is a new intent. A failure
      // keeps the key, so retrying the same attempt cannot ring twice.
      keys.rotate(key);
      if (viaBrowser) {
        phone?.expectOutboundCall({
          callId: result.call.id,
          leadName: result.call.contactName ?? destination.label,
        });
      }
      if (result.alreadyPlaced) {
        toast.info("That call was already placed — it wasn't placed again.");
      } else if (route.target === "mobile") {
        toast.success(
          `Calling ${destination.label}. ${route.phone?.nickname ?? "The office mobile"} rings when they answer.`,
        );
      }
      return true;
    } catch (placeError) {
      toast.error(
        placeError instanceof Error
          ? placeError.message
          : "The call couldn't be placed.",
      );
      return false;
    } finally {
      setPlacing(null);
      refresh();
    }
  }

  return { place, placing };
}

export type ProjectCallPlacer = ReturnType<typeof useProjectCallPlacer>;
