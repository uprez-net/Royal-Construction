"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function CreateVariationModal({
  projectId,
  open,
  onOpenChange,
  onSuccess,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [requestedDate, setRequestedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);

    const response = await fetch(`/api/projects/${projectId}/variations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        cost: Number(cost),
        requestedDate,
      }),
    });

    setIsSaving(false);

    if (!response.ok) {
      return;
    }

    onOpenChange(false);
    setDescription("");
    setCost("");
    setRequestedDate(new Date().toISOString().slice(0, 10));
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Variation</DialogTitle>
          <DialogDescription>Capture scope changes, pricing, and the requested date.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the variation"
              rows={4}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Cost</label>
              <Input value={cost} onChange={(event) => setCost(event.target.value)} type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Requested Date</label>
              <Input value={requestedDate} onChange={(event) => setRequestedDate(event.target.value)} type="date" required />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Save Variation
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
