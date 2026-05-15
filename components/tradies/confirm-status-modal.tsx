"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Check,
  CheckCircle2,
  CheckCheck,
  Clock3,
  Loader2,
  PhoneOff,
  X,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogClose,
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
    color: "#16A34A",
    bg: "#DCFCE7",
    border: "rgba(22,163,74,0.2)",
  },

  {
    value: "PENDING_RESPONSE",
    label: "Pending Response",
    description: "Awaiting tradie response",
    icon: <Clock3 className="h-5 w-5" />,
    color: "#D97706",
    bg: "#FEF9C3",
    border: "rgba(245,158,11,0.2)",
  },

  {
    value: "NO_RESPONSE",
    label: "No Response",
    description: "Multiple attempts, no response",
    icon: <PhoneOff className="h-5 w-5" />,
    color: "#DC2626",
    bg: "#FEE2E2",
    border: "rgba(220,38,38,0.2)",
  },

  {
    value: "AWAITING_MATERIALS",
    label: "Awaiting Materials",
    description: "Confirmed but waiting on materials",
    icon: <Box className="h-5 w-5" />,
    color: "#2563EB",
    bg: "#DBEAFE",
    border: "rgba(37,99,235,0.2)",
  },

  {
    value: "DECLINED",
    label: "Declined",
    description: "Tradie declined the job",
    icon: <XCircle className="h-5 w-5" />,
    color: "#DC2626",
    bg: "#FEE2E2",
    border: "rgba(220,38,38,0.2)",
  },

  {
    value: "COMPLETED",
    label: "Completed",
    description: "Work has been completed",
    icon: <CheckCheck className="h-5 w-5" />,
    color: "#94A3B8",
    bg: "#F1F5F9",
    border: "rgba(148,163,184,0.2)",
  },
];

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function getStatusStyles(status: string) {
  switch (status) {
    case "CONFIRMED":
      return "bg-[rgba(22,163,74,0.08)] text-[#16A34A]";

    case "PENDING":
    case "PENDING_RESPONSE":
      return "bg-[rgba(245,158,11,0.08)] text-[#D97706]";

    case "NO_RESPONSE":
    case "DECLINED":
      return "bg-[rgba(220,38,38,0.08)] text-[#DC2626]";

    case "AWAITING_MATERIALS":
      return "bg-[rgba(37,99,235,0.08)] text-[#2563EB]";

    default:
      return "bg-[rgba(148,163,184,0.1)] text-[#475569]";
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
  const [status, setStatus] = useState<ScheduleStatus>(
    schedule.status as ScheduleStatus,
  );

  const [loading, setLoading] = useState<ScheduleStatus | null>(null);

  useEffect(() => {
    setStatus(schedule.status as ScheduleStatus);
  }, [schedule.status]);

  async function updateStatus(nextStatus: ScheduleStatus) {
    setLoading(nextStatus);

    const response = await fetch(`/api/tradie-schedules/${schedule.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: nextStatus,
      }),
    });

    setLoading(null);

    if (!response.ok) {
      return;
    }

    setStatus(nextStatus);

    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[680px] gap-0 overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-white p-0 shadow-2xl",
          "sm:rounded-[14px]",
        )}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between border-b border-[#E2E8F0] px-6 py-5">
          <div>
            <DialogTitle className="text-[18px] font-[700] tracking-[-0.02em] text-[#0F172A]">
              Update Status — {schedule.tradieName}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Current Status Card */}
          <div className="mb-4 rounded-[8px] bg-[#F1F5F9] p-3">
            <div className="text-[12px] text-[#0F172A]">
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

            <div className="mt-0.5 text-[12px] text-[#94A3B8]">
              {schedule.projectName} —{" "}
              {schedule.milestoneName ?? "Unscheduled milestone"}
            </div>
          </div>

          {/* Status Options */}
          <div className="flex flex-col gap-[6px]">
            {statusOptions.map((option) => {
              const selected = status === option.value;
              const isLoading = loading === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={loading !== null}
                  onClick={() => void updateStatus(option.value)}
                  className={cn(
                    "group flex w-full items-center gap-[10px] rounded-[10px] border-2 bg-white px-4 py-[14px] text-left transition-all",
                    "hover:-translate-y-[2px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]",
                    "disabled:pointer-events-none disabled:opacity-60",
                    selected
                      ? "border-[var(--active-border)] bg-[var(--active-bg)]"
                      : "border-[#E2E8F0]",
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

                    <div className="mt-0.5 text-[11px] text-[#94A3B8]">
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
