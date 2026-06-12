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
} from "lucide-react";
import { cn } from "@/lib/utils";

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

function CreatingOffer() {
  const { creatingOffer } = useWorkflowStream();
  const { status, progress, message, failed } = creatingOffer;

  const isComplete = status === "COMPLETED" && !failed;

  return (
    <div className="flex min-h-100 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full",
              failed ? "bg-destructive/10" : "bg-primary/10",
            )}
          >
            {failed ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : isComplete ? (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            ) : (
              <Sparkles className="h-5 w-5 text-primary animate-pulse" />
            )}
          </div>
          <div>
            <h3 className="font-semibold leading-tight">
              {failed
                ? "Offer generation failed"
                : isComplete
                  ? "Offer generated"
                  : "Generating your offer"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {failed
                ? "An error occurred. Please try again."
                : isComplete
                  ? "Your document is ready to review."
                  : "Analyzing project details…"}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out",
                failed ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {failed ? "Failed" : isComplete ? "Done" : "Please wait"}
            </span>
            <span>{progress}%</span>
          </div>
        </div>

        {/* Step list */}
        <div className="space-y-2">
          {STEPS.map(({ key, label, icon: Icon }) => {
            const state = getStepState(key, status, failed);
            const isActive = state === "active";
            const isDone = state === "done";
            const isFailed = state === "failed";

            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isDone && "bg-emerald-50 dark:bg-emerald-950/20",
                  isActive && "bg-primary/5",
                  isFailed && "bg-destructive/5",
                  state === "idle" && "bg-muted/40",
                )}
              >
                {/* Step dot */}
                <div
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    isDone && "bg-emerald-500",
                    isActive && "bg-primary",
                    isFailed && "bg-destructive",
                    state === "idle" && "bg-muted-foreground/20",
                  )}
                >
                  {isDone && <Check className="h-3 w-3 text-white" />}
                  {isActive && (
                    <Loader2 className="h-3 w-3 text-white animate-spin" />
                  )}
                  {isFailed && <X className="h-3 w-3 text-white" />}
                  {state === "idle" && (
                    <Minus className="h-3 w-3 text-muted-foreground/50" />
                  )}
                </div>

                {/* Label + detail */}
                <div className="flex-1 min-w-0">
                  <span
                    className={cn(
                      "font-medium",
                      isDone && "text-emerald-700 dark:text-emerald-400",
                      isActive && "text-primary",
                      isFailed && "text-destructive",
                      state === "idle" && "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                  {(isActive || isDone) &&
                    message?.details &&
                    key === message.step && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {message.details}
                      </p>
                    )}
                </div>

                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isDone && "text-emerald-500",
                    isActive && "text-primary",
                    isFailed && "text-destructive",
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

export function CreatingOfferClient({ runId }: { runId: string }) {
  return (
    <WorkflowStreamProvider initialRunId={runId}>
      <CreatingOffer />
    </WorkflowStreamProvider>
  );
}
