"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  Phone,
  PhoneOff,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { TradieScheduleListItem } from "@/types/project";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { updateTradieScheduleStatus } from "@/lib/store/slices/tradiesSlice";
import type { TradieScheduleStatus } from "@prisma/client";

type CallStatus = "CONFIRMED" | "PENDING" | "NO_RESPONSE" | "DECLINED";

const outcomeConfig: Record<
  CallStatus,
  {
    title: string;
    description: string;
    icon: React.ReactNode;
    border: string;
    iconBg: string;
    iconColor: string;
    titleColor: string;
  }
> = {
  CONFIRMED: {
    title: "Confirmed",
    description: "Tradie confirmed availability",
    icon: <CheckCircle2 className="h-5 w-5" />,
    border: "border-[rgba(22,163,74,0.2)]",
    iconBg: "bg-[#DCFCE7]",
    iconColor: "text-[#16A34A]",
    titleColor: "text-[#16A34A]",
  },

  PENDING: {
    title: "Will Call Back",
    description: "Tradie will check and revert",
    icon: <Clock3 className="h-5 w-5" />,
    border: "border-[rgba(245,158,11,0.2)]",
    iconBg: "bg-[#FEF9C3]",
    iconColor: "text-[#D97706]",
    titleColor: "text-[#D97706]",
  },

  NO_RESPONSE: {
    title: "No Answer",
    description: "Went to voicemail / not reachable",
    icon: <PhoneOff className="h-5 w-5" />,
    border: "border-[rgba(148,163,184,0.2)]",
    iconBg: "bg-[#F1F5F9]",
    iconColor: "text-[#94A3B8]",
    titleColor: "text-[#0F172A]",
  },

  DECLINED: {
    title: "Declined",
    description: "Tradie not available",
    icon: <XCircle className="h-5 w-5" />,
    border: "border-[rgba(220,38,38,0.2)]",
    iconBg: "bg-[#FEE2E2]",
    iconColor: "text-[#DC2626]",
    titleColor: "text-[#DC2626]",
  },
};

export function LogCallModal({
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
  const [notes, setNotes] = useState("");
  const [activeLoading, setActiveLoading] = useState<CallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const pendingIds = useAppSelector((s) => s.tradies.pendingScheduleIds);

  function submit(status: CallStatus) {
    setActiveLoading(status);
    setError(null);

    startTransition(() => {
      dispatch(
        updateTradieScheduleStatus({
          scheduleId: schedule.id,
          status: status as TradieScheduleStatus,
          notes,
        }),
      )
        .unwrap()
        .then(() => {
          setActiveLoading(null);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[680px] gap-0 overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-white p-0 shadow-2xl",
          "sm:rounded-[14px]",
          "max-h-[60vh] overflow-y-auto"
        )}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between border-b border-[#E2E8F0] px-6 py-5">
          <div>
            <DialogTitle className="text-[18px] font-[700] tracking-[-0.02em] text-[#0F172A]">
              Log Call Outcome
            </DialogTitle>

            <p className="mt-1 text-[12.5px] text-[#64748B]">
              {schedule.tradieName} on {schedule.projectName} for{" "}
              {schedule.milestoneName ?? "unscheduled milestone"}.
            </p>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Phone Card */}
          <div className="py-5 text-center">
            <div
              className={cn(
                "mb-3 inline-flex h-16 w-16 items-center justify-center rounded-full",
                "bg-[rgba(13,148,136,0.15)]",
              )}
            >
              <Phone className="h-7 w-7 text-[#0D9488]" />
            </div>

            <div className="text-[20px] font-[800] tracking-[-0.02em] text-[#0F172A]">
              {schedule.contact.phone || schedule.tradieName}
            </div>

            <div className="mt-0.5 text-[12px] text-[#94A3B8]">
              {schedule.company || "Tradie"}
            </div>
          </div>

          {/* Notes */}
          <div className="mb-4">
            <label className="mb-[5px] block text-[11.5px] font-[600] text-[#475569]">
              Call Notes
            </label>

            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was discussed? Any outcomes or commitments made..."
              className={cn(
                "min-h-[90px] resize-none rounded-[8px] border-[#E2E8F0]",
                "px-3 py-2 text-[13px] text-[#0F172A]",
                "focus-visible:border-[#0D9488]",
                "focus-visible:ring-[3px]",
                "focus-visible:ring-[rgba(13,148,136,0.15)]",
              )}
            />
          </div>

          {/* Outcome Label */}
          <div className="mb-2 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
            Outcome
          </div>
          {/* Error Message */}
          {error && (
            <div className="mb-2 flex items-center gap-2 rounded-[8px] bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#DC2626]">
              <XCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Outcome Grid */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              Object.entries(outcomeConfig) as [
                CallStatus,
                (typeof outcomeConfig)[CallStatus],
              ][]
            ).map(([status, config]) => {
              const isLoading =
                activeLoading === status ||
                (pendingIds.includes(schedule.id) && isPending);

              return (
                <button
                  key={status}
                  type="button"
                  disabled={isLoading}
                  onClick={() => submit(status)}
                  className={cn(
                    "group flex w-full items-center gap-[10px] rounded-[10px] border-2 bg-white px-4 py-[14px] text-left transition-all",
                    "hover:-translate-y-[2px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]",
                    "disabled:pointer-events-none disabled:opacity-60",
                    config.border,
                    schedule.status === status && "border-[#0D9488] shadow-[0_4px_12px_rgba(13,148,136,0.15)]",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]",
                      config.iconBg,
                      config.iconColor,
                    )}
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      config.icon
                    )}
                  </div>

                  <div className="min-w-0">
                    <div
                      className={cn(
                        "text-[13px] font-[600]",
                        config.titleColor,
                      )}
                    >
                      {config.title}
                    </div>

                    <div className="mt-0.5 text-[11px] text-[#94A3B8]">
                      {config.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
