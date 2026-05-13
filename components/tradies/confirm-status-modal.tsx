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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { TradieScheduleWithTradieMilestoneAndProject } from "@/types/project";

const statusOptions = [
  "PENDING",
  "PENDING_RESPONSE",
  "CONFIRMED",
  "NO_RESPONSE",
  "DECLINED",
  "COMPLETED",
] as const;

export function ConfirmStatusModal({
  schedule,
  open,
  onOpenChange,
  onSuccess,
}: {
  schedule: TradieScheduleWithTradieMilestoneAndProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [status, setStatus] = useState(schedule.status);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setLoading(true);

    const response = await fetch(`/api/tradie-schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    setLoading(false);

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
          <DialogTitle>Confirm Status</DialogTitle>
          <DialogDescription>
            {schedule.tradie.name} on {schedule.project.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Status</label>
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
