"use client";

import { format } from "date-fns";
import { Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  canRetryRequestEmail,
  MAX_AUTOMATIC_ATTEMPTS,
} from "@/lib/domain/tradies/request-delivery";
import { useAppDispatch } from "@/lib/store/hooks";
import { retryTradieRequestEmail } from "@/lib/store/slices/projectsSlice";
import { cn } from "@/lib/utils";
import type { TradieRequestDeliverySummary } from "@/types/project";

// Where a tradie request email stands, said the same way on the wizard's
// report, the quote cards, the coordination board and the alerts — with the
// same Retry button, which the domain's `canRetryRequestEmail` decides.

type Delivery = Pick<
  TradieRequestDeliverySummary,
  | "id"
  | "deliveryStatus"
  | "attempts"
  | "nextAttemptAt"
  | "sentAt"
  | "lastError"
>;

function time(value: Date | string): string {
  return format(new Date(value), "d MMM, h:mm a");
}

export function describeDelivery(
  delivery: Delivery,
  now: Date = new Date(),
): {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  detail: string | null;
} {
  switch (delivery.deliveryStatus) {
    case "SENT":
      return {
        detail: delivery.sentAt ? `Sent ${time(delivery.sentAt)}` : null,
        label: "Email sent",
        tone: "success",
      };
    case "SENDING":
      return { detail: null, label: "Sending…", tone: "neutral" };
    case "RETRYING":
      return canRetryRequestEmail(delivery, now)
        ? {
            detail:
              "The automatic retry did not run. Retry it now, or check again shortly.",
            label: "Retry overdue",
            tone: "danger",
          }
        : {
            detail: `Attempt ${delivery.attempts} of ${MAX_AUTOMATIC_ATTEMPTS} failed · next try ${
              delivery.nextAttemptAt ? time(delivery.nextAttemptAt) : "soon"
            }`,
            label: "Retrying",
            tone: "warning",
          };
    case "FAILED":
      return {
        detail: delivery.lastError,
        label: "Email failed",
        tone: "danger",
      };
  }
}

/** Retry one request email, if the rules allow it now. */
export function RetryEmailButton({
  projectId,
  delivery,
  tradieName,
  className,
}: {
  projectId: string;
  delivery: Delivery;
  tradieName: string;
  className?: string;
}) {
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  if (!canRetryRequestEmail(delivery, new Date())) return null;

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await dispatch(
        retryTradieRequestEmail({ projectId, recipientId: delivery.id }),
      ).unwrap();
      if (result.delivery.status === "SENT") {
        toast.success(`Request emailed to ${tradieName}.`);
      } else {
        toast.error(
          result.delivery.reason
            ?? `The email to ${tradieName} did not send. Try again shortly.`,
        );
      }
    } catch (error) {
      toast.error(
        typeof error === "string" ? error : "The email could not be retried.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-7 shrink-0 rounded-lg px-2 text-[11px]", className)}
      disabled={busy}
      aria-busy={busy}
      aria-label={`Retry the request email to ${tradieName}`}
      onClick={(event) => {
        // Rows and cards are controls of their own.
        event.stopPropagation();
        void retry();
      }}
    >
      {busy ? (
        <Loader2
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <RotateCw className="size-3.5" aria-hidden="true" />
      )}
      {busy ? "Retrying…" : "Retry"}
    </Button>
  );
}

/** The status pill, its detail line, and Retry when it is allowed. */
export function RequestDeliveryStatus({
  projectId,
  delivery,
  tradieName,
  compact = false,
}: {
  projectId: string;
  delivery: Delivery;
  tradieName: string;
  /** Pill and button only; the detail goes in the pill's title. */
  compact?: boolean;
}) {
  const state = describeDelivery(delivery);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span title={compact ? (state.detail ?? undefined) : undefined}>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </span>
        <RetryEmailButton
          projectId={projectId}
          delivery={delivery}
          tradieName={tradieName}
        />
      </div>
      {!compact && state.detail ? (
        <p className="text-xs text-muted-foreground">{state.detail}</p>
      ) : null}
    </div>
  );
}
