"use client";

import { useRouter } from "next/navigation";

import { ConfirmStatusModal } from "@/components/tradies/confirm-status-modal";
import { LogCallModal } from "@/components/tradies/log-call-modal";

import type { TradieScheduleWithRelations } from "@/lib/data/tradies";

export function UrgentReminderActions({ schedule }: { schedule: TradieScheduleWithRelations }) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-2">
      <LogCallModal schedule={schedule} onSuccess={() => router.refresh()} />
      <ConfirmStatusModal schedule={schedule} onSuccess={() => router.refresh()} />
    </div>
  );
}
