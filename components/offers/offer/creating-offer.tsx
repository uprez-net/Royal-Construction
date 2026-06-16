"use client";

import {
  useWorkflowStream,
  WorkflowStreamProvider,
} from "@/context/WorkFlowStatusContext";
import { OfferCreationStatus } from "@/lib/workflow/offer";
import {
  Sparkles,
  Database,
  FileText,
  Save,
  Bell,
  CheckCircle2,
  Check,
  Loader2,
  X,
  Minus,
  AlertTriangle,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/utils/fetch";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { addMinutes, differenceInSeconds } from "date-fns";

const STEPS = [
  {
    key: "FETCHING_DETAILS",
    label: "Fetching project details",
    icon: Database,
  },
  { key: "BUILDING_OFFER", label: "Building offer document", icon: FileText },
  { key: "SAVING_OFFER", label: "Saving offer", icon: Save },
  { key: "TRIGGERING_NOTIFICATION", label: "Sending notification", icon: Bell },
  { key: "COMPLETED", label: "Offer ready", icon: CheckCircle2 },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function getStepState(
  key: StepKey,
  currentStatus: OfferCreationStatus["status"],
  failed?: boolean,
) {
  const currentIdx = STEPS.findIndex((s) => s.key === currentStatus);
  const thisIdx = STEPS.findIndex((s) => s.key === key);

  if (failed && thisIdx === currentIdx) return "failed";
  if (thisIdx < currentIdx || currentStatus === "COMPLETED") return "done";
  if (thisIdx === currentIdx) return "active";
  return "idle";
}

function CreatingOffer({
  leadId,
  updatedAt,
  initialRunStatus,
}: {
  leadId: number;
  updatedAt: Date;
  initialRunStatus?: "RUNNING" | "COMPLETED" | "FAILED" | null;
}) {
  const router = useRouter();
  const { creatingOffer, startListening, runId, connected, loading } =
    useWorkflowStream();
  const [isPending, startTransition] = useTransition();
  const [timeLeft, setTimeLeft] = useState(0);
  const { status, progress, message, failed } = creatingOffer;

  const isComplete = status === "COMPLETED" && !failed;
  const isIdle = !runId && initialRunStatus !== "RUNNING";
  const isFailed = failed || (!runId && initialRunStatus === "FAILED");
  const isWorking = Boolean(runId) && (connected || loading || !isComplete);

  const { minutes, seconds } = useMemo(() => {
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    return { minutes: mins, seconds: secs };
  }, [timeLeft]);

  useEffect(() => {
    if (isComplete) {
      router.push(`/offers/${leadId}`);
    }
  }, [isComplete, leadId, router]);

  useEffect(() => {
    if (isIdle) {
      return;
    }

    const expiresAt = addMinutes(new Date(updatedAt), 25);

    const updateTimer = () => {
      const remaining = Math.max(0, differenceInSeconds(expiresAt, new Date()));

      setTimeLeft(remaining);

      if (remaining === 0) {
        clearInterval(interval);
      }
    };

    updateTimer();

    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [isIdle, updatedAt]);

  const handleReTrigger = async () => {
    try {
      const { data } = await fetchJson<{ runId: string; message: string }>(
        `/api/offer-create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ leadId }),
        },
        "Failed to trigger offer creation workflow",
      );
      toast.success("Offer generation started");
      startListening(data.runId);
    } catch (error) {
      console.error("Error re-triggering offer generation:", error);
      toast.error("Failed to re-trigger offer generation");
    }
  };

  return (
    <div className="flex min-h-[calc(100svh-96px)] items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-lg space-y-5 rounded-lg border border-border/70 bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
              isFailed ? "bg-destructive-light" : "bg-royal-gold-light",
            )}
          >
            {isFailed ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : isComplete ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : isIdle ? (
              <Sparkles className="h-5 w-5 text-foreground" />
            ) : (
              <Sparkles className="h-5 w-5 animate-pulse text-foreground" />
            )}
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold leading-tight">
                {isFailed
                  ? "Offer generation failed"
                  : isComplete
                    ? "Offer generated"
                    : isIdle
                      ? "Offer not started"
                      : "Generating your offer"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {isFailed
                  ? "An error occurred. Please try again."
                  : isComplete
                    ? "Your document is ready to review."
                    : isIdle
                      ? "Start generation when you're ready."
                      : "Analyzing project details."}
              </p>
            </div>

            {(isFailed || isIdle) && (
              <Button
                variant="outline"
                size="sm"
                className="w-full bg-card sm:w-auto"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => {
                    void handleReTrigger();
                  })
                }
              >
                <RotateCw
                  className={cn("mr-2 h-4 w-4", isPending && "animate-spin")}
                />
                {isFailed ? "Retry" : "Start"}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="relative pt-4">
            <span className="absolute right-0 top-0 text-xs font-medium text-muted-foreground">
              {minutes > 0 && seconds > 0
                ? `${minutes}:${seconds.toString().padStart(2, "0")}`
                : "Taking longer than expected..."}
            </span>

            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out",
                  isFailed ? "bg-destructive" : "bg-royal-gold",
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {isFailed
                ? "Failed"
                : isComplete
                  ? "Done"
                  : isWorking
                    ? "Please wait"
                    : "Ready"}
            </span>
            <span>{progress}%</span>
          </div>
        </div>

        <div className="space-y-2">
          {STEPS.map(({ key, label, icon: Icon }) => {
            const state = isIdle ? "idle" : getStepState(key, status, isFailed);
            const isActive = state === "active";
            const isDone = state === "done";
            const isStepFailed = state === "failed";
            const stepMessage = message.find((m) => m.step === key);

            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isDone && "bg-success-light",
                  isActive && "bg-royal-gold-light",
                  isStepFailed && "bg-destructive-light",
                  state === "idle" && "bg-muted/40",
                )}
              >
                <div
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    isDone && "bg-success",
                    isActive && "bg-royal-gold",
                    isStepFailed && "bg-destructive",
                    state === "idle" && "bg-muted-foreground/20",
                  )}
                >
                  {isDone && <Check className="h-3 w-3 text-white" />}
                  {isActive && (
                    <Loader2 className="h-3 w-3 text-white animate-spin" />
                  )}
                  {isStepFailed && <X className="h-3 w-3 text-white" />}
                  {state === "idle" && (
                    <Minus className="h-3 w-3 text-muted-foreground/50" />
                  )}
                </div>

                {/* Label + detail */}
                <div className="flex-1 min-w-0">
                  <span
                    className={cn(
                      "font-medium",
                      isDone && "text-foreground",
                      isActive && "text-foreground",
                      isStepFailed && "text-destructive",
                      state === "idle" && "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                  {(isActive || isDone || isFailed) &&
                    stepMessage?.details &&
                    key === stepMessage.step && (
                      <p className="text-xs text-muted-foreground text-wrap mt-0.5">
                        {stepMessage.details}
                      </p>
                    )}
                </div>

                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isDone && "text-success",
                    isActive && "text-royal-gold",
                    isStepFailed && "text-destructive",
                    state === "idle" && "text-muted-foreground/30",
                  )}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CreatingOfferClient({
  runId,
  leadId,
  updatedAt,
  runStatus,
}: {
  runId: string | null;
  leadId: number;
  updatedAt: Date;
  runStatus?: "RUNNING" | "COMPLETED" | "FAILED" | null;
}) {
  return (
    <WorkflowStreamProvider initialRunId={runId}>
      <CreatingOffer
        leadId={leadId}
        updatedAt={updatedAt}
        initialRunStatus={runStatus}
      />
    </WorkflowStreamProvider>
  );
}
