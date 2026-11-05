"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Phone, PhoneForwarded } from "lucide-react";

import { useOptionalPhone } from "@/components/comms/phone-provider";
import { Button } from "@/components/ui/button";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import {
  fetchWhatsAppCallPermission,
  requestWhatsAppCallPermission,
} from "@/lib/leads/comms-service";
import type { WhatsAppCallPermissionDto } from "@/lib/leads/comms-types";

// Calling a lead on WhatsApp from this browser. WhatsApp only lets a business
// call someone who tapped "Allow calls", so until they have this offers to
// ask (inside the 24-hour window, at most once a day).

export function WhatsAppCallButton({
  lead,
}: {
  lead: { id: number; name: string };
}) {
  const phone = useOptionalPhone();
  const askKey = useIdempotencyKey();
  const callKey = useIdempotencyKey();
  const [permission, setPermission] =
    useState<WhatsAppCallPermissionDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setPermission(await fetchWhatsAppCallPermission(lead.id, signal));
      } catch {
        if (!signal?.aborted) setPermission(null);
      }
    },
    [lead.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    // Deferred a tick, like the WhatsApp thread: never setState in the effect body.
    const first = window.setTimeout(() => void load(controller.signal), 0);
    // A grant arrives on the webhook while the modal is open.
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(first);
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  // Calling isn't switched on, or this browser has no phone: show nothing.
  if (!phone || !permission || !permission.enabled) return null;

  async function ask() {
    setBusy(true);
    try {
      const result = await requestWhatsAppCallPermission(
        lead.id,
        askKey.current(),
      );
      askKey.rotate();
      setPermission(result.permission);
      toast.success(
        result.alreadySent
          ? "That request had already been sent."
          : `Asked ${lead.name} to allow WhatsApp calls. You'll be able to call once they tap Allow.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The request couldn't be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function call() {
    if (!phone) return;
    setBusy(true);
    try {
      if (await phone.startWhatsAppCall(lead, callKey.current()))
        callKey.rotate();
    } finally {
      setBusy(false);
    }
  }

  if (permission.canCall) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || phone.active !== null}
        onClick={() => void call()}
        title={`Call ${lead.name} on WhatsApp from this browser`}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Phone className="size-3.5" aria-hidden="true" />
        )}
        Call
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy || !permission.canRequest}
      onClick={() => void ask()}
      title={permission.reason ?? undefined}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <PhoneForwarded className="size-3.5" aria-hidden="true" />
      )}
      {permission.status === "REQUESTED"
        ? "Waiting for permission"
        : "Ask to call"}
    </Button>
  );
}
