"use client";

import { useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";

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
  onSuccess,
}: {
  schedule: TradieScheduleWithRelations;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
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

    setOpen(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PhoneCall className="size-4" />
        Log Call
      </Button>
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
