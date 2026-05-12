"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { TradieScheduleWithRelations } from "@/lib/data/tradies";

export function LogCallModal({
  schedule,
  open,
  onOpenChange,
  onSuccess,
}: {
  schedule: TradieScheduleWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState<"CONFIRMED" | "NO_RESPONSE" | "DECLINED" | null>(null);

  async function submit(status: "CONFIRMED" | "NO_RESPONSE" | "DECLINED") {
    setLoading(status);

    const response = await fetch(`/api/tradie-schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    setLoading(null);

    if (!response.ok) {
      return;
    }

    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log Call Outcome</DialogTitle>
          <DialogDescription>
            {schedule.tradie.name} on {schedule.project.name} for {schedule.milestone?.name ?? "unscheduled milestone"}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button type="button" onClick={() => void submit("CONFIRMED")} disabled={loading !== null}>
            {loading === "CONFIRMED" ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirmed
          </Button>
          <Button type="button" variant="outline" onClick={() => void submit("NO_RESPONSE")} disabled={loading !== null}>
            {loading === "NO_RESPONSE" ? <Loader2 className="size-4 animate-spin" /> : null}
            No Answer
          </Button>
          <Button type="button" variant="destructive" onClick={() => void submit("DECLINED")} disabled={loading !== null}>
            {loading === "DECLINED" ? <Loader2 className="size-4 animate-spin" /> : null}
            Declined
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
