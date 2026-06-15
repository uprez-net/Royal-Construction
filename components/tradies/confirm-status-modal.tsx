"use client";

import { useState, useTransition } from "react";
import {
  Box,
  Check,
  CheckCircle2,
  CheckCheck,
  Clock3,
  Loader2,
  PhoneOff,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { updateTradieScheduleStatus } from "@/lib/store/slices/tradiesSlice";
import type { TradieScheduleStatus } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { TradieScheduleListItem } from "@/types/project";

type ScheduleStatus =
  | "PENDING"
  | "PENDING_RESPONSE"
  | "CONFIRMED"
  | "NO_RESPONSE"
  | "AWAITING_MATERIALS"
  | "DECLINED"
  | "COMPLETED";

const statusOptions: {
  value: ScheduleStatus;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
}[] = [
  {
    value: "CONFIRMED",
    label: "Confirmed",
    description: "Tradie confirmed and will attend",
    icon: <CheckCircle2 className="h-5 w-5" />,
    color: "var(--success)",
    bg: "var(--success-light)",
    border: "color-mix(in oklab, var(--success) 24%, var(--border))",
  },

  {
    value: "PENDING_RESPONSE",
    label: "Pending Response",
    description: "Awaiting tradie response",
    icon: <Clock3 className="h-5 w-5" />,
    color: "var(--warning)",
    bg: "var(--warning-light)",
    border: "color-mix(in oklab, var(--warning) 24%, var(--border))",
  },

  {
    value: "NO_RESPONSE",
    label: "No Response",
    description: "Multiple attempts, no response",
    icon: <PhoneOff className="h-5 w-5" />,
    color: "var(--destructive)",
    bg: "var(--destructive-light)",
    border: "color-mix(in oklab, var(--destructive) 24%, var(--border))",
  },

  {
    value: "AWAITING_MATERIALS",
    label: "Awaiting Materials",
    description: "Confirmed but waiting on materials",
    icon: <Box className="h-5 w-5" />,
    color: "var(--info)",
    bg: "var(--info-light)",
    border: "color-mix(in oklab, var(--info) 24%, var(--border))",
  },

  {
    value: "DECLINED",
    label: "Declined",
    description: "Tradie declined the job",
    icon: <XCircle className="h-5 w-5" />,
    color: "var(--destructive)",
    bg: "var(--destructive-light)",
    border: "color-mix(in oklab, var(--destructive) 24%, var(--border))",
  },

  {
    value: "COMPLETED",
    label: "Completed",
    description: "Work has been completed",
    icon: <CheckCheck className="h-5 w-5" />,
    color: "var(--muted-foreground)",
    bg: "var(--muted)",
    border: "var(--border)",
  },
];

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function getStatusStyles(status: string) {
  switch (status) {
    case "CONFIRMED":
      return "bg-[color:var(--success-light)] text-[color:var(--success)]";

    case "PENDING":
    case "PENDING_RESPONSE":
      return "bg-[color:var(--warning-light)] text-[color:var(--warning)]";

    case "NO_RESPONSE":
    case "DECLINED":
      return "bg-[color:var(--destructive-light)] text-[color:var(--destructive)]";

    case "AWAITING_MATERIALS":
      return "bg-[color:var(--info-light)] text-[color:var(--info)]";

    default:
      return "bg-muted text-muted-foreground";
  }
}

export function ConfirmStatusModal({
  schedule,
  open,
  onOpenChange,
  onSuccess,
}: {
  schedule: TradieScheduleListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [status, setStatus] = useState<ScheduleStatus>(schedule.status as ScheduleStatus);
  const [activeLoading, setActiveLoading] = useState<ScheduleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const pendingFromStore = useAppSelector((s) => s.tradies.pendingScheduleIds.includes(schedule.id));

  const resetState = () => {
    setStatus(schedule.status as ScheduleStatus);
    setActiveLoading(null);
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      resetState();
    }

    onOpenChange(nextOpen);
  };

  function updateStatus(nextStatus: ScheduleStatus) {
    setActiveLoading(nextStatus);
    setError(null);

    startTransition(() => {
      dispatch(
        updateTradieScheduleStatus({ scheduleId: schedule.id, status: nextStatus as TradieScheduleStatus }),
      )
        .unwrap()
        .then(() => {
          setActiveLoading(null);
          setStatus(nextStatus);
          onOpenChange(false);
          onSuccess();
        })
        .catch((err: unknown) => {
          setActiveLoading(null);
          setError(err instanceof Error ? err.message : String(err));
        });
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[calc(100%-2rem)] gap-0 sm:max-w-[680px] overflow-hidden rounded-[14px] border border-border/70 bg-card p-0 shadow-2xl",
          "sm:rounded-[14px]",
          "max-h-[60vh] overflow-y-auto",
        )}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between border-b border-border/70 px-6 py-5">
          <div>
            <DialogTitle className="text-[18px] font-[700] tracking-[-0.02em] text-foreground">
              Update Status — {schedule.tradieName}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Current Status Card */}
          <div className="mb-4 rounded-[8px] bg-muted/40 p-3">
            <div className="text-[12px] text-foreground">
              <span className="font-[700]">Current Status:</span>{" "}
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-[10px] py-[3px] text-[10.5px] font-[600]",
                  getStatusStyles(schedule.status),
                )}
              >
                {formatStatus(schedule.status)}
              </span>
            </div>

            <div className="mt-0.5 text-[12px] text-muted-foreground">
              {schedule.projectName} —{" "}
              {schedule.milestoneName ?? "Unscheduled milestone"}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-2 flex items-center gap-2 rounded-[8px] bg-[color:var(--destructive-light)] px-3 py-2 text-[12px] text-[color:var(--destructive)]">
              <XCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Status Options */}
          <div className="flex flex-col gap-[6px]">
            {statusOptions.map((option) => {
              const selected = status === option.value;
              const isLoading = activeLoading === option.value || (pendingFromStore && isPending);

              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={isLoading}
                  onClick={() => updateStatus(option.value)}
                  className={cn(
                    "group flex w-full items-center gap-[10px] rounded-[10px] border-2 bg-card px-4 py-[14px] text-left transition-all",
                    "hover:-translate-y-[2px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]",
                    "disabled:pointer-events-none disabled:opacity-60",
                    selected
                      ? "border-[var(--active-border)] bg-[var(--active-bg)]"
                      : "border-border/70",
                  )}
                  style={
                    selected
                      ? ({
                          ["--active-border" as string]: option.color,
                          ["--active-bg" as string]: option.bg,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  {/* Icon */}
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
                    style={{
                      background: option.bg,
                      color: option.color,
                    }}
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      option.icon
                    )}
                  </div>

                  {/* Text */}
                  <div className="min-w-0">
                    <div
                      className="text-[13px] font-[600]"
                      style={{
                        color: option.color,
                      }}
                    >
                      {option.label}
                    </div>

                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {option.description}
                    </div>
                  </div>

                  {/* Selected */}
                  {selected && (
                    <Check
                      className="ml-auto h-5 w-5 shrink-0"
                      style={{
                        color: option.color,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
