"use client";

import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";

import type { TradieScheduleWithTradieMilestoneAndProject } from "@/types/project";

export function UrgentReminderActions({ schedule }: { schedule: TradieScheduleWithTradieMilestoneAndProject }) {
  const dispatch = useAppDispatch();

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
        onClick={() => dispatch(openModal({ type: "logCall", payload: { schedule } }))}
      >
        Log Call
      </button>
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
        onClick={() => dispatch(openModal({ type: "confirmStatus", payload: { schedule } }))}
      >
        Confirm Status
      </button>
    </div>
  );
}
